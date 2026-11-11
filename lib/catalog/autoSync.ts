import { setVariantMetafield, setProductMetafields } from "../shopify/client";
import { catalogConditionForProductType } from "./condition";
import { logSync } from "../logging";

/**
 * Sets the product `condition` attribute for both sales channels, derived
 * automatically from the Shopify product type — so nobody has to pick this
 * per product, and it's never left on a platform's default ("new") by
 * accident. Called from the create/update webhooks, same place
 * watermarking and the other auto-sync features run; safe to call
 * repeatedly (always just overwrites to the correct value).
 *
 * Google: the "Google & YouTube" channel reads this automatically from the
 * variant's mm-google-shopping.condition metafield — no further setup
 * needed on Shopify's side once that channel is installed.
 *
 * Meta: unlike Google, the "Facebook and Instagram by Meta" channel has no
 * fixed metafield it reads automatically — Meta's catalog fields are wired
 * up per merchant via Shopify's own "Channel Mapping" screen (Settings →
 * Sales channels → Facebook & Instagram → Channel mapping), where any
 * metafield can be pointed at the catalog's `condition` field. This writes
 * a clearly-named custom.meta_condition product metafield so that mapping
 * step is a single one-time pick instead of per-product manual entry.
 */
export async function autoSyncCatalogCondition(shopifyProductId: string, productType: string, variantIds: number[]): Promise<void> {
  const condition = catalogConditionForProductType(productType);
  try {
    for (const variantId of variantIds) {
      await setVariantMetafield(variantId, "mm-google-shopping", "condition", condition);
    }
    await setProductMetafields(shopifyProductId, [{ namespace: "custom", key: "meta_condition", value: condition, type: "single_line_text_field" }]);

    await logSync({
      shopifyProductId,
      action: "catalog_condition_synced",
      message: `type="${productType}" -> condition=${condition} (${variantIds.length} variant(en), + custom.meta_condition)`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ shopifyProductId, action: "catalog_condition_error", message }).catch(() => {});
  }
}
