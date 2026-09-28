import { query } from "@/lib/db";
import { ShopifyProduct } from "@/lib/shopify/client";
import { extractProductIdentity } from "@/services/shopify/productIdentity";
import { unpublishFromOnlineStore } from "@/services/shopify/publications";

export interface LifecycleState {
  shopifyProductId: string;
  productType: string | null;
  model: string | null;
  storage: string | null;
  inventoryQuantity: number | null;
  soldAt: string | null;
  unpublishedAt: string | null;
  status: string;
}

interface LifecycleRow {
  shopify_product_id: string;
  product_type: string | null;
  model: string | null;
  storage: string | null;
  inventory_quantity: number | null;
  sold_at: string | null;
  unpublished_at: string | null;
  status: string;
}

function fromRow(row: LifecycleRow): LifecycleState {
  return {
    shopifyProductId: row.shopify_product_id,
    productType: row.product_type,
    model: row.model,
    storage: row.storage,
    inventoryQuantity: row.inventory_quantity,
    soldAt: row.sold_at,
    unpublishedAt: row.unpublished_at,
    status: row.status,
  };
}

function getTrackedInventoryQuantity(product: ShopifyProduct): number {
  const tracked = product.variants.filter((v) => v.inventory_management);
  if (tracked.length === 0) return 0;
  return tracked.reduce((sum, v) => sum + v.inventory_quantity, 0);
}

export async function getLifecycleState(productId: string): Promise<LifecycleState | null> {
  const rows = await query<LifecycleRow>("SELECT * FROM product_lifecycle WHERE shopify_product_id = $1", [productId.replace(/^gid:\/\/shopify\/Product\//, "")]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * Updates lifecycle state based on current product data.
 * - Records sold_at when tracked inventory hits 0.
 * - Resets sold_at when inventory comes back > 0 before cleanup.
 */
export async function updateLifecycleState(product: ShopifyProduct): Promise<LifecycleState> {
  const productId = String(product.id);
  const identity = extractProductIdentity(product);
  const quantity = getTrackedInventoryQuantity(product);
  const existing = await getLifecycleState(productId);

  if (quantity <= 0) {
    // Product is sold out / out of stock.
    if (!existing || !existing.soldAt) {
      await query(
        `INSERT INTO product_lifecycle (shopify_product_id, product_type, model, storage, inventory_quantity, sold_at, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5, now(), 'active', now(), now())
         ON CONFLICT (shopify_product_id) DO UPDATE SET
           product_type = EXCLUDED.product_type,
           model = EXCLUDED.model,
           storage = EXCLUDED.storage,
           inventory_quantity = EXCLUDED.inventory_quantity,
           sold_at = COALESCE(product_lifecycle.sold_at, now()),
           status = 'active',
           updated_at = now()`,
        [productId, identity.productType || null, identity.model || null, identity.storage || null, quantity]
      );
    } else {
      await query(
        `UPDATE product_lifecycle
         SET product_type = $2, model = $3, storage = $4, inventory_quantity = $5, updated_at = now()
         WHERE shopify_product_id = $1`,
        [productId, identity.productType || null, identity.model || null, identity.storage || null, quantity]
      );
    }
  } else {
    // Product is back in stock — reset sold_at if it was previously set.
    await query(
      `INSERT INTO product_lifecycle (shopify_product_id, product_type, model, storage, inventory_quantity, sold_at, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5, NULL, 'active', now(), now())
       ON CONFLICT (shopify_product_id) DO UPDATE SET
         product_type = EXCLUDED.product_type,
         model = EXCLUDED.model,
         storage = EXCLUDED.storage,
         inventory_quantity = EXCLUDED.inventory_quantity,
         sold_at = NULL,
         status = 'active',
         updated_at = now()`,
      [productId, identity.productType || null, identity.model || null, identity.storage || null, quantity]
    );
  }

  const rows = await query<LifecycleRow>("SELECT * FROM product_lifecycle WHERE shopify_product_id = $1", [productId]);
  return fromRow(rows[0]);
}

/**
 * Returns products that have been sold out for at least 28 days.
 */
export async function getProductsDueForUnpublish(days = 28): Promise<LifecycleState[]> {
  const rows = await query<LifecycleRow>(
    `SELECT * FROM product_lifecycle
     WHERE status = 'active'
       AND sold_at IS NOT NULL
       AND inventory_quantity <= 0
       AND sold_at <= now() - ($1 || ' days')::interval
     ORDER BY sold_at ASC`,
    [String(days)]
  );
  return rows.map(fromRow);
}

/**
 * Unpublishes products that have been sold out for >= 28 days.
 * Does NOT delete products. Idempotent.
 */
export async function runCleanup(days = 28): Promise<{
  checked: number;
  unpublished: number;
  errors: number;
  details: { productId: string; ok: boolean; error?: string }[];
}> {
  const due = await getProductsDueForUnpublish(days);
  const details: { productId: string; ok: boolean; error?: string }[] = [];
  let unpublished = 0;
  let errors = 0;

  for (const state of due) {
    try {
      await unpublishFromOnlineStore(state.shopifyProductId);
      details.push({ productId: state.shopifyProductId, ok: true });
      unpublished++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push({ productId: state.shopifyProductId, ok: false, error: message });
      errors++;
    }
  }

  return { checked: due.length, unpublished, errors, details };
}
