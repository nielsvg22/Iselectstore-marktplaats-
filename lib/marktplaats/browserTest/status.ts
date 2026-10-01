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

export type BrowserTestRunState = "queued" | "waiting_login" | "running" | "done" | "failed";

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
  return Boolean(run && (run.state === "queued" || run.state === "running" || run.state === "waiting_login"));
}

/** Start an additional run when another one is still going. */
export function findActiveRun(): BrowserTestRun | undefined {
  return [...store().runs.values()].find(
    (r) => r.state === "queued" || r.state === "running" || r.state === "waiting_login"
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
