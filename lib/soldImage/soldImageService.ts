// Orchestrates the "sold" overlay feature: fetches the product from
// Shopify, generates the overlay image, and writes back to Shopify — never
// touching the original image until the new one is generated and uploaded
// successfully. All state transitions go through stateService so retries
// stay idempotent.
import { getProduct, addProductImage, setImagePosition, deleteProductImage } from "../shopify/client";
import { getSoldImageSettings } from "./settingsService";
import { getDueStates, markApplied, markError, markRestored } from "./stateService";
import { isSoldOut } from "./detectSoldOut";
import { applySoldOverlay } from "./overlay";
import { logSync } from "../logging";
import { SoldImageState } from "./types";

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kon originele afbeelding niet ophalen (${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processApply(state: SoldImageState): Promise<void> {
  const productId = state.shopifyProductId;
  const settings = await getSoldImageSettings();

  if (settings.mode !== "auto") {
    await logSync({ shopifyProductId: productId, action: "sold_image_skipped", message: "mode=none" });
    return;
  }

  const product = await getProduct(productId);

  // Defensive re-check: don't apply a sticker to a product that got restocked
  // between the webhook firing and this job running.
  if (!isSoldOut(product)) {
    await logSync({ shopifyProductId: productId, action: "sold_image_skipped", message: "product weer op voorraad" });
    return;
  }

  const originalImage = product.images[0];
  if (!originalImage) {
    await markError(productId, "Product heeft geen productfoto's.");
    await logSync({ shopifyProductId: productId, action: "sold_image_error", message: "geen productfoto's" });
    return;
  }

  const originalBuffer = await fetchImageBuffer(originalImage.src);
  const soldBuffer = await applySoldOverlay(originalBuffer, settings);
  const soldImage = await addProductImage(productId, soldBuffer, `verkocht-${originalImage.id}.jpg`);

  // Only reorder once the new image exists — a failure above never touches the original.
  await setImagePosition(productId, soldImage.id, 1);

  await markApplied(productId, String(originalImage.id), originalImage.src, String(soldImage.id), soldImage.src);
  await logSync({
    shopifyProductId: productId,
    action: "sold_image_applied",
    message: `original=${originalImage.id} sold=${soldImage.id}`,
  });
}

async function processRestore(state: SoldImageState): Promise<void> {
  const productId = state.shopifyProductId;

  if (state.originalImageId) {
    await setImagePosition(productId, Number(state.originalImageId), 1);
  }
  if (state.soldImageId) {
    // The generated image is derived, not original data — safe to remove once restored.
    await deleteProductImage(productId, Number(state.soldImageId));
  }

  await markRestored(productId);
  await logSync({
    shopifyProductId: productId,
    action: "sold_image_restored",
    message: `original=${state.originalImageId}`,
  });
}

/** Entry point for the cron worker: processes every state row whose delay has elapsed. */
export async function runDueSoldImageJobs(): Promise<{ processed: number; errors: number }> {
  const due = await getDueStates();
  let errors = 0;

  for (const state of due) {
    try {
      if (state.status === "pending") {
        await processApply(state);
      } else if (state.status === "restoring") {
        await processRestore(state);
      }
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      await markError(state.shopifyProductId, message);
      await logSync({ shopifyProductId: state.shopifyProductId, action: "sold_image_error", message });
    }
  }

  return { processed: due.length, errors };
}
