// Configuration + hard safety guards for the GoedGeplaatst REST API
// integration — the OFFICIAL, second placement route alongside the existing
// Playwright browser test (lib/marktplaats/browserTest/) and the Admarkt
// XML feed (lib/marktplaats/feedBuilder.ts). None of these three paths
// replace each other.
//
// Endpoints/field names below are taken from the GoedGeplaatst REST v1 docs
// (docs.goedgeplaatst.nl/api/rest/v1/) as verified and handed over for this
// task on 2026-10-12. Two documented inconsistencies this module/its
// siblings deliberately resolve (see client.ts and mapper.ts for the
// reasoning):
//   1. The authentication example in the docs shows `POST /advertisements/`
//      while the dedicated resource page uses `/ads/` — we use `/ads/`.
//   2. The docs show both `POST /images/` (replaces all images) and
//      `PUT /images/<adId>` (adds images) — we only ever call the PUT
//      variant, because POST /ads/5 already created an advertisement with
//      allowed-to-be-added-later-but-never-replaced images.
//
// MOCK MODE: this file is also the single place that decides whether we are
// "live" or "mock". Without GOEDGEPLAATST_API_KEY set, mock mode is forced
// regardless of GOEDGEPLAATST_ENVIRONMENT — there is no way to accidentally
// show a real "Verbonden" status without a real key.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return fallback;
  return TRUTHY.has(value);
}

function envString(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

export type GoedgeplaatstEnvironment = "sandbox" | "production";

export interface ManufacturerInfo {
  tradename: string | null;
  address: string | null;
  email: string | null;
}

export interface GoedgeplaatstConfig {
  /** Default: sandbox. Production actions stay opt-in (rule from STAP 11). */
  environment: GoedgeplaatstEnvironment;
  /** Never exposed to the client — only "apiKeyConfigured" booleans are. */
  apiKey: string | null;
  userId: number | null;
  baseUrl: string;
  /**
   * True only when there is a real API key. Every service function in this
   * feature must check this (or call isMockMode()) before doing a real
   * fetch — without it, mock data is returned instead, clearly labeled.
   */
  hasApiKey: boolean;
  /**
   * Per STAP 3: DSA/GPSR-mandatory manufacturer attributes
   * (manufacturerTradename, manufacturerAddress, manufacturerEmail) since
   * 1 Feb 2025. Read from env, never invented.
   */
  manufacturer: ManufacturerInfo;
  requestTimeoutMs: number;
  allowPublish: boolean;
}

export function getGoedgeplaatstConfig(): GoedgeplaatstConfig {
  const envRaw = (envString("GOEDGEPLAATST_ENVIRONMENT") ?? "sandbox").toLowerCase();
  const environment: GoedgeplaatstEnvironment = envRaw === "production" ? "production" : "sandbox";

  const apiKey = envString("GOEDGEPLAATST_API_KEY");
  const userIdRaw = envString("GOEDGEPLAATST_USER_ID");
  const userId = userIdRaw && Number.isFinite(Number(userIdRaw)) ? Number(userIdRaw) : null;

  return {
    environment,
    apiKey,
    userId,
    baseUrl: environment === "production" ? "https://api.goedgeplaatst.nl/rest/v1/" : "https://dev-api.goedgeplaatst.nl/rest/v1/",
    hasApiKey: Boolean(apiKey) && Boolean(userId),
    manufacturer: {
      tradename: envString("GOEDGEPLAATST_MANUFACTURER_TRADENAME"),
      address: envString("GOEDGEPLAATST_MANUFACTURER_ADDRESS"),
      email: envString("GOEDGEPLAATST_MANUFACTURER_EMAIL"),
    },
    requestTimeoutMs: 15_000,
    // Explicit, separate opt-in to actually publish a concept ad to a real
    // portal (POST /publish/) — mirrors MARKTPLAATS_BROWSER_ALLOW_SUBMIT's
    // pattern in lib/marktplaats/browserTest/config.ts exactly. Default
    // false: the hard guard below (assertEndpointAllowed) still rejects
    // every /publish/ call unless this is explicitly true. A real
    // publication puts a real, public ad on Marktplaats and can incur real
    // costs on the account — never flip this without the account holder's
    // explicit, informed confirmation for that specific action.
    allowPublish: envFlag("GOEDGEPLAATST_ALLOW_PUBLISH", false),
  };
}

/** Mock mode is forced whenever there is no real key — never a user choice. */
export function isGoedgeplaatstMockMode(): boolean {
  return !getGoedgeplaatstConfig().hasApiKey;
}

/**
 * HARD GUARD: by default, no code path in this feature may call a publish
 * endpoint — deliberately independent of which paths the client happens to
 * implement, so a future edit can't accidentally wire one up without this
 * guard tripping first. The ONE exception is an explicit, separately-gated
 * publish action (GOEDGEPLAATST_ALLOW_PUBLISH=true, see getGoedgeplaatstConfig)
 * — even then, only lib/goedgeplaatst/service.ts's publishAdToMarktplaats()
 * is meant to ever hit this path; every other call site still goes through
 * this same check with the flag off.
 */
const FORBIDDEN_PATH_PATTERN = /(^|\/)publish(\/|$)/i;

export class ForbiddenEndpointError extends Error {
  readonly code = "GOEDGEPLAATST_PUBLISH_FORBIDDEN";
  constructor(path: string) {
    super(
      `GoedGeplaatst-endpoint "${path}" is geblokkeerd — alleen conceptadvertenties, tenzij GOEDGEPLAATST_ALLOW_PUBLISH expliciet op true staat.`
    );
    this.name = "ForbiddenEndpointError";
  }
}

export function assertEndpointAllowed(path: string): void {
  if (FORBIDDEN_PATH_PATTERN.test(path) && !getGoedgeplaatstConfig().allowPublish) {
    throw new ForbiddenEndpointError(path);
  }
}

/** Only one advertisement status is ever allowed to be written in this version. */
export function assertConceptStatusOnly(status: string): void {
  if (status !== "concept") {
    throw new Error(`Status "${status}" is niet toegestaan — deze versie mag advertenties uitsluitend als "concept" opslaan.`);
  }
}

export const RATE_LIMIT = {
  // Per docs.goedgeplaatst.nl: 3 requests/second sustained, burst of 10.
  sustainedPerSecond: 3,
  burst: 10,
};

export function manufacturerConfigured(m: ManufacturerInfo): boolean {
  return Boolean(m.tradename && m.address && m.email);
}
