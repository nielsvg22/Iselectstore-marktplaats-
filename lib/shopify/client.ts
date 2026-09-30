// Thin Shopify Admin REST client. Shopify is the source of truth: this
// module only reads/writes the same store the storefront theme uses, via
// an app-reserved metafield namespace for structured product data. Using
// $app: means these fields are private to this app and never show up in
// Shopify's generic native metafields UI — only our own Admin UI
// extension surfaces them, filtered per product type.

import { MKT_NAMESPACE, MetafieldWrite } from "./metafields";
import { getShopifyAccessToken } from "./tokenService";

export { MKT_NAMESPACE };

export interface ShopifyImage {
  id: number;
  src: string;
  position: number;
}

export interface ShopifyMetafield {
  id?: number;
  namespace: string;
  key: string;
  // Shopify returns this as a native JSON number/boolean for metafields
  // whose *definition* type is numeric/boolean (e.g. number_integer),
  // even though older/untyped metafields come back as plain strings.
  value: string | number | boolean;
  type: string;
}

export interface ShopifyVariant {
  id: number;
  price: string;
  compare_at_price: string | null;
  inventory_quantity: number;
  /** null/"" means Shopify isn't tracking inventory for this variant — a 0 quantity there means nothing. */
  inventory_management: string | null;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  product_type: string;
  vendor: string;
  body_html: string | null;
  handle?: string;
  status?: string;
  tags?: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}

async function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  if (!domain) {
    throw new Error("SHOPIFY_STORE_DOMAIN not configured");
  }
  // Self-refreshing (see tokenService.ts) — never goes stale, no manual
  // token rotation needed. SHOPIFY_ADMIN_ACCESS_TOKEN is no longer read.
  const token = await getShopifyAccessToken();
  return { domain, token, version };
}

async function shopifyFetch(path: string, init?: RequestInit) {
  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getProduct(productId: string): Promise<ShopifyProduct> {
  const data = await shopifyFetch(`/products/${productId}.json`);
  return data.product as ShopifyProduct;
}

/** Creates a product (used by the Admin UI extension quick-create flow). */
export async function createProduct(product: Record<string, unknown>): Promise<ShopifyProduct> {
  const data = await shopifyFetch("/products.json", {
    method: "POST",
    body: JSON.stringify({ product }),
  });
  return data.product as ShopifyProduct;
}

/** Partial product update — only the fields present in `product` change. */
export async function updateProduct(productId: string, product: Record<string, unknown>): Promise<ShopifyProduct> {
  const data = await shopifyFetch(`/products/${productId}.json`, {
    method: "PUT",
    body: JSON.stringify({ product }),
  });
  return data.product as ShopifyProduct;
}

/**
 * Lists products, paging through the REST collection so callers can scan the
 * whole catalogue instead of silently stopping at one 250-item page.
 */
export async function listProducts(limit = 50): Promise<ShopifyProduct[]> {
  const pageSize = Math.min(Math.max(limit, 1), 250);
  const all: ShopifyProduct[] = [];
  let page = 1;

  while (all.length < limit) {
    const data = await shopifyFetch(`/products.json?limit=${pageSize}&page=${page}`);
    const batch = (data.products as ShopifyProduct[]) || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
    if (page > 50) break; // hard safety valve: 12.500 products
  }

  return all.slice(0, limit);
}

export async function getProductMetafields(productId: string): Promise<ShopifyMetafield[]> {
  const data = await shopifyFetch(`/products/${productId}/metafields.json?limit=250&namespace=${MKT_NAMESPACE}`);
  return data.metafields as ShopifyMetafield[];
}

/** All metafields for a product (all namespaces) — used for product identity resolution. */
export async function getAllProductMetafields(productId: string): Promise<ShopifyMetafield[]> {
  const data = await shopifyFetch(`/products/${productId}/metafields.json?limit=250`);
  return data.metafields as ShopifyMetafield[];
}

/** Returns the structured fields (app-reserved `mkt` namespace) as a flat key/value map. */
export async function getStructuredFields(productId: string): Promise<Record<string, string>> {
  const metafields = await getProductMetafields(productId);
  const out: Record<string, string> = {};
  for (const m of metafields) {
    out[m.key] = String(m.value);
  }
  return out;
}

export async function setStructuredField(productId: string, key: string, value: string, type = "single_line_text_field") {
  return shopifyFetch(`/products/${productId}/metafields.json`, {
    method: "POST",
    body: JSON.stringify({ metafield: { namespace: MKT_NAMESPACE, key, value, type } }),
  });
}

/**
 * Upserts a batch of metafields across namespaces (used by the quick-create
 * flow to write `mkt` + the storefront `custom` mirror in one pass). Reads the
 * product's metafields once and PUTs existing namespace/key pairs instead of
 * POSTing duplicates (namespaces without a definition allow duplicates).
 */
export async function setProductMetafields(productId: string, writes: MetafieldWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const existing = await getAllProductMetafields(productId);
  const byPair = new Map(existing.map((m) => [`${m.namespace}.${m.key}`, m] as const));

  for (const write of writes) {
    const current = byPair.get(`${write.namespace}.${write.key}`);
    if (current?.id) {
      await shopifyFetch(`/products/${productId}/metafields/${current.id}.json`, {
        method: "PUT",
        body: JSON.stringify({
          metafield: { id: current.id, value: write.value, type: write.type },
        }),
      });
    } else {
      const res = await shopifyFetch(`/products/${productId}/metafields.json`, {
        method: "POST",
        body: JSON.stringify({
          metafield: {
            namespace: write.namespace,
            key: write.key,
            value: write.value,
            type: write.type,
          },
        }),
      });
      const created = (res as { metafield?: { id?: number } }).metafield;
      if (created?.id) {
        byPair.set(`${write.namespace}.${write.key}`, { ...write, id: created.id });
      }
    }
  }
}

/** Uploads a new product image from raw bytes. Never touches existing images — used to add the generated "sold" image alongside the untouched original. */
export async function addProductImage(productId: string, imageBuffer: Buffer, filename: string): Promise<ShopifyImage> {
  const data = await shopifyFetch(`/products/${productId}/images.json`, {
    method: "POST",
    body: JSON.stringify({ image: { attachment: imageBuffer.toString("base64"), filename } }),
  });
  return data.image as ShopifyImage;
}

/** Moves one image to a given 1-based position; Shopify shifts the rest accordingly. */
export async function setImagePosition(productId: string, imageId: number, position: number): Promise<void> {
  await shopifyFetch(`/products/${productId}/images/${imageId}.json`, {
    method: "PUT",
    body: JSON.stringify({ image: { id: imageId, position } }),
  });
}

export async function deleteProductImage(productId: string, imageId: number): Promise<void> {
  await shopifyFetch(`/products/${productId}/images/${imageId}.json`, { method: "DELETE" });
}
