// Keeps a Shopify Admin API access token alive indefinitely. Client
// Credentials Grant tokens expire after ~24h — this service transparently
// refreshes one before it expires and persists it in Postgres so every
// serverless function instance (and every redeploy) shares the same live
// token, without ever needing a human to paste a new one into Vercel again.
import { query } from "../db";

interface TokenRow {
  access_token: string;
  expires_at: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

// Per-lambda-instance cache — avoids a DB round trip on every request while
// the token is still comfortably valid; Postgres is the source of truth
// across instances and cold starts.
let memCache: CachedToken | null = null;

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before actual expiry

async function requestNewToken(): Promise<CachedToken> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error("SHOPIFY_STORE_DOMAIN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not configured — cannot refresh Shopify token");
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify token refresh failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAtMs = Date.now() + data.expires_in * 1000;

  await query(
    `INSERT INTO shopify_admin_token (id, access_token, expires_at, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET access_token = $1, expires_at = $2, updated_at = now()`,
    [data.access_token, new Date(expiresAtMs).toISOString()]
  );

  return { token: data.access_token, expiresAtMs };
}

/** Returns a Shopify Admin API token guaranteed to be valid for at least REFRESH_BUFFER_MS, refreshing it (and persisting the refresh) if needed. */
export async function getShopifyAccessToken(): Promise<string> {
  if (memCache && memCache.expiresAtMs - REFRESH_BUFFER_MS > Date.now()) {
    return memCache.token;
  }

  const rows = await query<TokenRow>("SELECT access_token, expires_at FROM shopify_admin_token WHERE id = 1");
  if (rows[0]) {
    const expiresAtMs = new Date(rows[0].expires_at).getTime();
    if (expiresAtMs - REFRESH_BUFFER_MS > Date.now()) {
      memCache = { token: rows[0].access_token, expiresAtMs };
      return rows[0].access_token;
    }
  }

  const fresh = await requestNewToken();
  memCache = fresh;
  return fresh.token;
}
