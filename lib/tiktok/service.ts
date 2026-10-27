import { getTiktokConfig, getTiktokPrivacyLevel, TIKTOK_API_BASE } from "./config";

export interface TiktokPostResult {
  publishId: string;
  mock: boolean;
}

/**
 * Exchanges the configured refresh_token for a fresh access_token right
 * before posting, rather than relying on the one stored in env (which
 * expires after 24h — see TIKTOK_TEST_ACCESS_TOKEN's expires_in from the
 * OAuth handshake). TikTok's refresh_token itself is long-lived, so this
 * is safe to call on every post without needing to persist a rotated
 * token back anywhere.
 */
async function refreshAccessToken(clientKey: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`TikTok token-refresh mislukt (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

/**
 * Polls /v2/post/publish/status/fetch/ until TikTok has finished
 * downloading the photo URLs and publishing the post, mirroring
 * lib/instagram/service.ts's pollUntilFinished (Instagram's container
 * processing is conceptually the same kind of async step).
 */
async function pollUntilPublished(publishId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = await res.json();
    const status = json?.data?.status;
    if (status === "PUBLISH_COMPLETE") return;
    if (status === "FAILED") {
      throw new Error(`TikTok kon de post niet verwerken (status FAILED): ${JSON.stringify(json)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`TikTok-post was na 15 pogingen nog niet "PUBLISH_COMPLETE" — later opnieuw proberen.`);
}

/**
 * Publishes a product's photos to TikTok as a photo-carousel Direct Post.
 * There is no "photo.publish" scope — TikTok's photo Direct Post endpoint
 * uses the same "video.publish" scope as video posts, just media_type:
 * "PHOTO" with an array of image URLs instead of a single video_url
 * (confirmed against developers.tiktok.com/doc/content-posting-api-reference-photo-post).
 *
 * imageUrls must be publicly fetchable by TikTok's servers (source:
 * "PULL_FROM_URL") — Shopify's CDN product image URLs already are.
 * TikTok allows up to 35 images per photo post; anything past that is
 * dropped rather than erroring the whole post over an excess photo.
 */
export async function postToTiktok(imageUrls: string[], title: string, description: string): Promise<TiktokPostResult> {
  const config = getTiktokConfig();

  if (config.mock) {
    return { publishId: `mock-${Date.now()}`, mock: true };
  }
  if (imageUrls.length === 0) {
    throw new Error("postToTiktok: geen afbeeldingen opgegeven.");
  }

  const accessToken = await refreshAccessToken(config.clientKey!, config.clientSecret!, config.refreshToken!);
  const photoImages = imageUrls.slice(0, 35);

  const initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/content/init/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      post_info: {
        title,
        description,
        privacy_level: getTiktokPrivacyLevel(),
        disable_comment: false,
        // Explicitly off — TikTok's "auto_add_music" attaches a random
        // trending track to photo posts by default, which isn't wanted
        // for a product listing.
        auto_add_music: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: photoImages,
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    }),
  });
  const initJson = await initRes.json();
  const publishId = initJson?.data?.publish_id;
  if (!initRes.ok || !publishId || initJson?.error?.code !== "ok") {
    throw new Error(`TikTok post aanmaken mislukt (${initRes.status}): ${JSON.stringify(initJson)}`);
  }

  await pollUntilPublished(publishId, accessToken);

  return { publishId, mock: false };
}
