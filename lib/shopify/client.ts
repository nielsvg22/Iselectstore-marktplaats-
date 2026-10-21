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
  /**
   * Shopify's own EAN/UPC field. Was already present in Shopify's raw REST
   * response but silently dropped by this interface — added so real,
   * already-available Shopify data can flow through to GoedGeplaatst's "ean"
   * attribute (lib/marktplaats/orchestrator.ts / lib/goedgeplaatst/mapper.ts)
   * instead of that field staying empty for no reason. null/"" means Shopify
   * has no barcode set for this variant.
   */
  barcode: string | null;
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
  /** "Page title" in Admin → product → SEO. Blank/null means Shopify falls back to the product title. */
  metafields_global_title_tag?: string | null;
  /** "Meta description" in Admin → product → SEO. Blank/null means Shopify falls back to a truncated body_html. */
  metafields_global_description_tag?: string | null;
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

/** Extracts page_info from the `rel="next"` entry of Shopify's cursor-pagination Link header, if present. */
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      try {
        return new URL(match[1]).searchParams.get("page_info");
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Mirrors the original shopifyFetch's implicit `any` (raw Shopify REST JSON) so existing callers are unaffected. */
async function shopifyFetchRaw(path: string, init?: RequestInit): Promise<{ data: any; nextPageInfo: string | null }> {
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
  return { data: await res.json(), nextPageInfo: parseNextPageInfo(res.headers.get("link")) };
}

async function shopifyFetch(path: string, init?: RequestInit) {
  const { data } = await shopifyFetchRaw(path, init);
  return data;
}

export async function getProduct(productId: string): Promise<ShopifyProduct> {
  const data = await shopifyFetch(`/products/${productId}.json`);
  return data.product as ShopifyProduct;
}

/** The shop's myshopify domain and its connected primary (custom) domain — to know which domain to verify for outgoing email. */
export async function getShopDomainInfo(): Promise<{ myshopifyDomain: string; primaryDomain: string | null }> {
  const shopData = await shopifyFetch("/shop.json");
  const shop = shopData.shop as { domain: string; myshopify_domain: string };
  return {
    myshopifyDomain: shop.myshopify_domain,
    primaryDomain: shop.domain && shop.domain !== shop.myshopify_domain ? shop.domain : null,
  };
}

/** The shop's plan name/display name — to know exactly which Shopify features (e.g. checkout branding, Plus-only APIs) are available. */
export async function getShopPlan(): Promise<{ planName: string; planDisplayName: string }> {
  const shopData = await shopifyFetch("/shop.json");
  const shop = shopData.shop as { plan_name: string; plan_display_name: string };
  return { planName: shop.plan_name, planDisplayName: shop.plan_display_name };
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

/** Shared by the products/create and products/update webhooks — a product is only worth acting on once it's actually sellable. */
export function hasPositiveInventory(product: { variants: { inventory_management: string | null; inventory_quantity: number }[] }): boolean {
  return product.variants.some((v) => v.inventory_management && v.inventory_quantity > 0);
}

/**
 * Lists products, paging through the REST collection so callers can scan the
 * whole catalogue instead of silently stopping at one 250-item page.
 */
export async function listProducts(limit = 50): Promise<ShopifyProduct[]> {
  const pageSize = Math.min(Math.max(limit, 1), 250);
  const all: ShopifyProduct[] = [];
  // Shopify removed numbered (?page=N) pagination from the REST Admin API —
  // only cursor-based page_info (from the Link response header) works now.
  let pageInfo: string | null = null;
  let iterations = 0;

  while (all.length < limit) {
    const path = pageInfo ? `/products.json?limit=${pageSize}&page_info=${encodeURIComponent(pageInfo)}` : `/products.json?limit=${pageSize}`;
    const { data, nextPageInfo } = await shopifyFetchRaw(path);
    const batch = ((data as { products?: ShopifyProduct[] }).products as ShopifyProduct[]) || [];
    all.push(...batch);
    iterations += 1;
    if (!nextPageInfo || batch.length < pageSize) break;
    pageInfo = nextPageInfo;
    if (iterations > 50) break; // hard safety valve: 12.500 products
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

/** Returns the storefront-facing `custom` namespace fields (condition, battery_percentage, warranty_months, …) the theme reads — as a flat key/value map. */
export async function getCustomFields(productId: string): Promise<Record<string, string>> {
  const data = await shopifyFetch(`/products/${productId}/metafields.json?limit=250&namespace=custom`);
  const out: Record<string, string> = {};
  for (const m of data.metafields as ShopifyMetafield[]) {
    out[m.key] = String(m.value);
  }
  return out;
}

/** Sets a product's "Page title" / "Meta description" SEO fields (Admin → product → Search engine listing). */
export async function setProductSeo(productId: string, seoTitle: string, seoDescription: string): Promise<void> {
  await shopifyFetch(`/products/${productId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      product: {
        id: Number(productId),
        metafields_global_title_tag: seoTitle,
        metafields_global_description_tag: seoDescription,
      },
    }),
  });
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

export async function deleteProduct(productId: string): Promise<void> {
  await shopifyFetch(`/products/${productId}.json`, { method: "DELETE" });
}

export interface ShopifyPage {
  id: number;
  title: string;
  handle: string;
  template_suffix: string | null;
  body_html?: string;
}

/** Looks up a Shopify page (Online winkel → Pagina's) by its exact handle. Returns null if none exists. */
export async function getPageByHandle(handle: string): Promise<ShopifyPage | null> {
  const data = await shopifyFetch(`/pages.json?handle=${encodeURIComponent(handle)}`);
  const pages = (data.pages as ShopifyPage[]) || [];
  return pages[0] ?? null;
}

/**
 * Sets which theme template a page renders with (the "Thema-template" dropdown
 * in the page editor). `templateSuffix` is the template filename without the
 * "page." prefix/".json" suffix — e.g. "ons-verhaal" for templates/page.ons-verhaal.json.
 */
export async function setPageTemplate(pageId: number, templateSuffix: string): Promise<ShopifyPage> {
  const data = await shopifyFetch(`/pages/${pageId}.json`, {
    method: "PUT",
    body: JSON.stringify({ page: { id: pageId, template_suffix: templateSuffix } }),
  });
  return data.page as ShopifyPage;
}

/** Creates a new Shopify page (Online winkel → Pagina's) with the given title/handle/template. */
export async function createPage(
  title: string,
  handle: string,
  templateSuffix?: string,
  bodyHtml?: string
): Promise<ShopifyPage> {
  const data = await shopifyFetch(`/pages.json`, {
    method: "POST",
    body: JSON.stringify({
      page: { title, handle, template_suffix: templateSuffix ?? null, body_html: bodyHtml ?? null },
    }),
  });
  return data.page as ShopifyPage;
}

/** Updates an existing page's title/content/template (only the given fields are sent). */
export async function updatePage(
  pageId: number,
  fields: { title?: string; bodyHtml?: string; templateSuffix?: string }
): Promise<ShopifyPage> {
  const data = await shopifyFetch(`/pages/${pageId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      page: {
        id: pageId,
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.bodyHtml !== undefined ? { body_html: fields.bodyHtml } : {}),
        ...(fields.templateSuffix !== undefined ? { template_suffix: fields.templateSuffix } : {}),
      },
    }),
  });
  return data.page as ShopifyPage;
}

export interface ShopifyTheme {
  id: number;
  name: string;
  role: string;
}

/** The theme currently marked "Live" in Online winkel → Thema's. */
export async function getMainTheme(): Promise<ShopifyTheme> {
  const data = await shopifyFetch(`/themes.json`);
  const themes = (data.themes as ShopifyTheme[]) || [];
  const main = themes.find((t) => t.role === "main");
  if (!main) throw new Error("Geen live ('main') thema gevonden.");
  return main;
}

/** All themes on the shop (id, name, role) — diagnostic: is the GitHub-connected theme actually the live one? */
export async function listThemes(): Promise<ShopifyTheme[]> {
  const data = await shopifyFetch(`/themes.json`);
  return (data.themes as ShopifyTheme[]) || [];
}

export interface ShopifyThemeAsset {
  key: string;
  content_type: string;
  size: number;
  checksum: string | null;
}

/** Lists every file key in a given theme (e.g. to diff the live theme against the GitHub-synced copy). */
export async function listThemeAssets(themeId: number): Promise<ShopifyThemeAsset[]> {
  const data = await shopifyFetch(`/themes/${themeId}/assets.json`);
  return (data.assets as ShopifyThemeAsset[]) || [];
}

/**
 * Raw asset read, straight from Shopify's response shape (no lossy decode) —
 * needed to pull binary files (fonts, images) byte-for-byte when syncing the
 * live theme back to git; `getThemeAssetContent` below assumes UTF-8 text.
 */
export async function getThemeAssetRaw(themeId: number, key: string): Promise<{ value: string | null; attachment: string | null }> {
  const data = await shopifyFetch(`/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`);
  const asset = data.asset as { value?: string; attachment?: string } | undefined;
  if (!asset) throw new Error(`Asset "${key}" niet gevonden op thema ${themeId}.`);
  return { value: asset.value ?? null, attachment: asset.attachment ?? null };
}

/** Raw contents of one file (e.g. "templates/index.json") from a given theme, straight from Shopify — bypasses any GitHub-sync assumptions. */
export async function getThemeAssetContent(themeId: number, key: string): Promise<string> {
  const data = await shopifyFetch(`/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`);
  const asset = data.asset as { value?: string; attachment?: string } | undefined;
  if (!asset) throw new Error(`Asset "${key}" niet gevonden op thema ${themeId}.`);
  if (asset.value != null) return asset.value;
  if (asset.attachment != null) return Buffer.from(asset.attachment, "base64").toString("utf-8");
  throw new Error(`Asset "${key}" had geen leesbare inhoud.`);
}

/** Overwrites one file on a given theme with new text content (e.g. to push a JSON template GitHub-sync is skipping). */
export async function setThemeAssetContent(themeId: number, key: string, value: string): Promise<void> {
  await shopifyFetch(`/themes/${themeId}/assets.json`, {
    method: "PUT",
    body: JSON.stringify({ asset: { key, value } }),
  });
}

/** Raw GraphQL Admin API call — used for things the REST API doesn't cover (e.g. shop Files, used by image_picker theme settings). */
async function shopifyGraphQL<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

export interface ShopifyDeliveryRate {
  id: string;
  name: string;
  priceAmount: string;
  priceCurrency: string;
}
export interface ShopifyDeliveryZone {
  id: string;
  name: string;
  methodDefinitions: ShopifyDeliveryRate[];
}
export interface ShopifyDeliveryProfile {
  id: string;
  name: string;
  zones: ShopifyDeliveryZone[];
}

/** Reads the shop's delivery profiles (zones + flat-rate shipping methods), to see what's already configured before changing anything. */
export async function getDeliveryProfiles(): Promise<ShopifyDeliveryProfile[]> {
  const data = await shopifyGraphQL<{
    deliveryProfiles: {
      edges: {
        node: {
          id: string;
          name: string;
          profileLocationGroups: {
            locationGroupZones: {
              edges: {
                node: {
                  zone: { id: string; name: string };
                  methodDefinitions: {
                    edges: { node: { id: string; name: string; rateProvider: { price?: { amount: string; currencyCode: string } } | null } }[];
                  };
                };
              }[];
            };
          }[];
        };
      }[];
    };
  }>(`
    query {
      deliveryProfiles(first: 20) {
        edges {
          node {
            id
            name
            profileLocationGroups {
              locationGroupZones(first: 20) {
                edges {
                  node {
                    zone { id name }
                    methodDefinitions(first: 20) {
                      edges {
                        node {
                          id
                          name
                          rateProvider {
                            ... on DeliveryRateDefinition { price { amount currencyCode } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  return data.deliveryProfiles.edges.map((profileEdge) => ({
    id: profileEdge.node.id,
    name: profileEdge.node.name,
    zones: profileEdge.node.profileLocationGroups.flatMap((g) =>
      g.locationGroupZones.edges.map((z) => ({
        id: z.node.zone.id,
        name: z.node.zone.name,
        methodDefinitions: z.node.methodDefinitions.edges.map((m) => ({
          id: m.node.id,
          name: m.node.name,
          priceAmount: m.node.rateProvider?.price?.amount ?? "",
          priceCurrency: m.node.rateProvider?.price?.currencyCode ?? "",
        })),
      }))
    ),
  }));
}

/** Overwrites the price of one existing flat-rate shipping method (e.g. to set the standard €10,25 rate). */
export async function updateShippingRatePrice(profileId: string, methodDefinitionId: string, amount: string, currencyCode = "EUR"): Promise<void> {
  const data = await shopifyGraphQL<{
    deliveryProfileUpdate: { userErrors: { field: string[]; message: string }[] };
  }>(
    `
    mutation UpdateRate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        userErrors { field message }
      }
    }
  `,
    {
      id: profileId,
      profile: {
        locationGroupsToUpdate: [
          {
            methodDefinitionsToUpdate: [
              {
                id: methodDefinitionId,
                rateDefinition: { price: { amount, currencyCode } },
              },
            ],
          },
        ],
      },
    }
  );
  const errors = data.deliveryProfileUpdate.userErrors;
  if (errors.length > 0) throw new Error(`Shopify deliveryProfileUpdate errors: ${JSON.stringify(errors)}`);
}

export interface CheckoutProfile {
  id: string;
  name: string;
  isPublished: boolean;
}

/** Lists the shop's checkout profiles — needed to target the published one when setting checkout branding (e.g. the logo). */
export async function getCheckoutProfiles(): Promise<CheckoutProfile[]> {
  const data = await shopifyGraphQL<{
    checkoutProfiles: { edges: { node: CheckoutProfile }[] };
  }>(`
    query {
      checkoutProfiles(first: 10) {
        edges { node { id name isPublished } }
      }
    }
  `);
  return data.checkoutProfiles.edges.map((e) => e.node);
}

/** Sets the logo shown in the checkout header, on the shop's published checkout profile. */
export async function setCheckoutLogo(mediaImageId: string): Promise<unknown> {
  const profiles = await getCheckoutProfiles();
  const profile = profiles.find((p) => p.isPublished) || profiles[0];
  if (!profile) throw new Error("Geen checkout-profiel gevonden.");

  const data = await shopifyGraphQL<{
    checkoutBrandingUpsert: { checkoutBranding: unknown; userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation upsert($checkoutProfileId: ID!, $checkoutBrandingInput: CheckoutBrandingInput!) {
      checkoutBrandingUpsert(checkoutProfileId: $checkoutProfileId, checkoutBrandingInput: $checkoutBrandingInput) {
        checkoutBranding { designSystem { colors { global { brand } } } }
        userErrors { field message }
      }
    }`,
    {
      checkoutProfileId: profile.id,
      checkoutBrandingInput: {
        customizations: {
          header: {
            logo: { image: { mediaImageId } },
          },
        },
      },
    }
  );
  const errors = data.checkoutBrandingUpsert.userErrors;
  if (errors.length > 0) throw new Error(`checkoutBrandingUpsert errors: ${JSON.stringify(errors)}`);
  return data.checkoutBrandingUpsert.checkoutBranding;
}

/**
 * Uploads an image into the shop's Files library (Content → Files), the
 * source image_picker theme settings pick from. Staged-upload flow:
 * 1) ask Shopify for a signed upload URL, 2) PUT the bytes there,
 * 3) register the uploaded file as a MediaImage, 4) poll until Shopify
 * finishes processing it so we can return its final CDN url and the
 * "shopify://shop_images/<filename>" reference theme settings expect.
 */
export async function uploadShopImage(buffer: Buffer, filename: string, mimeType: string): Promise<{ id: string; url: string; shopifyReference: string }> {
  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: { message: string }[] };
  }>(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    { input: [{ resource: "IMAGE", filename, mimeType, fileSize: String(buffer.length), httpMethod: "POST" }] }
  );
  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error(`stagedUploadsCreate: ${JSON.stringify(staged.stagedUploadsCreate.userErrors)}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged upload PUT failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }

  const created = await shopifyGraphQL<{
    fileCreate: { files: { id: string; fileStatus: string; alt: string | null; preview?: { image?: { url: string } } }[]; userErrors: { message: string }[] };
  }>(
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus alt preview { image { url } } }
        userErrors { message }
      }
    }`,
    { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: filename }] }
  );
  if (created.fileCreate.userErrors.length > 0) {
    throw new Error(`fileCreate: ${JSON.stringify(created.fileCreate.userErrors)}`);
  }
  const fileId = created.fileCreate.files[0].id;

  // Files process async — poll until Shopify finishes and gives us the final CDN url.
  let finalUrl: string | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    const check = await shopifyGraphQL<{ node: { id: string; fileStatus: string; preview?: { image?: { url: string } } } | null }>(
      `query checkFile($id: ID!) { node(id: $id) { ... on MediaImage { id fileStatus preview { image { url } } } } }`,
      { id: fileId }
    );
    const status = check.node?.fileStatus;
    const url = check.node?.preview?.image?.url;
    if (status === "READY" && url) {
      finalUrl = url;
      break;
    }
    if (status === "FAILED") throw new Error(`Shopify kon de afbeelding niet verwerken (fileStatus FAILED): ${filename}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (!finalUrl) throw new Error(`Afbeelding ${filename} was na 10 pogingen nog niet "READY" bij Shopify.`);

  return { id: fileId, url: finalUrl, shopifyReference: `shopify://shop_images/${filename}` };
}

/**
 * Uploads a video into the shop's Files library and returns its direct,
 * permanent CDN .mp4 URL — used instead of a theme "video" picker setting
 * (whose JSON-template reference format Shopify doesn't document), so the
 * theme can just play it with a plain &lt;video src&gt; tag.
 */
export async function uploadShopVideo(buffer: Buffer, filename: string, mimeType: string): Promise<{ id: string; url: string }> {
  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: { message: string }[] };
  }>(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    { input: [{ resource: "VIDEO", filename, mimeType, fileSize: String(buffer.length), httpMethod: "POST" }] }
  );
  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error(`stagedUploadsCreate: ${JSON.stringify(staged.stagedUploadsCreate.userErrors)}`);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged upload PUT failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }

  const created = await shopifyGraphQL<{
    fileCreate: { files: { id: string; fileStatus: string }[]; userErrors: { message: string }[] };
  }>(
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { message }
      }
    }`,
    { files: [{ originalSource: target.resourceUrl, contentType: "VIDEO", alt: filename }] }
  );
  if (created.fileCreate.userErrors.length > 0) {
    throw new Error(`fileCreate: ${JSON.stringify(created.fileCreate.userErrors)}`);
  }
  const fileId = created.fileCreate.files[0].id;

  // Video processing (transcoding) takes longer than images — poll with a longer budget.
  let finalUrl: string | undefined;
  for (let attempt = 0; attempt < 45; attempt++) {
    const check = await shopifyGraphQL<{ node: { id: string; fileStatus: string; sources?: { url: string; mimeType: string }[] } | null }>(
      `query checkVideo($id: ID!) { node(id: $id) { ... on Video { id fileStatus sources { url mimeType } } } }`,
      { id: fileId }
    );
    const status = check.node?.fileStatus;
    const sources = check.node?.sources || [];
    const mp4Sources = sources.filter((s) => s.mimeType === "video/mp4");
    // Prefer the highest-quality mp4 rendition Shopify generated (url embeds "SD-480p" / "HD-720p" etc).
    const mp4 = mp4Sources.find((s) => s.url.includes("HD-")) || mp4Sources[0] || sources[0];
    if (status === "READY" && mp4?.url) {
      finalUrl = mp4.url;
      break;
    }
    if (status === "FAILED") throw new Error(`Shopify kon de video niet verwerken (fileStatus FAILED): ${filename}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!finalUrl) throw new Error(`Video ${filename} (id ${fileId}) was na 90s nog niet "READY" bij Shopify — probeer het statusendpoint later opnieuw met dit ID.`);

  return { id: fileId, url: finalUrl };
}

export interface ShopPolicy {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
}

/** Reads the shop's built-in legal policies (Settings → Policies: refund/privacy/terms/shipping/legal notice). */
export async function getShopPolicies(): Promise<ShopPolicy[]> {
  const data = await shopifyGraphQL<{ shop: { shopPolicies: ShopPolicy[] } }>(
    `query { shop { shopPolicies { id type title body url } } }`
  );
  return data.shop.shopPolicies;
}

/**
 * Sets one of Shopify's built-in policy types (e.g. "TERMS_OF_SERVICE"), the
 * same fields as Instellingen → Beleid in the admin. This is a full replace of
 * that policy's body — callers should read getShopPolicies() first and decide
 * whether the existing content is worth keeping before calling this.
 */
export async function updateShopPolicy(type: string, bodyHtml: string): Promise<ShopPolicy> {
  const data = await shopifyGraphQL<{
    shopPolicyUpdate: { shopPolicy: ShopPolicy | null; userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation UpdatePolicy($shopPolicy: ShopPolicyInput!) {
      shopPolicyUpdate(shopPolicy: $shopPolicy) {
        shopPolicy { id type title body url }
        userErrors { field message }
      }
    }`,
    { shopPolicy: { type, body: bodyHtml } }
  );
  const { shopPolicy, userErrors } = data.shopPolicyUpdate;
  if (userErrors.length > 0) {
    throw new Error(`Shopify shopPolicyUpdate errors: ${JSON.stringify(userErrors)}`);
  }
  if (!shopPolicy) throw new Error("shopPolicyUpdate gaf geen policy terug.");
  return shopPolicy;
}
