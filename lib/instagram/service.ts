import { getInstagramConfig, INSTAGRAM_GRAPH_API_VERSION } from "./config";

export interface InstagramPostResult {
  mediaId: string;
  mock: boolean;
}

/**
 * Instagram processes a media container asynchronously after creation —
 * publishing (or attaching it as a carousel child) immediately can hit
 * "Media ID is not available" (seen live: error_subcode 2207027) if the
 * container isn't FINISHED yet. Shared by both the single-image and
 * carousel-child containers below.
 */
async function pollUntilFinished(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const statusRes = await fetch(`https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
    const statusJson = await statusRes.json();
    if (statusJson.status_code === "FINISHED") return;
    if (statusJson.status_code === "ERROR") {
      throw new Error(`Instagram kon de media-container niet verwerken (status ERROR): ${JSON.stringify(statusJson)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Instagram media-container was na 15 pogingen nog niet "FINISHED" — later opnieuw proberen.`);
}

/**
 * Publishes a post to Instagram via the Graph API's Content Publishing
 * flow. A single image_urls entry posts as a normal photo post; 2+ entries
 * post as a carousel (create each child container with is_carousel_item,
 * then a parent CAROUSEL container referencing them, then publish) —
 * Instagram allows 2-10 images per carousel, so anything past the 10th is
 * dropped rather than erroring the whole post over an excess photo.
 *
 * image_urls must be publicly fetchable by Meta's servers — Shopify's CDN
 * product image URLs already are, no extra hosting needed.
 */
export async function postToInstagram(imageUrls: string[], caption: string): Promise<InstagramPostResult> {
  const config = getInstagramConfig();

  if (config.mock) {
    return { mediaId: `mock-${Date.now()}`, mock: true };
  }
  if (imageUrls.length === 0) {
    throw new Error("postToInstagram: geen afbeeldingen opgegeven.");
  }

  // graph.instagram.com, not graph.facebook.com — this integration uses the
  // newer "Instagram API with Instagram Login" auth flow (token generated
  // directly against an Instagram Business account, no Facebook Page
  // involved), which calls a different host than the older Facebook-Login
  // based Instagram Graph API. Verified empirically: a token from that flow
  // only works against graph.instagram.com.
  const base = `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/${config.businessAccountId}`;
  const accessToken = config.accessToken!;

  let publishCreationId: string;

  if (imageUrls.length === 1) {
    const containerRes = await fetch(`${base}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrls[0], caption, access_token: accessToken }),
    });
    const containerJson = await containerRes.json();
    if (!containerRes.ok || !containerJson.id) {
      throw new Error(`Instagram media-container aanmaken mislukt (${containerRes.status}): ${JSON.stringify(containerJson)}`);
    }
    await pollUntilFinished(containerJson.id, accessToken);
    publishCreationId = containerJson.id;
  } else {
    const images = imageUrls.slice(0, 10);
    const childIds: string[] = [];
    for (const imageUrl of images) {
      const childRes = await fetch(`${base}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: accessToken }),
      });
      const childJson = await childRes.json();
      if (!childRes.ok || !childJson.id) {
        throw new Error(`Instagram carrousel-item aanmaken mislukt (${childRes.status}): ${JSON.stringify(childJson)}`);
      }
      await pollUntilFinished(childJson.id, accessToken);
      childIds.push(childJson.id);
    }

    const carouselRes = await fetch(`${base}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "CAROUSEL", children: childIds, caption, access_token: accessToken }),
    });
    const carouselJson = await carouselRes.json();
    if (!carouselRes.ok || !carouselJson.id) {
      throw new Error(`Instagram carrousel aanmaken mislukt (${carouselRes.status}): ${JSON.stringify(carouselJson)}`);
    }
    await pollUntilFinished(carouselJson.id, accessToken);
    publishCreationId = carouselJson.id;
  }

  const publishRes = await fetch(`${base}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: publishCreationId, access_token: accessToken }),
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
