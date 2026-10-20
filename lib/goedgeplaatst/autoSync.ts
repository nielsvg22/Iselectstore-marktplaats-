import { buildProductPreview } from "../marktplaats/orchestrator";
import { resolveGoedgeplaatstCategoryId } from "./categoryMap";
import { createConceptAd } from "./service";
import { logGoedgeplaatstSync } from "./logging";

/**
 * Automatically saves a new Shopify product as a GoedGeplaatst concept ad
 * — called from app/api/webhooks/products-create/route.ts so this happens
 * the moment a product is added, instead of someone having to open the
 * admin panel and click the button by hand.
 *
 * Deliberately mirrors the SAME constraints as the manual button and the
 * rest of this integration:
 *  - status is always "concept" (createConceptAd never does anything else —
 *    see lib/goedgeplaatst/config.ts's assertConceptStatusOnly/
 *    assertEndpointAllowed hard guards), so this can never publish anything
 *    or create a cost, same as a manual click.
 *  - idempotent via the existing shopify:<productId> link key — a retried
 *    webhook delivery (Shopify does retry) reuses the existing ad instead
 *    of creating a duplicate, exactly like clicking the button twice would.
 *  - best-effort: a product type with no GoedGeplaatst category mapping, a
 *    failed validation, or an API error is logged and swallowed here —
 *    never breaks the webhook response the rest of the route depends on.
 *
 * `forceImageResync`: when true and the product is already linked, pushes
 * the CURRENT Shopify image set to GoedGeplaatst via createConceptAd's
 * force path (POST /images/, replacing rather than adding) instead of the
 * normal no-op-on-already-linked short circuit. Used by the webhook handler
 * right after watermarkProductImages actually changed something on an
 * already-synced product — otherwise a product's GoedGeplaatst ad would
 * keep showing its pre-watermark photos forever, since nothing else ever
 * re-visits an already-linked product's images.
 */
export async function autoCreateGoedgeplaatstConceptAd(shopifyProductId: string, options?: { forceImageResync?: boolean }): Promise<void> {
  try {
    const preview = await buildProductPreview(shopifyProductId);

    const categoryId = resolveGoedgeplaatstCategoryId(preview.productType);
    if (categoryId === null) {
      // Not an error — plenty of product types simply have no GoedGeplaatst
      // mapping (yet). Nothing to log here, this is the expected path for
      // anything outside the known Apple product types.
      return;
    }

    if (!preview.validation.publishable) {
      await logGoedgeplaatstSync({
        linkKey: `shopify:${shopifyProductId}`,
        shopifyProductId,
        action: "auto_create_concept_ad",
        result: "error",
        message: "Validatie niet publiceerbaar — automatische GoedGeplaatst-concept overgeslagen.",
      });
      return;
    }

    const linkKey = `shopify:${shopifyProductId}`;
    const result = await createConceptAd({ linkKey, shopifyProductId, categoryId, preview, force: options?.forceImageResync });
    await logGoedgeplaatstSync({
      linkKey,
      shopifyProductId,
      goedgeplaatstAdId: result.adId,
      action: options?.forceImageResync ? "auto_resync_images" : "auto_create_concept_ad",
      result: "ok",
      message: result.reused ? "Al gekoppeld — bestaand concept hergebruikt." : `Concept automatisch aangemaakt${result.mock ? " (mock)" : ""}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logGoedgeplaatstSync({
      linkKey: `shopify:${shopifyProductId}`,
      shopifyProductId,
      action: "auto_create_concept_ad",
      result: "error",
      message,
    }).catch(() => {});
  }
}
