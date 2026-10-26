// Configuration for the Instagram Graph API "Content Publishing" integration
// — auto-posts a new Shopify product to Instagram, mirroring the GoedGeplaatst
// auto-sync (lib/goedgeplaatst/autoSync.ts) that's triggered from the same
// webhook. See lib/instagram/autoSync.ts for the actual posting logic.
//
// UNLIKE GoedGeplaatst, Instagram's API has no safe "concept/draft" mode —
// a successful publish call is immediately live and public. So this module
// supports pointing at a completely separate TEST Instagram Business account
// (its own credentials) while the integration is being built/verified, via
// INSTAGRAM_ENVIRONMENT — never silently falling back to the real account.
//
// MOCK MODE: without an access token configured for the active environment,
// mock mode is forced — there is no way to accidentally post for real
// without a real token, same rule as lib/goedgeplaatst/config.ts.

function envString(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

export type InstagramEnvironment = "test" | "production";

export interface InstagramConfig {
  environment: InstagramEnvironment;
  businessAccountId: string | null;
  accessToken: string | null;
  mock: boolean;
}

export function getInstagramConfig(): InstagramConfig {
  const raw = (process.env.INSTAGRAM_ENVIRONMENT || "test").trim().toLowerCase();
  const environment: InstagramEnvironment = raw === "production" ? "production" : "test";

  const businessAccountId = environment === "production" ? envString("INSTAGRAM_BUSINESS_ACCOUNT_ID") : envString("INSTAGRAM_TEST_BUSINESS_ACCOUNT_ID");
  const accessToken = environment === "production" ? envString("INSTAGRAM_ACCESS_TOKEN") : envString("INSTAGRAM_TEST_ACCESS_TOKEN");

  return {
    environment,
    businessAccountId,
    accessToken,
    mock: !businessAccountId || !accessToken,
  };
}

/** Graph API version — bump here only, after checking Meta's current deprecation schedule. */
export const INSTAGRAM_GRAPH_API_VERSION = "v21.0";
