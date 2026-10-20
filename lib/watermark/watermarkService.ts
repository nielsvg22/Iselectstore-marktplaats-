// Orchestrates the watermark feature: for a given product, finds any
// product image that hasn't been watermarked yet, applies the overlay, and
// replaces it on Shopify at the same position — mirrors
// lib/soldImage/soldImageService.ts's "never touch the original until the
// new image exists and uploads successfully" discipline. Unlike the sold
// overlay there's no restore path: once a photo is watermarked it stays
// that way for the product's lifetime, so state tracking only needs to
// remember "done" (and "recently failed", to avoid hammering a broken image
// on every products/update delivery).
//
// Shopify commonly delivers products/update more than once in quick
// succession for a single edit. Each candidate image is therefore claimed
// atomically (claimImageForWatermarking) before any work starts — the DB
// is the lock, not an in-memory check — otherwise two near-simultaneous
// deliveries both pass a plain "not yet watermarked" read before either
// writes its result, and each independently watermarks the same source
// image, leaving a duplicate upload on the product.
import { getProduct, addProductImage, setImagePosition, deleteProductImage, ShopifyImage, ShopifyProduct } from "../shopify/client";
import { getWatermarkedImageIds, claimImageForWatermarking, markWatermarked, markWatermarkError } from "./stateService";
import { applyWatermark } from "./overlay";
import { logSync } from "../logging";

// Images produced by other automated features are never themselves
// watermarked — the sold-out sticker in particular is itself a derived,
// temporary image (see lib/soldImage) that gets swapped back out when a
// product restocks; watermarking it would leave a stray watermarked file
// behind after that restore.
const SKIP_FILENAME_PREFIXES = ["verkocht-", "wm-"];

function shouldSkipByFilename(src: string): boolean {
  const filename = src.split("/").pop()?.split("?")[0] ?? "";
  return SKIP_FILENAME_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kon productfoto niet ophalen (${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function watermarkOneImage(productId: string, image: ShopifyImage): Promise<void> {
  const originalBuffer = await fetchImageBuffer(image.src);
  const watermarkedBuffer = await applyWatermark(originalBuffer);
  const newImage = await addProductImage(productId, watermarkedBuffer, `wm-${image.id}.jpg`);

  // Put the watermarked version where the original was, then remove the
  // original — in that order, so a failure here never leaves the product
  // with neither image.
  await setImagePosition(productId, newImage.id, image.position);
  await deleteProductImage(productId, image.id);

  await markWatermarked(String(newImage.id), productId, String(image.id), image.src);
}

/** Watermarks every not-yet-watermarked image on a product. Safe to call concurrently and repeatedly
 * (e.g. on every products/update webhook, including near-simultaneous deliveries for the same edit) —
 * each image is atomically claimed before processing, so only one caller ever actually watermarks it. */
export async function watermarkProductImages(productId: string, product?: ShopifyProduct): Promise<{ processed: number; skipped: number; errors: number }> {
  const resolvedProduct = product ?? (await getProduct(productId));
  const candidates = resolvedProduct.images.filter((img) => !shouldSkipByFilename(img.src));

  if (candidates.length === 0) return { processed: 0, skipped: 0, errors: 0 };

  const candidateIds = candidates.map((img) => String(img.id));
  // Cheap bulk pre-filter for the common case (a re-delivered webhook for a
  // product that's already fully watermarked) — not required for
  // correctness, the per-image claim below is what actually prevents races.
  const alreadyDone = await getWatermarkedImageIds(candidateIds);

  let processed = 0;
  let errors = 0;
  let skipped = resolvedProduct.images.length - candidates.length;

  for (const image of candidates) {
    const id = String(image.id);
    if (alreadyDone.has(id)) {
      skipped++;
      continue;
    }

    const claimed = await claimImageForWatermarking(id, productId);
    if (!claimed) {
      skipped++;
      continue;
    }

    try {
      await watermarkOneImage(productId, image);
      processed++;
      await logSync({ shopifyProductId: productId, action: "watermark_applied", message: `image=${id}` });
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      await markWatermarkError(id, productId, message).catch(() => {});
      await logSync({ shopifyProductId: productId, action: "watermark_error", message: `image=${id} ${message}` }).catch(() => {});
    }
  }

  return { processed, skipped, errors };
}
