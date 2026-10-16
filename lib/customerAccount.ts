// Customer Account API (nieuwe klantaccounts) — authenticatie + GraphQL.
// Flow: authorization code + PKCE (S256) tegen de discovery-endpoints van de
// store; sessie bewaren we in een httpOnly-cookie. App-client tokens zijn
// publieke PKCE-clients: 1u geldig, GEEN refresh_token — bij verloop gaat de
// gebruiker opnieuw door authorize (Shopify SSO-session = still silent).
import { cookies } from "next/headers";
import crypto from "crypto";

const SHOP_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const CLIENT_ID = process.env.SHOPIFY_APP_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHOPIFY_APP_CLIENT_SECRET || "";

export const SESSION_COOKIE = "iselect_ca_session";
export const PENDING_COOKIE = "iselect_ca_pending";
const SESSION_TTL_SKEW_MS = 30_000; // vóór echte expiratie herinloggen

export type CaSession = {
  a: string; // access_token (shcat_...)
  i?: string; // id_token (voor RP-initiated logout)
  e: number; // expiry, epoch-ms
};

type Pending = {
  st: string; // state
  v: string; // code_verifier
  n: string; // nonce
  f?: string; // veilige retour-pad na login (moet met /portaal beginnen)
};

type OpenIdConfig = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
};

type CustomerAccountConfig = { graphql_api: string };

export class CaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaAuthError";
  }
}

// ---------- discovery (module-cache, 10 min) ----------
let openidCache: { cfg: OpenIdConfig; at: number } | null = null;
let gqlCache: { endpoint: string; at: number } | null = null;
const DISCOVERY_TTL = 10 * 60 * 1000;

export async function discoverOpenId(): Promise<OpenIdConfig> {
  if (openidCache && Date.now() - openidCache.at < DISCOVERY_TTL) return openidCache.cfg;
  const res = await fetch(`https://${SHOP_DOMAIN}/.well-known/openid-configuration`, {
    cache: "no-store",
  });
  if (!res.ok) throw new CaAuthError(`OpenID discovery mislukt (${res.status})`);
  const cfg = (await res.json()) as OpenIdConfig;
  openidCache = { cfg, at: Date.now() };
  return cfg;
}

export async function discoverGraphqlEndpoint(): Promise<string> {
  if (gqlCache && Date.now() - gqlCache.at < DISCOVERY_TTL) return gqlCache.endpoint;
  const res = await fetch(`https://${SHOP_DOMAIN}/.well-known/customer-account-api`, {
    cache: "no-store",
  });
  if (!res.ok) throw new CaAuthError(`Customer Account API discovery mislukt (${res.status})`);
  const cfg = (await res.json()) as CustomerAccountConfig;
  gqlCache = { endpoint: cfg.graphql_api, at: Date.now() };
  return cfg.graphql_api;
}

// ---------- helpers ----------
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeCookie(value: unknown): string {
  return b64url(Buffer.from(JSON.stringify(value), "utf8"));
}

function decodeCookie<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function safeFwd(fwd: string | null | undefined): string | undefined {
  // Alleen eigen interne portaal-paden om open redirects te voorkomen.
  if (fwd && fwd.startsWith("/") && !fwd.startsWith("//") && fwd.startsWith("/portaal")) return fwd;
  return undefined;
}

// ---------- sessie ----------
export function getSession(): CaSession | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  const s = decodeCookie<CaSession>(raw);
  if (!s || !s.a) return null;
  if (s.e && s.e - SESSION_TTL_SKEW_MS < Date.now()) return null; // verlopen
  return s;
}

export function hasLiveSession(): boolean {
  return getSession() !== null;
}

// ---------- OAuth: authorize ----------
export async function buildAuthorizeUrl(origin: string, fwd?: string): Promise<{ url: string; setCookies: { name: string; value: string; maxAge: number }[] }> {
  const cfg = await discoverOpenId();
  const state = b64url(crypto.randomBytes(18));
  const verifier = b64url(crypto.randomBytes(48));
  const nonce = b64url(crypto.randomBytes(18));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

  const pending: Pending = { st: state, v: verifier, n: nonce, f: fwd };
  const auth = new URL(cfg.authorization_endpoint);
  auth.searchParams.set("client_id", CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", `${origin}/portaal/callback`);
  auth.searchParams.set("scope", "openid email customer-account-api:full");
  auth.searchParams.set("state", state);
  auth.searchParams.set("nonce", nonce);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");

  return {
    url: auth.toString(),
    setCookies: [{ name: PENDING_COOKIE, value: encodeCookie(pending), maxAge: 600 }],
  };
}

export function consumePending(): Pending | null {
  const raw = cookies().get(PENDING_COOKIE)?.value;
  return decodeCookie<Pending>(raw);
}

// ---------- OAuth: code → token ----------
export async function exchangeCode(origin: string, code: string, verifier: string): Promise<CaSession> {
  const cfg = await discoverOpenId();
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(cfg.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: `${origin}/portaal/callback`,
      code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CaAuthError(`Token exchange mislukt (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; id_token?: string; expires_in?: number };
  if (!data.access_token) throw new CaAuthError("Geen access_token in token-respons.");
  return {
    a: data.access_token,
    i: data.id_token,
    e: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

export function sessionSetCookies(session: CaSession): { name: string; value: string; maxAge: number }[] {
  const maxAge = Math.max(60, Math.floor((session.e - Date.now()) / 1000));
  return [
    { name: SESSION_COOKIE, value: encodeCookie(session), maxAge },
    { name: PENDING_COOKIE, value: "", maxAge: 0 },
  ];
}

export function sessionClearCookies(): { name: string; value: string; maxAge: number }[] {
  return [
    { name: SESSION_COOKIE, value: "", maxAge: 0 },
    { name: PENDING_COOKIE, value: "", maxAge: 0 },
  ];
}

// ---------- GraphQL ----------
export type CaResult<T> = { data: T | null; fieldErrors: string[] };

export async function caQuery<T>(query: string, variables?: Record<string, unknown>): Promise<CaResult<T>> {
  const session = getSession();
  if (!session) throw new CaAuthError("Niet ingelogd.");
  const endpoint = await discoverGraphqlEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Shopify docs: Authorization bevat alleen de token, zonder Bearer-prefix.
      Authorization: session.a,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new CaAuthError(`Customer Account API gaf ${res.status}.`);
  const json = (await res.json().catch(() => null)) as {
    data?: T | null;
    errors?: { message: string }[];
  } | null;
  if (!json) throw new CaAuthError("Ongeldige JSON-respons van Customer Account API.");
  const fieldErrors = (json.errors || []).map((e) => e.message);
  if (!json.data) throw new CaAuthError(fieldErrors[0] || "Geen data in respons.");
  return { data: json.data, fieldErrors };
}
