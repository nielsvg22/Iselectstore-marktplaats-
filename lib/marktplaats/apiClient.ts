// Real Marktplaats API v2 client. Endpoints and field names verified against
// the official docs on 2026-09-27:
//   https://api.marktplaats.nl/docs/v2/authentication.html
//   https://api.marktplaats.nl/docs/v2/category.html
//   https://api.marktplaats.nl/docs/v2/category-attributes.html
//   https://api.marktplaats.nl/docs/v2/advertisement.html
//
// IMPORTANT (per docs): a client-credentials token can only reach public /
// client-scoped resources. Placing or updating an advertisement requires a
// USER token (OAuth authorization-code flow, consented by the actual seller
// account) — see oauth.ts. Never assume otherwise.

import { MarktplaatsAdvertisement, MarktplaatsAdvertisementPayload, MarktplaatsCategory, MarktplaatsCategoryAttribute } from "./types";

function getEnvironment(): "mock" | "sandbox" | "production" {
  const env = process.env.MARKTPLAATS_ENVIRONMENT || "mock";
  if (env !== "mock" && env !== "sandbox" && env !== "production") {
    throw new Error(`Invalid MARKTPLAATS_ENVIRONMENT: ${env}`);
  }
  return env;
}

function apiBaseUrl(): string {
  // Sandbox base URL is not published for the generic api.marktplaats.nl host
  // in the public docs excerpt we could verify — only the sandbox *auth*
  // hosts (auth.demo.qa-mp.so) are documented. Confirm the sandbox API base
  // URL with Marktplaats support before relying on this for `sandbox` mode.
  return "https://api.marktplaats.nl/v2";
}

function tokenUrl(): string {
  const env = getEnvironment();
  return env === "sandbox" ? "https://auth.demo.qa-mp.so/accounts/oauth/token" : "https://auth.marktplaats.nl/accounts/oauth/token";
}

export class MarktplaatsApiError extends Error {
  constructor(message: string, public httpStatus?: number, public errorCode?: string) {
    super(message);
  }
}

async function authorizedFetch(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MarktplaatsApiError(`Marktplaats API ${res.status}: ${body}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** GET /v2/categories/{l1}/{l2}/attributes */
export async function fetchCategoryAttributes(l1: string, l2: string, accessToken: string): Promise<MarktplaatsCategoryAttribute[]> {
  const data = await authorizedFetch(`/categories/${l1}/${l2}/attributes`, accessToken);
  return (data?._embedded?.["mp:category-attribute"] ?? data?.attributes ?? data) as MarktplaatsCategoryAttribute[];
}

/** GET /v2/categories */
export async function fetchCategories(accessToken: string): Promise<MarktplaatsCategory[]> {
  const data = await authorizedFetch(`/categories`, accessToken);
  return (data?._embedded?.["mp:category"] ?? data) as MarktplaatsCategory[];
}

/** POST /v2/advertisements — requires a USER access token. */
export async function createAdvertisement(payload: MarktplaatsAdvertisementPayload, userAccessToken: string): Promise<MarktplaatsAdvertisement> {
  return authorizedFetch(`/advertisements`, userAccessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** GET /v2/advertisements/{itemId} */
export async function getAdvertisement(itemId: string, userAccessToken: string): Promise<MarktplaatsAdvertisement> {
  return authorizedFetch(`/advertisements/${itemId}`, userAccessToken);
}

/** DELETE /v2/advertisements/{itemId} — closes/removes the ad. */
export async function deleteAdvertisement(itemId: string, userAccessToken: string): Promise<void> {
  await authorizedFetch(`/advertisements/${itemId}`, userAccessToken, { method: "DELETE" });
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

/** Client-credentials grant — public/client-scoped resources only (categories, category-attributes). */
export async function exchangeClientCredentials(clientId: string, clientSecret: string): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    throw new MarktplaatsApiError(`Token exchange failed: ${res.status} ${await res.text()}`, res.status);
  }
  return res.json();
}

/** Authorization-code grant — required for USER tokens that can post ads. */
export async function exchangeAuthorizationCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new MarktplaatsApiError(`Authorization code exchange failed: ${res.status} ${await res.text()}`, res.status);
  }
  return res.json();
}

export async function refreshUserToken(clientId: string, clientSecret: string, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new MarktplaatsApiError(`Token refresh failed: ${res.status} ${await res.text()}`, res.status);
  }
  return res.json();
}
