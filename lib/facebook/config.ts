// Configuration for the Facebook Graph API Page-posting integration — auto-
// posts a new Shopify product to the iSelectStore Facebook Page, mirroring
// lib/instagram/config.ts and lib/tiktok/config.ts exactly. This is
// separate from the official "Facebook and Instagram by Meta" Shopify
// sales channel app (which handles the product catalog for ads/retargeting)
// — this module posts a regular feed post with photos, like a human
// manually posting to the Page.
//
// Same safety rule as the other two: a successful post is immediately
// public, so this supports a separate TEST Facebook Page (its own page
// id/token) via FACEBOOK_ENVIRONMENT, never silently falling back to the
// real page. MOCK MODE: without a page id + token configured for the
// active environment, mock mode is forced — same as Instagram/TikTok.

function envString(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

export type FacebookEnvironment = "test" | "production";

export interface FacebookConfig {
  environment: FacebookEnvironment;
  pageId: string | null;
  pageAccessToken: string | null;
  mock: boolean;
}

export function getFacebookConfig(): FacebookConfig {
  const raw = (process.env.FACEBOOK_ENVIRONMENT || "test").trim().toLowerCase();
  const environment: FacebookEnvironment = raw === "production" ? "production" : "test";

  const pageId = environment === "production" ? envString("FACEBOOK_PAGE_ID") : envString("FACEBOOK_TEST_PAGE_ID");
  const pageAccessToken = environment === "production" ? envString("FACEBOOK_PAGE_ACCESS_TOKEN") : envString("FACEBOOK_TEST_PAGE_ACCESS_TOKEN");

  return {
    environment,
    pageId,
    pageAccessToken,
    mock: !pageId || !pageAccessToken,
  };
}

/** Graph API version — bump here only, after checking Meta's current deprecation schedule. Kept in sync with lib/instagram/config.ts's INSTAGRAM_GRAPH_API_VERSION. */
export const FACEBOOK_GRAPH_API_VERSION = "v21.0";
