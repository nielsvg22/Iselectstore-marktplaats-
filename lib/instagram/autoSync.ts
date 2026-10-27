import { buildProductPreview } from "../marktplaats/orchestrator";
import { postToInstagram } from "./service";
import { buildInstagramCaption } from "./captionBuilder";
import { getInstagramConfig } from "./config";
import { logSync } from "../logging";
import { query } from "../db";

/**
 * Instagram rejects images outside roughly 4:5–1.91:1 — this shop's product
 * photos are often full-length, near-2:1 tall shots (e.g. a real one seen
 * at 1320x2868, ratio 0.46), well outside that range. Shopify's CDN crop
 * transform (width/height/crop=center) reliably produces an exact square
 * render — verified empirically against a real product image URL — so this
 * is applied unconditionally rather than only when the ratio looks risky,
 * keeping the behavior simple and consistent across every post.
 */
function toInstagramSafeImageUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("width", "1080");
  u.searchParams.set("height", "1080");
  u.searchParams.set("crop", "center");
  return u.toString();
}

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
  let claimed = false;
  try {
    // Atomically claim this product BEFORE doing anything slow — Shopify
    // fires a products/update webhook delivery per photo added during the
    // quick-create flow, so several deliveries can be in flight for the
    // same product at once. A plain "SELECT, then INSERT after posting"
    // has a race window: every concurrent delivery passes the SELECT
    // before any of them finishes the INSERT, so every one of them posts
    // to Instagram for real — confirmed live (6 concurrent deliveries → 6
    // real posts, with 5 INSERTs failing afterward on the unique
    // constraint, silently, since by then the damage was already done).
    // INSERT ... ON CONFLICT DO NOTHING is atomic: only the delivery that
    // actually wins the row proceeds to post.
    const claim = await query<{ id: number }>(
      `INSERT INTO instagram_post (shopify_product_id, instagram_media_id, environment, mock)
       VALUES ($1, NULL, 'pending', false)
       ON CONFLICT (shopify_product_id) DO NOTHING
       RETURNING id`,
      [shopifyProductId]
    );
    if (claim.length === 0) return; // another delivery already claimed/posted this product
    claimed = true;

    const preview = await buildProductPreview(shopifyProductId);
    if (!preview.validation.publishable) {
      await query("DELETE FROM instagram_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "instagram_auto_post_skipped",
        message: "Validatie niet publiceerbaar — automatische Instagram-post overgeslagen.",
      });
      return;
    }
    if (preview.imageUrls.length === 0) {
      await query("DELETE FROM instagram_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "instagram_auto_post_skipped",
        message: "Geen productfoto's — Instagram-post vereist minstens één afbeelding.",
      });
      return;
    }

    const caption = buildInstagramCaption(preview);
    const config = getInstagramConfig();
    const result = await postToInstagram(preview.imageUrls.map(toInstagramSafeImageUrl), caption);

    await query(
      `UPDATE instagram_post SET instagram_media_id = $2, environment = $3, mock = $4 WHERE shopify_product_id = $1`,
      [shopifyProductId, result.mediaId, config.environment, result.mock]
    );

    await logSync({
      shopifyProductId,
      action: "instagram_auto_post",
      message: `Automatisch gepost naar Instagram (${config.environment}${result.mock ? ", mock" : ""}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Release the claim on failure so a later, legitimate retry (e.g. once
    // whatever broke is fixed) isn't permanently blocked by a dead row —
    // same trade-off skip/validation paths above already make.
    if (claimed) {
      await query("DELETE FROM instagram_post WHERE shopify_product_id = $1", [shopifyProductId]).catch(() => {});
    }
    await logSync({
      shopifyProductId,
      action: "instagram_auto_post_error",
      message,
    }).catch(() => {});
  }
}
