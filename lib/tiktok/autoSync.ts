import { buildProductPreview } from "../marktplaats/orchestrator";
import { postToTiktok } from "./service";
import { buildTiktokCaption } from "./captionBuilder";
import { getTiktokConfig } from "./config";
import { logSync } from "../logging";
import { query } from "../db";

/**
 * TikTok's PULL_FROM_URL photo source needs a reasonably sized, roughly
 * square image — reusing the same Shopify CDN crop transform as
 * lib/instagram/autoSync.ts's toInstagramSafeImageUrl for the same reason:
 * this shop's product photos are often tall, full-length shots.
 *
 * TikTok also requires the image URL's own domain to be a verified
 * property of the app — confirmed live (403 url_ownership_unverified)
 * when passing the raw cdn.shopify.com URL. We don't control Shopify's
 * CDN domain, so this routes the (already cropped) URL through
 * app/api/tiktok/image-proxy, which re-serves it from our own verified
 * backend domain instead.
 */
function toTiktokSafeImageUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("width", "1080");
  u.searchParams.set("height", "1080");
  u.searchParams.set("crop", "center");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) return u.toString();
  return `${appUrl}/api/tiktok/image-proxy?url=${encodeURIComponent(u.toString())}`;
}

/**
 * Automatically posts a new Shopify product to TikTok — called from
 * app/api/webhooks/products-create/route.ts and products-update/route.ts,
 * right alongside autoPostProductToInstagram. Mirrors that module's shape
 * and guarantees exactly the same way:
 *  - idempotent: a `tiktok_post` row already existing for this product
 *    means "already posted" — uses the same atomic
 *    INSERT ... ON CONFLICT DO NOTHING RETURNING claim pattern as
 *    lib/instagram/autoSync.ts, which fixed a real race condition there
 *    (Shopify fires a products/update webhook delivery per photo added
 *    during product creation, so several deliveries can be in flight for
 *    the same product at once — a plain SELECT-then-INSERT lets every one
 *    of them post for real).
 *  - best-effort: any failure is logged and swallowed here — never breaks
 *    the webhook response the rest of the route depends on.
 *  - points at a separate TEST TikTok Sandbox app/account until
 *    TIKTOK_ENVIRONMENT is deliberately switched to production — see
 *    lib/tiktok/config.ts.
 */
export async function autoPostProductToTiktok(shopifyProductId: string): Promise<void> {
  let claimed = false;
  try {
    const claim = await query<{ id: number }>(
      `INSERT INTO tiktok_post (shopify_product_id, tiktok_publish_id, environment, mock)
       VALUES ($1, NULL, 'pending', false)
       ON CONFLICT (shopify_product_id) DO NOTHING
       RETURNING id`,
      [shopifyProductId]
    );
    if (claim.length === 0) return; // another delivery already claimed/posted this product
    claimed = true;

    // Grace period before actually fetching+posting — see the identical
    // comment in lib/instagram/autoSync.ts's autoPostProductToInstagram
    // for why: whichever webhook delivery wins the claim above would
    // otherwise post immediately with whatever subset of photos existed
    // at that exact moment (confirmed live: a product posted to TikTok
    // with only 2 of several photos). The webhook route calls this
    // function without awaiting it specifically so this delay never holds
    // up the webhook response.
    const delaySeconds = Number(process.env.TIKTOK_POST_DELAY_SECONDS || 25);
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }

    const preview = await buildProductPreview(shopifyProductId);
    if (!preview.validation.publishable) {
      await query("DELETE FROM tiktok_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "tiktok_auto_post_skipped",
        message: "Validatie niet publiceerbaar — automatische TikTok-post overgeslagen.",
      });
      return;
    }
    if (preview.imageUrls.length === 0) {
      await query("DELETE FROM tiktok_post WHERE shopify_product_id = $1", [shopifyProductId]);
      await logSync({
        shopifyProductId,
        action: "tiktok_auto_post_skipped",
        message: "Geen productfoto's — TikTok-post vereist minstens één afbeelding.",
      });
      return;
    }

    const caption = buildTiktokCaption(preview);
    const config = getTiktokConfig();
    const result = await postToTiktok(preview.imageUrls.map(toTiktokSafeImageUrl), caption.title, caption.description);

    await query(
      `UPDATE tiktok_post SET tiktok_publish_id = $2, environment = $3, mock = $4 WHERE shopify_product_id = $1`,
      [shopifyProductId, result.publishId, config.environment, result.mock]
    );

    await logSync({
      shopifyProductId,
      action: "tiktok_auto_post",
      message: `Automatisch gepost naar TikTok (${config.environment}${result.mock ? ", mock" : ""}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (claimed) {
      await query("DELETE FROM tiktok_post WHERE shopify_product_id = $1", [shopifyProductId]).catch(() => {});
    }
    await logSync({
      shopifyProductId,
      action: "tiktok_auto_post_error",
      message,
    }).catch(() => {});
  }
}
