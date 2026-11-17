import { getFacebookConfig, FACEBOOK_GRAPH_API_VERSION } from "./config";

export interface FacebookPostResult {
  postId: string;
  mock: boolean;
}

/**
 * Posts a new feed post with one or more photos to the iSelectStore
 * Facebook Page, via the Graph API. Mirrors lib/instagram/service.ts's
 * postToInstagram shape.
 *
 * For a single image: one call to /{page-id}/photos with published=true
 * posts it directly as a photo post with the caption.
 *
 * For multiple images: each photo is first uploaded unpublished
 * (published=false, no_story=true) to get a media fbid, then a single
 * /{page-id}/feed call attaches all of them as one multi-photo post —
 * this is the standard Graph API pattern for a Facebook photo album post
 * (there's no single "carousel" endpoint like Instagram's).
 */
export async function postToFacebook(imageUrls: string[], caption: string): Promise<FacebookPostResult> {
  const config = getFacebookConfig();

  if (config.mock) {
    return { postId: `mock-${Date.now()}`, mock: true };
  }
  if (imageUrls.length === 0) {
    throw new Error("postToFacebook: geen afbeeldingen opgegeven.");
  }

  const base = `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${config.pageId}`;
  const accessToken = config.pageAccessToken!;

  if (imageUrls.length === 1) {
    const res = await fetch(`${base}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrls[0], caption, published: true, access_token: accessToken }),
    });
    const json = await res.json();
    if (!res.ok || !json.post_id) {
      throw new Error(`Facebook foto-post aanmaken mislukt (${res.status}): ${JSON.stringify(json)}`);
    }
    return { postId: json.post_id, mock: false };
  }

  const mediaFbids: string[] = [];
  for (const imageUrl of imageUrls) {
    const res = await fetch(`${base}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, published: false, no_story: true, access_token: accessToken }),
    });
    const json = await res.json();
    if (!res.ok || !json.id) {
      throw new Error(`Facebook foto uploaden (unpublished) mislukt (${res.status}): ${JSON.stringify(json)}`);
    }
    mediaFbids.push(json.id);
  }

  const feedRes = await fetch(`${base}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: caption,
      attached_media: mediaFbids.map((id) => ({ media_fbid: id })),
      access_token: accessToken,
    }),
  });
  const feedJson = await feedRes.json();
  if (!feedRes.ok || !feedJson.id) {
    throw new Error(`Facebook album-post aanmaken mislukt (${feedRes.status}): ${JSON.stringify(feedJson)}`);
  }
  return { postId: feedJson.id, mock: false };
}

/** Deletes a specific Facebook post — used to clean up test posts, never called from the auto-sync path itself. */
export async function deleteFacebookPost(postId: string): Promise<void> {
  const config = getFacebookConfig();
  if (config.mock) return;

  const res = await fetch(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${postId}?access_token=${encodeURIComponent(config.pageAccessToken!)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook post verwijderen mislukt (${res.status}): ${body}`);
  }
}
