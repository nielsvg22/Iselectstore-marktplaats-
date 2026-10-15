import type { BrowserContext } from "playwright";

/**
 * Keeps ONE persistent Playwright context alive across runs so the browser
 * (and the Marktplaats login inside it) stays open for manual inspection and
 * is shared by every concurrent run — each run gets its own tab inside this
 * same context (see browserTestPublisher.ts's resolvePage()), so several
 * products can be tested in parallel without a separate login each.
 * Stored on globalThis to survive Next.js dev hot-reloads.
 */
interface SessionHolder {
  context: BrowserContext | null;
}

function holder(): SessionHolder {
  const g = globalThis as typeof globalThis & { __marktplaatsBrowserSession?: SessionHolder };
  if (!g.__marktplaatsBrowserSession) g.__marktplaatsBrowserSession = { context: null };
  return g.__marktplaatsBrowserSession;
}

export function getActiveContext(): BrowserContext | null {
  const context = holder().context;
  if (!context) return null;
  try {
    context.pages();
    return context;
  } catch {
    holder().context = null;
    return null;
  }
}

export function setActiveContext(context: BrowserContext | null): void {
  holder().context = context;
}

/**
 * Process-wide cooldown on the automatic (MARKTPLAATS_USERNAME/PASSWORD)
 * login attempt — separate from the per-run `autoLoginAttempted` flag in
 * browserTestPublisher.ts, which only limits retries WITHIN one run.
 * Repeated runs across a day (several browser tests, a redeploy that lost
 * the session, …) could otherwise each fire their own automatic login POST
 * at Marktplaats, which is exactly the pattern that got this account
 * temporarily locked ("ter bescherming van je account"). Once an attempt
 * has been made, later runs skip straight to the manual "waiting_login"
 * state until the cooldown passes, rather than hammering the login form
 * again on Marktplaats' own account-protection system.
 */
const AUTO_LOGIN_COOLDOWN_MS = 15 * 60 * 1000;

interface AutoLoginState {
  lastAttemptAt: number | null;
}

function autoLoginHolder(): AutoLoginState {
  const g = globalThis as typeof globalThis & { __marktplaatsAutoLoginState?: AutoLoginState };
  if (!g.__marktplaatsAutoLoginState) g.__marktplaatsAutoLoginState = { lastAttemptAt: null };
  return g.__marktplaatsAutoLoginState;
}

/** True when an automatic login attempt is still allowed right now. */
export function autoLoginCooldownElapsed(): boolean {
  const { lastAttemptAt } = autoLoginHolder();
  if (lastAttemptAt === null) return true;
  return Date.now() - lastAttemptAt >= AUTO_LOGIN_COOLDOWN_MS;
}

/** Minutes remaining before another automatic attempt is allowed. */
export function autoLoginCooldownRemainingMinutes(): number {
  const { lastAttemptAt } = autoLoginHolder();
  if (lastAttemptAt === null) return 0;
  const remaining = AUTO_LOGIN_COOLDOWN_MS - (Date.now() - lastAttemptAt);
  return Math.max(0, Math.ceil(remaining / 60_000));
}

export function recordAutoLoginAttempt(): void {
  autoLoginHolder().lastAttemptAt = Date.now();
}
