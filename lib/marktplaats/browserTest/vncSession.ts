import crypto from "node:crypto";

/**
 * Short-lived, one-time-use session tokens that stand in for the real
 * VNC_PASSWORD so it never has to travel through a URL/querystring, a
 * browser's history, a `Referer` header or an unauthenticated API response
 * (see app/api/marktplaats/browser-test/vnc-session/route.ts and
 * .../vnc-proxy/[...path]/route.ts, which are the only two places that ever
 * touch this module).
 *
 * In-memory on globalThis, the same pattern as the codeWaiters()/
 * loginSubmissions() stores in status.ts — no database, survives a dev
 * hot-reload, never persisted anywhere, never logged.
 */

/** Token lifetime. Long enough for the admin panel's immediate fetch+load, short enough to not matter if one somehow leaked. */
export const VNC_SESSION_TTL_MS = 60_000;

interface VncSessionEntry {
  password: string;
  expiresAt: number;
}

function store(): Map<string, VncSessionEntry> {
  const holder = globalThis as typeof globalThis & { __marktplaatsVncSessions?: Map<string, VncSessionEntry> };
  if (!holder.__marktplaatsVncSessions) holder.__marktplaatsVncSessions = new Map();
  return holder.__marktplaatsVncSessions;
}

function pruneExpired(now = Date.now()): void {
  const s = store();
  for (const [token, entry] of s) {
    if (entry.expiresAt <= now) s.delete(token);
  }
}

/** Creates a new opaque token bound to `password`, valid for VNC_SESSION_TTL_MS. */
export function createVncSessionToken(password: string, ttlMs = VNC_SESSION_TTL_MS): string {
  const now = Date.now();
  pruneExpired(now);
  const token = crypto.randomBytes(32).toString("hex");
  store().set(token, { password, expiresAt: now + ttlMs });
  return token;
}

/**
 * Validates + immediately invalidates `token` — one-time use, whether it
 * turns out to be valid or not, so a token can never be retried/replayed
 * even if the GET it was meant for failed for some other reason. Returns the
 * bound password on success, or null when the token is unknown, already
 * used, or expired.
 */
export function consumeVncSessionToken(token: string): string | null {
  const s = store();
  const entry = s.get(token);
  s.delete(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.password;
}

/** Test-only: current number of still-pending (unused, unexpired) tokens. */
export function _debugPendingSessionCount(): number {
  pruneExpired();
  return store().size;
}

/** Test-only: drops every stored token, so each test starts from a clean slate. */
export function _debugResetVncSessions(): void {
  store().clear();
}
