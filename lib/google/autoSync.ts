import { setVariantMetafield } from "../shopify/client";
import { googleConditionForProductType } from "./condition";
import { logSync } from "../logging";

/**
 * Sets the Google Shopping `condition` attribute on every variant of a
 * product, derived automatically from its Shopify product type — so a
 * merchant never has to pick this per product, and it's never left on
 * Google's default ("new") by accident. Called from the create/update
 * webhooks, same place watermarking and the other auto-sync features run;
 * safe to call repeatedly (always just overwrites to the correct value).
 */
export async function autoSyncGoogleCondition(shopifyProductId: string, productType: string, variantIds: number[]): Promise<void> {
  const condition = googleConditionForProductType(productType);
  try {
    for (const variantId of variantIds) {
      await setVariantMetafield(variantId, "mm-google-shopping", "condition", condition);
    }
    await logSync({
      shopifyProductId,
      action: "google_condition_synced",
      message: `type="${productType}" -> condition=${condition} (${variantIds.length} variant(en))`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ shopifyProductId, action: "google_condition_error", message }).catch(() => {});
  }
}
