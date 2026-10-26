import { getInstagramConfig, INSTAGRAM_GRAPH_API_VERSION } from "./config";

export interface InstagramPostResult {
  mediaId: string;
  mock: boolean;
}

/**
 * Publishes a single-image post to Instagram via the Graph API's two-step
 * Content Publishing flow: create a media container from a (publicly
 * reachable) image URL, then publish that container. Mirrors
 * lib/goedgeplaatst/service.ts's style (throw on real API errors, let the
 * caller — lib/instagram/autoSync.ts — decide how to log/swallow them).
 *
 * imageUrl must be publicly fetchable by Meta's servers — Shopify's CDN
 * product image URLs already are, no extra hosting needed.
 */
export async function postToInstagram(imageUrl: string, caption: string): Promise<InstagramPostResult> {
  const config = getInstagramConfig();

  if (config.mock) {
    return { mediaId: `mock-${Date.now()}`, mock: true };
  }

  // graph.instagram.com, not graph.facebook.com — this integration uses the
  // newer "Instagram API with Instagram Login" auth flow (token generated
  // directly against an Instagram Business account, no Facebook Page
  // involved), which calls a different host than the older Facebook-Login
  // based Instagram Graph API. Verified empirically: a token from that flow
  // only works against graph.instagram.com.
  const base = `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/${config.businessAccountId}`;

  const containerRes = await fetch(`${base}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: config.accessToken,
    }),
  });
  const containerJson = await containerRes.json();
  if (!containerRes.ok || !containerJson.id) {
    throw new Error(`Instagram media-container aanmaken mislukt (${containerRes.status}): ${JSON.stringify(containerJson)}`);
  }

  const publishRes = await fetch(`${base}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerJson.id,
      access_token: config.accessToken,
    }),
  });
  const publishJson = await publishRes.json();
  if (!publishRes.ok || !publishJson.id) {
    throw new Error(`Instagram publiceren mislukt (${publishRes.status}): ${JSON.stringify(publishJson)}`);
  }

  return { mediaId: publishJson.id, mock: false };
}

/** Deletes a specific Instagram media post — used to clean up test posts, never called from the auto-sync path itself. */
export async function deleteInstagramMedia(mediaId: string): Promise<void> {
  const config = getInstagramConfig();
  if (config.mock) return;

  const res = await fetch(`https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/${mediaId}?access_token=${encodeURIComponent(config.accessToken!)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram media verwijderen mislukt (${res.status}): ${body}`);
  }
}
