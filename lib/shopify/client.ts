// Thin Shopify Admin REST client. Shopify is the source of truth: this
// module only reads/writes the same store the storefront theme uses, via
// the `mkt` metafield namespace for structured product data.

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

export interface ShopifyProduct {
  id: number;
  title: string;
  product_type: string;
  vendor: string;
  body_html: string | null;
  images: ShopifyImage[];
  variants: { id: number; price: string; compare_at_price: string | null; inventory_quantity: number }[];
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
  const data = await shopifyFetch(`/products/${productId}/metafields.json?limit=250`);
  return data.metafields as ShopifyMetafield[];
}

/** Returns only the `mkt.*` structured fields as a flat key/value map. */
export async function getStructuredFields(productId: string): Promise<Record<string, string>> {
  const metafields = await getProductMetafields(productId);
  const out: Record<string, string> = {};
  for (const m of metafields) {
    if (m.namespace === "mkt") {
      out[m.key] = String(m.value);
    }
  }
  return out;
}

export async function setStructuredField(productId: string, key: string, value: string, type = "single_line_text_field") {
  return shopifyFetch(`/products/${productId}/metafields.json`, {
    method: "POST",
    body: JSON.stringify({ metafield: { namespace: "mkt", key, value, type } }),
  });
}
