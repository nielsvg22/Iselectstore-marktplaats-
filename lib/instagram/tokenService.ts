// Keeps an Instagram Graph API long-lived access token alive indefinitely.
// Instagram's "ig_exchange_token" tokens last ~60 days and are never
// permanent, but Instagram's refresh endpoint can extend a still-valid
// token by another 60 days at any time — this service does that
// automatically and persists the result in Postgres, mirroring
// lib/shopify/tokenService.ts, so nobody ever has to redo the manual
// OAuth consent flow again as long as the token gets refreshed before it
// actually expires.
import { query } from "../db";
import { logSync } from "../logging";
import type { InstagramEnvironment } from "./config";

interface TokenRow {
  access_token: string;
  expires_at: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

// Per-lambda-instance cache, same reasoning as the Shopify token service.
const memCache = new Map<InstagramEnvironment, CachedToken>();

// Instagram long-lived tokens last ~60 days; refreshing only works on a
// still-valid token, and products-create/update webhooks (the only thing
// that reads this) might not fire for days at a time during a quiet
// period, so refresh generously early rather than cutting it close.
const REFRESH_BUFFER_MS = 20 * 24 * 60 * 60 * 1000;

function envVarNameFor(environment: InstagramEnvironment): string {
  return environment === "production" ? "INSTAGRAM_ACCESS_TOKEN" : "INSTAGRAM_TEST_ACCESS_TOKEN";
}

async function persist(environment: InstagramEnvironment, token: string, expiresAtMs: number): Promise<void> {
  await query(
    `INSERT INTO instagram_token (environment, access_token, expires_at, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (environment) DO UPDATE SET access_token = $2, expires_at = $3, updated_at = now()`,
    [environment, token, new Date(expiresAtMs).toISOString()]
  );
}

async function refresh(environment: InstagramEnvironment, currentToken: string): Promise<CachedToken> {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`);
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Instagram token refresh mislukt (${res.status}): ${JSON.stringify(data)}`);
  }
  const expiresAtMs = Date.now() + data.expires_in * 1000;
  await persist(environment, data.access_token, expiresAtMs);
  await logSync({ action: "instagram_token_refreshed", message: `environment=${environment}, geldig tot ${new Date(expiresAtMs).toISOString()}` });
  return { token: data.access_token, expiresAtMs };
}

/**
 * Returns a usable Instagram access token for the given environment,
 * refreshing and persisting it first if it's getting close to expiry.
 * Returns null only if no token has ever been configured at all (first-run
 * seed from the env var is also missing) — autoSync/service treat that as
 * mock mode, same as before this service existed.
 */
export async function getInstagramAccessToken(environment: InstagramEnvironment): Promise<string | null> {
  const cached = memCache.get(environment);
  if (cached && cached.expiresAtMs - REFRESH_BUFFER_MS > Date.now()) {
    return cached.token;
  }

  const rows = await query<TokenRow>("SELECT access_token, expires_at FROM instagram_token WHERE environment = $1", [environment]);
  let current: CachedToken;
  if (rows[0]) {
    current = { token: rows[0].access_token, expiresAtMs: new Date(rows[0].expires_at).getTime() };
  } else {
    // First-ever use: seed the DB from the env var so there's something to
    // refresh later. Assumes ~60 days of remaining validity from now, which
    // is only wrong by however long the token had already been sitting in
    // the env var unused — the refresh below corrects the real expiry as
    // soon as it actually runs.
    const envToken = process.env[envVarNameFor(environment)]?.trim();
    if (!envToken) return null;
    const seedExpiresAtMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
    await persist(environment, envToken, seedExpiresAtMs);
    current = { token: envToken, expiresAtMs: seedExpiresAtMs };
  }

  if (current.expiresAtMs - REFRESH_BUFFER_MS > Date.now()) {
    memCache.set(environment, current);
    return current.token;
  }

  try {
    const refreshed = await refresh(environment, current.token);
    memCache.set(environment, refreshed);
    return refreshed.token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ action: "instagram_token_refresh_error", message }).catch(() => {});
    // Fall back to the still-on-file token rather than breaking posting
    // outright — it may still have a few days of validity left.
    memCache.set(environment, current);
    return current.token;
  }
}
