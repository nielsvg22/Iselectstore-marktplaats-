import { buildProductPreview } from "../marktplaats/orchestrator";
import { postToFacebook } from "./service";
import { buildFacebookCaption } from "./captionBuilder";
import { getFacebookConfig } from "./config";
import { logSync } from "../logging";
import { query } from "../db";

/**
 * Same Shopify-CDN-crop reasoning as lib/instagram/autoSync.ts's
 * toInstagramSafeImageUrl — Facebook is less strict about aspect ratio
 * than Instagram, but a consistent square render avoids any edge-case
 * rejection on unusually tall product photos.
 */
function toFacebookSafeImageUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("width", "1080");
  u.searchParams.set("height", "1080");
  u.searchParams.set("crop", "center");
  return u.toString();
}

/**
 * Automatically posts a new Shopify product to the Facebook Page — called
 * from the same webhooks as autoPostProductToInstagram/Tiktok, same shape:
 *  - idempotent: atomic claim via INSERT ... ON CONFLICT DO NOTHING on
 *    facebook_post, same race-condition fix as the Instagram/TikTok
 *    versions (see their comments for the concurrent-webhook-delivery
 *    story this guards against).
 *  - best-effort: failures are logged and swallowed, never break the
 *    webhook response.
 *  - mock until FACEBOOK_TEST_PAGE_ID/TOKEN (or the production pair) are
 *    configured — see lib/facebook/config.ts.
 */
export async function autoPostProductToFacebook(shopifyProductId: string): Promise<void> {
  let claimed = false;
  try {
    const claim = await query<{ id: number }>(
      `INSERT INTO facebook_post (shopify_product_id, facebook_post_id, environment, mock)
       VALUES ($1, NULL, 'pending', false)
       ON CONFLICT (shopify_product_id) DO NOTHING
       RETURNING id`,
      [shopifyProductId]
    );
    if (claim.length === 0) return;
    claimed = true;

    const delaySeconds = Number(process.env.FACEBOOK_POST_DELAY_SECONDS || 25);
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }

    const preview = await buildProductPreview(shopifyProductId);
    if (!preview.validation.publishable) {
      await query("DELETE FROM facebook_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "facebook_auto_post_skipped",
        message: "Validatie niet publiceerbaar — automatische Facebook-post overgeslagen.",
      });
      return;
    }
    if (preview.imageUrls.length === 0) {
      await query("DELETE FROM facebook_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "facebook_auto_post_skipped",
        message: "Geen productfoto's — Facebook-post vereist minstens één afbeelding.",
      });
      return;
    }

    const caption = buildFacebookCaption(preview);
    const config = getFacebookConfig();
    const result = await postToFacebook(preview.imageUrls.map(toFacebookSafeImageUrl), caption);

    await query(`UPDATE facebook_post SET facebook_post_id = $2, environment = $3, mock = $4 WHERE shopify_product_id = $1`, [
      shopifyProductId,
      result.postId,
      config.environment,
      result.mock,
    ]);

    await logSync({
      shopifyProductId,
      action: "facebook_auto_post",
      message: `Automatisch gepost naar Facebook (${config.environment}${result.mock ? ", mock" : ""}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (claimed) {
      await query("DELETE FROM facebook_post WHERE shopify_product_id = $1", [shopifyProductId]).catch(() => {});
    }
    await logSync({ shopifyProductId, action: "facebook_auto_post_error", message }).catch(() => {});
  }
}
