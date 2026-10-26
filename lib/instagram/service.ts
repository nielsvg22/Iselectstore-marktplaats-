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

  // Instagram processes the image asynchronously after container creation —
  // publishing immediately can hit "Media ID is not available" (seen live:
  // error_subcode 2207027) if the container isn't FINISHED yet. Poll status
  // before publishing, same pattern as lib/shopify/client.ts's file
  // processing poll.
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const statusRes = await fetch(`https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/${containerJson.id}?fields=status_code&access_token=${encodeURIComponent(config.accessToken!)}`);
    const statusJson = await statusRes.json();
    if (statusJson.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (statusJson.status_code === "ERROR") {
      throw new Error(`Instagram kon de media-container niet verwerken (status ERROR): ${JSON.stringify(statusJson)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!ready) {
    throw new Error(`Instagram media-container was na 15 pogingen nog niet "FINISHED" — later opnieuw proberen.`);
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
