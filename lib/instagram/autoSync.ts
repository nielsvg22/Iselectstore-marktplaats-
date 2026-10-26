import { buildProductPreview } from "../marktplaats/orchestrator";
import { postToInstagram } from "./service";
import { buildInstagramCaption } from "./captionBuilder";
import { getInstagramConfig } from "./config";
import { logSync } from "../logging";
import { query } from "../db";

/**
 * Automatically posts a new Shopify product to Instagram — called from
 * app/api/webhooks/products-create/route.ts, right alongside
 * autoCreateGoedgeplaatstConceptAd, so this happens the moment a product is
 * added. Mirrors that module's shape and guarantees:
 *  - idempotent: a `instagram_post` row already existing for this product
 *    means "already posted", never double-posts on a retried webhook
 *    delivery (Shopify does retry) or a later products-update firing.
 *  - best-effort: any failure is logged and swallowed here — never breaks
 *    the webhook response the rest of the route depends on.
 *  - UNLIKE GoedGeplaatst there is no safe "concept only" mode on Instagram's
 *    side — see lib/instagram/config.ts's INSTAGRAM_ENVIRONMENT switch,
 *    which is how this stays pointed at a harmless test account until the
 *    real one's credentials are deliberately swapped in.
 */
export async function autoPostProductToInstagram(shopifyProductId: string): Promise<void> {
  try {
    const already = await query<{ id: number }>("SELECT id FROM instagram_post WHERE shopify_product_id = $1", [shopifyProductId]);
    if (already.length > 0) return;

    const preview = await buildProductPreview(shopifyProductId);
    if (!preview.validation.publishable) {
      await logSync({
        shopifyProductId,
        action: "instagram_auto_post_skipped",
        message: "Validatie niet publiceerbaar — automatische Instagram-post overgeslagen.",
      });
      return;
    }
    if (preview.imageUrls.length === 0) {
      await logSync({
        shopifyProductId,
        action: "instagram_auto_post_skipped",
        message: "Geen productfoto's — Instagram-post vereist minstens één afbeelding.",
      });
      return;
    }

    const caption = buildInstagramCaption(preview);
    const config = getInstagramConfig();
    const result = await postToInstagram(preview.imageUrls[0], caption);

    await query(
      `INSERT INTO instagram_post (shopify_product_id, instagram_media_id, environment, mock)
       VALUES ($1, $2, $3, $4)`,
      [shopifyProductId, result.mediaId, config.environment, result.mock]
    );

    await logSync({
      shopifyProductId,
      action: "instagram_auto_post",
      message: `Automatisch gepost naar Instagram (${config.environment}${result.mock ? ", mock" : ""}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({
      shopifyProductId,
      action: "instagram_auto_post_error",
      message,
    }).catch(() => {});
  }
}
