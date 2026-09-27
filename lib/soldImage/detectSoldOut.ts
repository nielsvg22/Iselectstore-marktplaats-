import { StockCheckInput } from "./types";

/**
 * A product counts as "sold out" only when Shopify is actually tracking
 * inventory for it (inventory_management set) and every tracked variant is
 * at or below zero. A product with untracked inventory ("Don't track
 * inventory") never counts as sold out, no matter what inventory_quantity
 * says — that field is meaningless for it.
 */
export function isSoldOut(product: StockCheckInput): boolean {
  const trackedVariants = product.variants.filter((v) => v.inventory_management);
  if (trackedVariants.length === 0) return false;
  return trackedVariants.every((v) => v.inventory_quantity <= 0);
}

/** True once at least one tracked variant has stock again. */
export function isBackInStock(product: StockCheckInput): boolean {
  const trackedVariants = product.variants.filter((v) => v.inventory_management);
  if (trackedVariants.length === 0) return false;
  return trackedVariants.some((v) => v.inventory_quantity > 0);
}
