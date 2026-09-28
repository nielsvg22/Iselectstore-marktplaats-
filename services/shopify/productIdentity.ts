import { ShopifyMetafield, ShopifyProduct, getAllProductMetafields } from "@/lib/shopify/client";

export interface ProductIdentity {
  productType: string;
  model: string;
  storage: string;
}

const MKT_NAMESPACE = "app--428689915905--mkt";

type AttachedMetafield = { namespace: string; key: string; value: string | number | boolean };

function getMetafieldValue(product: ShopifyProduct, namespace: string, key: string): string | undefined {
  // Shopify REST product payload does not include metafields by default.
  // Callers that need metafields should fetch them separately and attach them.
  const extended = product as ShopifyProduct & { metafields?: { namespace: string; key: string; value: string }[] };
  return extended.metafields?.find((m) => m.namespace === namespace && m.key === key)?.value;
}

function normalizeStorage(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  const s = String(value).toLowerCase().replace(/\s/g, "").replace(/(gb|tb)$/i, "");
  if (!s) return "";
  return `${s}GB`;
}

function normalizeModel(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

/** Collapses whitespace left behind by removing a storage token from a title. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extracts the product identity used for voorraadmelding matching.
 * Prefers structured metafields when they are attached to the product:
 *   - model:  $app:mkt.model   (Marktplaats namespace)
 *   - storage: custom.storage_gb
 * Falls back to product title parsing only when metafields are missing.
 */
export function extractProductIdentity(product: ShopifyProduct, attachedMetafields?: ShopifyMetafield[] | AttachedMetafield[]): ProductIdentity {
  const productType = (product.product_type || "").trim();

  let model = normalizeModel(getMetafieldValue(product, MKT_NAMESPACE, "model"));
  if (!model && attachedMetafields) {
    model = normalizeModel(attachedMetafields.find((m) => m.namespace === MKT_NAMESPACE && m.key === "model")?.value as string | undefined);
  }
  if (!model) {
    const customModel = (product as unknown as { metafields?: { custom?: { model?: { value?: string } } } }).metafields?.custom?.model?.value;
    model = normalizeModel(customModel);
  }
  if (!model) {
    const fromAttached = attachedMetafields?.find((m) => m.namespace === "custom" && m.key === "model")?.value;
    model = normalizeModel(fromAttached as string | undefined);
  }
  if (!model) {
    // Best-effort fallback: remove storage token from title.
    const title = product.title || "";
    const withoutStorage = title.replace(/\b\d+\s?(GB|TB)\b/gi, "");
    model = collapseWhitespace(withoutStorage) || collapseWhitespace(title);
  }

  let storage = normalizeStorage(getMetafieldValue(product, "custom", "storage_gb"));
  if (!storage && attachedMetafields) {
    storage = normalizeStorage(attachedMetafields.find((m) => m.namespace === "custom" && m.key === "storage_gb")?.value as string | number | undefined);
  }
  if (!storage) {
    const match = product.title?.match(/(\d+)\s?(GB|TB)\b/i);
    if (match) storage = `${match[1]}${match[2].toUpperCase()}`;
  }

  return {
    productType,
    model,
    storage,
  };
}

/**
 * Resolves identity for a product, enriching with metafields only when the
 * title alone is not enough (e.g. "Apple Watch SE 40mm" has no storage token).
 * Every code path (subscribe, webhook, cron scan) must use this resolver so
 * subscription keys and notification keys always match exactly.
 */
export async function resolveProductIdentity(product: ShopifyProduct): Promise<ProductIdentity> {
  const identity = extractProductIdentity(product);
  if (identity.model && identity.storage) return identity;

  try {
    const metafields = await getAllProductMetafields(String(product.id));
    return extractProductIdentity(product, metafields);
  } catch {
    return identity;
  }
}

export function identityKey(identity: ProductIdentity): string {
  return `${identity.productType}|${identity.model}|${identity.storage}`.toLowerCase();
}
