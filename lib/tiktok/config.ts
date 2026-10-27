// Configuration for the TikTok Content Posting API integration — auto-posts
// a new Shopify product to TikTok (as a photo-carousel Direct Post), mirroring
// the Instagram auto-sync (lib/instagram/autoSync.ts) triggered from the same
// webhook.
//
// Like Instagram, a successful TikTok publish is a real, user-visible action,
// so this supports a separate TEST TikTok Sandbox account/app (its own
// client key/secret/tokens) via TIKTOK_ENVIRONMENT, never silently falling
// back to the real account.
//
// MOCK MODE: without an access token configured for the active environment,
// mock mode is forced — same rule as lib/instagram/config.ts.
//
// Note: there is no "photo.publish" scope — TikTok's Content Posting API
// posts photo carousels using the same "video.publish" scope as video Direct
// Post, just a different media_type in the request body. Confirmed against
// TikTok's own docs (developers.tiktok.com/doc/content-posting-api-reference-photo-post).

function envString(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

export type TiktokEnvironment = "test" | "production";

export interface TiktokConfig {
  environment: TiktokEnvironment;
  clientKey: string | null;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  openId: string | null;
  mock: boolean;
}

export function getTiktokConfig(): TiktokConfig {
  const raw = (process.env.TIKTOK_ENVIRONMENT || "test").trim().toLowerCase();
  const environment: TiktokEnvironment = raw === "production" ? "production" : "test";

  const clientKey = environment === "production" ? envString("TIKTOK_CLIENT_KEY") : envString("TIKTOK_SANDBOX_CLIENT_KEY");
  const clientSecret = environment === "production" ? envString("TIKTOK_CLIENT_SECRET") : envString("TIKTOK_SANDBOX_CLIENT_SECRET");
  const accessToken = environment === "production" ? envString("TIKTOK_ACCESS_TOKEN") : envString("TIKTOK_TEST_ACCESS_TOKEN");
  const refreshToken = environment === "production" ? envString("TIKTOK_REFRESH_TOKEN") : envString("TIKTOK_TEST_REFRESH_TOKEN");
  const openId = environment === "production" ? envString("TIKTOK_OPEN_ID") : envString("TIKTOK_TEST_OPEN_ID");

  return {
    environment,
    clientKey,
    clientSecret,
    accessToken,
    refreshToken,
    openId,
    mock: !clientKey || !clientSecret || !accessToken || !refreshToken,
  };
}

/**
 * Privacy level for Direct Post. TikTok forces an unaudited app's Direct
 * Post content to SELF_ONLY (private, visible only to the poster) until
 * TikTok completes an app audit — see
 * developers.tiktok.com/application/content-posting-api. Defaulting to
 * SELF_ONLY here isn't just a workaround for that restriction, it's also
 * the right safe default: it matches the "never post for real without a
 * deliberate choice" posture used throughout this integration and
 * lib/instagram/config.ts.
 */
export function getTiktokPrivacyLevel(): string {
  return envString("TIKTOK_PRIVACY_LEVEL") || "SELF_ONLY";
}

export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
