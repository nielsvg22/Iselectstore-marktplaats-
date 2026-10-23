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

// Trailing color/finish/condition words sellers type directly into the
// free-text "Model" field (longest phrases first, so "space gray" is cut
// before a bare "gray" rule could leave "space" dangling).
const TRAILING_COLOR_WORDS = [
  "space gray",
  "space grey",
  "midnight green",
  "pacific blue",
  "rose gold",
  "sierra blue",
  "alpine green",
  "deep purple",
  "space zwart",
  "spacezwart",
  "spacegrijs",
  "space grijs",
  "goud",
  "gold",
  "zilver",
  "silver",
  "zwart",
  "black",
  "wit",
  "white",
  "grijs",
  "gray",
  "grey",
  "blauw",
  "blue",
  "groen",
  "green",
  "rood",
  "red",
  "roze",
  "pink",
  "blush",
  "paars",
  "purple",
  "geel",
  "yellow",
  "oranje",
  "orange",
  "koraal",
  "coral",
  "titanium",
  "sterrenlicht",
  "starlight",
  "middernacht",
  "midnight",
  "product red",
];

/**
 * Strips the free-text clutter sellers append after the real model name
 * (color, condition, battery %, warranty notes, "/"-separated remarks) so
 * subscribers can pick a genuinely generic model (e.g. "iPhone 14 Pro")
 * instead of every messy per-listing variant. Only used by the
 * subscribe/notify-match path — NOT by extractProductIdentity(), whose
 * exact (non-generic) model string other features such as
 * catalog/lifecycleService.ts still depend on.
 */
export function genericizeModel(value: string | undefined | null): string {
  let model = normalizeModel(value);
  if (!model) return "";

  // Everything after the first "/" is always seller remarks
  // ("iPhone 14 Pro zwart /licht gebruikt /100% batt /garantie").
  model = model.split("/")[0].trim();

  // Repeatedly strip a trailing color/finish word, longest match first,
  // since "... Pro space gray" and "... Pro zwart" both need multiple passes
  // to be safe against accidental double-ups ("... zwart zwart").
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const word of TRAILING_COLOR_WORDS) {
      const re = new RegExp(`\\s+${word}$`, "i");
      if (re.test(model)) {
        model = model.replace(re, "").trim();
        stripped = true;
        break;
      }
    }
  }

  return model;
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
