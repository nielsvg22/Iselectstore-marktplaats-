/**
 * In-memory run/status store for the browser test so the admin UI can show a
 * live field-by-field debug view ("✓ Titel ingevuld", "⚠ Batterijpercentage
 * niet gevonden", …) while Playwright is working.
 *
 * Dev-only feature: kept on globalThis so a Next.js dev hot-reload does not
 * wipe the state between polls. Nothing here is ever persisted to git or DB.
 */

export type FieldStatusKind = "ok" | "warning" | "error" | "info";

export interface FieldStatus {
  field: string;
  status: FieldStatusKind;
  detail?: string;
}

export type BrowserTestRunState = "queued" | "waiting_login" | "waiting_code" | "running" | "done" | "failed";

export interface BrowserTestRun {
  runId: string;
  shopifyProductId: string;
  state: BrowserTestRunState;
  startedAt: string;
  finishedAt?: string;
  title?: string;
  message?: string;
  stoppedBeforeSubmit: boolean;
  /** URL of the advertisement after a successful test placement. */
  postedUrl?: string;
  statuses: FieldStatus[];
  /** Set by requestStop() — polled cooperatively by the running Playwright flow. */
  stopRequested?: boolean;
}

interface RunStore {
  runs: Map<string, BrowserTestRun>;
}

const MAX_RUNS = 20;

function store(): RunStore {
  const holder = globalThis as typeof globalThis & { __marktplaatsBrowserRuns?: RunStore };
  if (!holder.__marktplaatsBrowserRuns) {
    holder.__marktplaatsBrowserRuns = { runs: new Map() };
  }
  return holder.__marktplaatsBrowserRuns;
}

export function createRun(shopifyProductId: string): BrowserTestRun {
  const run: BrowserTestRun = {
    runId: `mpbt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    shopifyProductId,
    state: "queued",
    startedAt: new Date().toISOString(),
    stoppedBeforeSubmit: false,
    statuses: [],
  };
  const s = store();
  s.runs.set(run.runId, run);
  if (s.runs.size > MAX_RUNS) {
    const oldest = [...s.runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (oldest) s.runs.delete(oldest.runId);
  }
  return run;
}

export function getRun(runId: string): BrowserTestRun | undefined {
  return store().runs.get(runId);
}

export function isRunActive(runId: string): boolean {
  const run = getRun(runId);
  return Boolean(
    run && (run.state === "queued" || run.state === "running" || run.state === "waiting_login" || run.state === "waiting_code")
  );
}

/**
 * Only blocks a second run for the SAME product (two tabs fighting over one
 * product's form) — different products are free to run concurrently, each
 * in its own browser tab within the shared, already-logged-in context (see
 * session.ts / browserTestPublisher.ts's resolvePage()).
 */
export function findActiveRunForProduct(shopifyProductId: string): BrowserTestRun | undefined {
  return [...store().runs.values()].find(
    (r) =>
      r.shopifyProductId === shopifyProductId &&
      (r.state === "queued" || r.state === "running" || r.state === "waiting_login" || r.state === "waiting_code")
  );
}

/**
 * Appends (or replaces) the status line for a field so re-attempts don't
 * produce duplicate rows in the UI.
 */
export function recordStatus(run: BrowserTestRun, entry: FieldStatus): void {
  const existing = run.statuses.findIndex((s) => s.field === entry.field);
  if (existing >= 0) run.statuses[existing] = entry;
  else run.statuses.push(entry);
}

export function setState(run: BrowserTestRun, state: BrowserTestRunState, message?: string): void {
  run.state = state;
  if (message !== undefined) run.message = message;
  if (state === "done" || state === "failed") run.finishedAt = new Date().toISOString();
}

export function serializeRun(run: BrowserTestRun): BrowserTestRun {
  return JSON.parse(JSON.stringify(run)) as BrowserTestRun;
}

interface PendingLogin {
  username: string;
  password: string;
}

function loginSubmissions(): Map<string, PendingLogin> {
  const holder = globalThis as typeof globalThis & { __marktplaatsBrowserLoginSubmissions?: Map<string, PendingLogin> };
  if (!holder.__marktplaatsBrowserLoginSubmissions) holder.__marktplaatsBrowserLoginSubmissions = new Map();
  return holder.__marktplaatsBrowserLoginSubmissions;
}

/**
 * Called by the browser-test/login API route when the user types their
 * Marktplaats e-mail/wachtwoord into the admin UI instead of switching into
 * the embedded noVNC view. Never persisted — read once by
 * takeSubmittedLogin() and discarded immediately.
 */
export function submitLoginCredentials(runId: string, username: string, password: string): boolean {
  if (!isRunActive(runId)) return false;
  loginSubmissions().set(runId, { username, password });
  return true;
}

/** Polled by ensureLoggedIn()'s loop; returns and clears any pending submission. */
export function takeSubmittedLogin(runId: string): PendingLogin | null {
  const map = loginSubmissions();
  const entry = map.get(runId);
  if (!entry) return null;
  map.delete(runId);
  return entry;
}

interface PendingCode {
  resolve: (code: string | null) => void;
}

function codeWaiters(): Map<string, PendingCode> {
  const holder = globalThis as typeof globalThis & { __marktplaatsBrowserCodeWaiters?: Map<string, PendingCode> };
  if (!holder.__marktplaatsBrowserCodeWaiters) holder.__marktplaatsBrowserCodeWaiters = new Map();
  return holder.__marktplaatsBrowserCodeWaiters;
}

/**
 * Called by the browser-test/code API route once the user types a
 * verification code into the admin UI. Returns false when no run is
 * currently waiting for one (e.g. already timed out).
 */
export function submitVerificationCode(runId: string, code: string): boolean {
  const waiters = codeWaiters();
  const pending = waiters.get(runId);
  if (!pending) return false;
  waiters.delete(runId);
  pending.resolve(code.trim());
  return true;
}

/**
 * Called by the browser-test/stop API route so a stuck run (waiting on a
 * manual login, a 2FA code, or any long Playwright step) can be killed from
 * the admin UI without redeploying the app. Cooperative: the Playwright flow
 * checks isStopRequested() at its wait points and unwinds itself, closing the
 * browser on the way out — see MarktplaatsBrowserTestPublisher.
 */
export function requestStop(runId: string): boolean {
  const run = getRun(runId);
  if (!run || !isRunActive(runId)) return false;
  run.stopRequested = true;
  // A pending 2FA-code wait would otherwise block for the full login timeout.
  const waiters = codeWaiters();
  const pending = waiters.get(runId);
  if (pending) {
    waiters.delete(runId);
    pending.resolve(null);
  }
  return true;
}

export function isStopRequested(run: BrowserTestRun): boolean {
  return Boolean(run.stopRequested);
}

/**
 * Called from the Playwright flow when Marktplaats shows a 2FA/SMS
 * challenge. Resolves with the code once submitVerificationCode() is called
 * for this run, or null if nobody submitted one within timeoutMs.
 */
export function waitForVerificationCode(runId: string, timeoutMs: number): Promise<string | null> {
  const waiters = codeWaiters();
  return new Promise<string | null>((resolve) => {
    waiters.set(runId, { resolve });
    const timer = setTimeout(() => {
      if (waiters.get(runId)?.resolve === resolve) {
        waiters.delete(runId);
        resolve(null);
      }
    }, timeoutMs);
    // Node timers keep the process alive; this one must not block shutdown.
    if (typeof timer === "object" && "unref" in timer) (timer as unknown as { unref: () => void }).unref();
  });
}

/**
 * Keeps the UI readable: Playwright errors carry a full browser log, we only
 * surface the first meaningful lines.
 */
export function compactMessage(message: string, maxLength = 400): string {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const first = lines.find((line) => !line.startsWith("<")) ?? lines[0] ?? "";
  const detailLine = lines.find((line) => line.includes("[err]")) ?? "";
  const combined = detailLine && !first.includes(detailLine) ? `${first} — ${detailLine.replace(/^\[[^\]]+\]\[err\]\s*/, "")}` : first;
  return combined.length > maxLength ? `${combined.slice(0, maxLength - 1)}…` : combined;
}
