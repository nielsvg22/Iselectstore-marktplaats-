import { ShopifyProduct } from "@/lib/shopify/client";

export interface ProductIdentity {
  productType: string;
  model: string;
  storage: string;
}

const MKT_NAMESPACE = "app--428689915905--mkt";

function getMetafieldValue(product: ShopifyProduct, namespace: string, key: string): string | undefined {
  // Shopify REST product payload does not include metafields by default.
  // Callers that need metafields should fetch them separately and attach them.
  const extended = product as ShopifyProduct & { metafields?: { namespace: string; key: string; value: string }[] };
  return extended.metafields?.find((m) => m.namespace === namespace && m.key === key)?.value;
}

function normalizeStorage(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  const s = String(value).toLowerCase().replace(/\s/g, "").replace(/gb$/i, "");
  return s ? `${s}GB` : "";
}

function normalizeModel(value: string | undefined): string {
  if (!value) return "";
  return value.trim();
}

/**
 * Extracts the product identity used for voorraadmelding matching.
 * Prefers structured metafields:
 *   - model:  $app:mkt.model   (Marktplaats namespace)
 *   - storage: custom.storage_gb
 * Falls back to product title parsing only when metafields are missing.
 */
export function extractProductIdentity(product: ShopifyProduct): ProductIdentity {
  const productType = (product.product_type || "").trim();

  let model = normalizeModel(getMetafieldValue(product, MKT_NAMESPACE, "model"));
  if (!model) {
    const customModel = (product as unknown as { metafields?: { custom?: { model?: { value?: string } } } }).metafields?.custom?.model?.value;
    model = normalizeModel(customModel);
  }
  if (!model) {
    // Best-effort fallback: remove storage suffix from title.
    const title = product.title || "";
    const withoutStorage = title.replace(/\b\d+\s?GB\b/gi, "").trim();
    model = withoutStorage || title;
  }

  let storage = normalizeStorage(getMetafieldValue(product, "custom", "storage_gb"));
  if (!storage) {
    const match = product.title?.match(/(\d+)\s?GB/i);
    if (match) storage = `${match[1]}GB`;
  }

  return {
    productType,
    model,
    storage,
  };
}

export function identityKey(identity: ProductIdentity): string {
  return `${identity.productType}|${identity.model}|${identity.storage}`.toLowerCase();
}
