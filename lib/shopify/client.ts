// Thin Shopify Admin REST client. Shopify is the source of truth: this
// module only reads/writes the same store the storefront theme uses, via
// an app-reserved metafield namespace for structured product data. Using
// $app: means these fields are private to this app and never show up in
// Shopify's generic native metafields UI — only our own Admin UI
// extension surfaces them, filtered per product type.

/** Resolved app-reserved namespace: $app:mkt -> app--{appId}--mkt. Must match
 * the namespace used when creating the metafield definitions (see
 * MARKTPLAATS_INTEGRATION.md) and the Shopify extension's utils.js. */
const MKT_NAMESPACE = "app--428689915905--mkt";

export interface ShopifyImage {
  id: number;
  src: string;
  position: number;
}

export interface ShopifyMetafield {
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
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  if (!domain || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN not configured");
  }
  return { domain, token, version };
}

async function shopifyFetch(path: string, init?: RequestInit) {
  const { domain, token, version } = config();
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

export async function listProducts(limit = 50): Promise<ShopifyProduct[]> {
  const data = await shopifyFetch(`/products.json?limit=${limit}`);
  return data.products as ShopifyProduct[];
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
