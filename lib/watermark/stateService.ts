// Tracks which Shopify image ids have already been watermarked, so the
// webhook can skip them on every later products/update instead of
// re-processing (and re-uploading, and re-triggering this same webhook) an
// image it already handled. One row per *watermarked* image id — the row
// for an image is written at the same time that image is uploaded to
// Shopify, so by the time the product object we're inspecting can possibly
// contain it, it's already marked.
import { query } from "../db";
import { WatermarkStatus } from "./types";

interface StateRow {
  shopify_image_id: string;
}

/** Returns the subset of the given image ids that are already recorded as watermarked. */
export async function getWatermarkedImageIds(imageIds: string[]): Promise<Set<string>> {
  if (imageIds.length === 0) return new Set();
  const rows = await query<StateRow>(
    `SELECT shopify_image_id FROM watermarked_images WHERE shopify_image_id = ANY($1::text[]) AND status = 'applied'`,
    [imageIds]
  );
  return new Set(rows.map((r) => r.shopify_image_id));
}

export async function markWatermarked(shopifyImageId: string, shopifyProductId: string, originalImageId: string, originalImageSrc: string): Promise<void> {
  await query(
    `INSERT INTO watermarked_images (shopify_image_id, shopify_product_id, original_image_id, original_image_src, status, applied_at)
     VALUES ($1, $2, $3, $4, 'applied', now())
     ON CONFLICT (shopify_image_id) DO UPDATE SET
       shopify_product_id = $2, original_image_id = $3, original_image_src = $4,
       status = 'applied', applied_at = now(), last_error = NULL, updated_at = now()`,
    [shopifyImageId, shopifyProductId, originalImageId, originalImageSrc]
  );
}

/** Records a failed attempt against the *original* image id, so a persistently broken image (e.g. a corrupt
 * upload) doesn't get retried on every single products/update webhook forever — see WATERMARK_RETRY_COOLDOWN. */
export async function markWatermarkError(originalImageId: string, shopifyProductId: string, message: string): Promise<void> {
  await query(
    `INSERT INTO watermarked_images (shopify_image_id, shopify_product_id, status, last_error, updated_at)
     VALUES ($1, $2, 'error', $3, now())
     ON CONFLICT (shopify_image_id) DO UPDATE SET
       status = 'error', last_error = $3, updated_at = now()`,
    [originalImageId, shopifyProductId, message]
  );
}

const WATERMARK_RETRY_COOLDOWN_MINUTES = 60;

/** Original image ids that failed recently and shouldn't be retried on every webhook delivery until the cooldown passes. */
export async function getRecentlyFailedImageIds(imageIds: string[]): Promise<Set<string>> {
  if (imageIds.length === 0) return new Set();
  const rows = await query<StateRow>(
    `SELECT shopify_image_id FROM watermarked_images
     WHERE shopify_image_id = ANY($1::text[]) AND status = 'error' AND updated_at > now() - ($2 || ' minutes')::interval`,
    [imageIds, WATERMARK_RETRY_COOLDOWN_MINUTES]
  );
  return new Set(rows.map((r) => r.shopify_image_id));
}

export type { WatermarkStatus };
