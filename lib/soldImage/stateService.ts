import { query } from "../db";
import { SoldImageState, SoldImageStatus } from "./types";

interface StateRow {
  shopify_product_id: string;
  original_image_id: string | null;
  original_image_src: string | null;
  sold_image_id: string | null;
  sold_image_src: string | null;
  status: string;
  out_of_stock_detected_at: string | null;
  apply_after: string | null;
  applied_at: string | null;
  restored_at: string | null;
  last_error: string | null;
}

function fromRow(row: StateRow): SoldImageState {
  return {
    shopifyProductId: row.shopify_product_id,
    originalImageId: row.original_image_id,
    originalImageSrc: row.original_image_src,
    soldImageId: row.sold_image_id,
    soldImageSrc: row.sold_image_src,
    status: row.status as SoldImageStatus,
    outOfStockDetectedAt: row.out_of_stock_detected_at,
    applyAfter: row.apply_after,
    appliedAt: row.applied_at,
    restoredAt: row.restored_at,
    lastError: row.last_error,
  };
}

export async function getSoldImageState(shopifyProductId: string): Promise<SoldImageState | null> {
  const rows = await query<StateRow>("SELECT * FROM sold_image_state WHERE shopify_product_id = $1", [shopifyProductId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getDueStates(now = new Date()): Promise<SoldImageState[]> {
  const rows = await query<StateRow>(
    "SELECT * FROM sold_image_state WHERE status IN ('pending', 'restoring') AND (apply_after IS NULL OR apply_after <= $1)",
    [now.toISOString()]
  );
  return rows.map(fromRow);
}

/** Marks a product as newly out-of-stock, pending the overlay job. No-op if it's already pending/applied/restoring — never re-schedule a duplicate. */
export async function markPending(shopifyProductId: string, applyAfter: Date): Promise<void> {
  await query(
    `INSERT INTO sold_image_state (shopify_product_id, status, out_of_stock_detected_at, apply_after)
     VALUES ($1, 'pending', now(), $2)
     ON CONFLICT (shopify_product_id) DO UPDATE SET
       status = 'pending', out_of_stock_detected_at = now(), apply_after = $2, last_error = NULL, updated_at = now()
     WHERE sold_image_state.status IN ('none', 'restored', 'error')`,
    [shopifyProductId, applyAfter.toISOString()]
  );
}

/** Marks a product as back in stock, pending restoration of the original image. No-op unless it's currently applied. */
export async function markRestoring(shopifyProductId: string): Promise<void> {
  await query(
    `UPDATE sold_image_state SET status = 'restoring', last_error = NULL, updated_at = now()
     WHERE shopify_product_id = $1 AND status = 'applied'`,
    [shopifyProductId]
  );
}

export async function markApplied(shopifyProductId: string, originalImageId: string, originalImageSrc: string, soldImageId: string, soldImageSrc: string): Promise<void> {
  await query(
    `UPDATE sold_image_state SET
       status = 'applied', original_image_id = $2, original_image_src = $3,
       sold_image_id = $4, sold_image_src = $5, applied_at = now(), last_error = NULL, updated_at = now()
     WHERE shopify_product_id = $1`,
    [shopifyProductId, originalImageId, originalImageSrc, soldImageId, soldImageSrc]
  );
}

export async function markRestored(shopifyProductId: string): Promise<void> {
  await query(
    `UPDATE sold_image_state SET
       status = 'restored', sold_image_id = NULL, sold_image_src = NULL, restored_at = now(), last_error = NULL, updated_at = now()
     WHERE shopify_product_id = $1`,
    [shopifyProductId]
  );
}

export async function markError(shopifyProductId: string, message: string): Promise<void> {
  await query(
    `UPDATE sold_image_state SET status = 'error', last_error = $2, updated_at = now() WHERE shopify_product_id = $1`,
    [shopifyProductId, message]
  );
}
