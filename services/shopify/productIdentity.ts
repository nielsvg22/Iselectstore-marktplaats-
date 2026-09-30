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

/**
 * Normalises a storage value to the canonical `<number><UNIT>` form.
 *
 *   "256 GB" / "256GB" / "256 gb" / 256  ->  "256GB"
 *   "1 TB"                               ->  "1TB"   (unit is preserved!)
 *
 * Anything that cannot be parsed as a quantity returns "" so a broken
 * metafield can never poison the match key with a made-up value.
 */
export function normalizeStorage(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  const withUnit = raw.match(/^(\d+(?:[.,]\d+)?)\s*(b|kb|mb|gb|tb)$/i);
  if (withUnit) return `${withUnit[1].replace(",", ".")}${withUnit[2].toUpperCase()}`;

  const bare = raw.match(/^(\d+(?:[.,]\d+)?)$/);
  if (bare) return `${bare[1].replace(",", ".")}GB`;

  return "";
}

/** Collapses runs of whitespace and trims — the model part of the match key. */
export function normalizeModel(value: string | undefined | null): string {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Normalises a whole identity so subscribe-time and notify-time keys are
 * byte-for-byte identical. Every writer/reader of
 * `inventory_notification_subscriptions` must go through this.
 */
export function normalizeIdentity(identity: Partial<ProductIdentity>): ProductIdentity {
  return {
    productType: (identity.productType || "").replace(/\s+/g, " ").trim(),
    model: normalizeModel(identity.model),
    storage: normalizeStorage(identity.storage),
  };
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
  const productType = (product.product_type || "").replace(/\s+/g, " ").trim();

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
    if (match) storage = normalizeStorage(`${match[1]} ${match[2]}`);
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
  if (identity.model && identity.storage) return normalizeIdentity(identity);

  try {
    const metafields = await getAllProductMetafields(String(product.id));
    return normalizeIdentity(extractProductIdentity(product, metafields));
  } catch {
    return normalizeIdentity(identity);
  }
}

export function identityKey(identity: ProductIdentity): string {
  return `${identity.productType}|${identity.model}|${identity.storage}`.toLowerCase();
}
