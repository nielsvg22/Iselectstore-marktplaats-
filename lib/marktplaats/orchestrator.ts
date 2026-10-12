import { getProduct, getStructuredFields, ShopifyProduct } from "../shopify/client";
import { getTemplate } from "../templates/registry";
import { ProductTemplate } from "../templates/types";
import { getCategoryMapping } from "./categoryService";
import { getAttributesForProductType } from "./attributeCache";
import { mapProductToAttributes, AttributeMappingResult } from "./mappingEngine";
import { generateShopifyTitle, generateMarktplaatsTitle } from "./titleGenerator";
import { generateMarktplaatsDescription } from "./descriptionGenerator";
import { runPreflightValidation, ValidationResult } from "./validator";
import { buildMarktplaatsPayload } from "./payloadBuilder";
import { query } from "../db";

export interface ProductPreview {
  shopifyProductId: string;
  productType: string;
  shopifyTitle: string;
  marktplaatsTitle: string;
  marktplaatsDescription: string;
  categoryMapping: Awaited<ReturnType<typeof getCategoryMapping>>;
  mappingSource: "mock" | "cache" | "live";
  attributeResults: AttributeMappingResult[];
  validation: ValidationResult;
  payloadPreview: ReturnType<typeof buildMarktplaatsPayload>;
  imageUrls: string[];
  /**
   * Shopify's variant `barcode` field, real EAN/UPC data when the merchant
   * set one — never invented. null when Shopify has no barcode for the
   * first variant. Consumed by lib/goedgeplaatst/mapper.ts to auto-fill the
   * GoedGeplaatst "ean" attribute; a manual override in the portal is only
   * used as a fallback when this is null (see GoedgeplaatstSection).
   */
  ean: string | null;
  /**
   * Resolved template + structured Shopify metafield data (mkt.*) incl.
   * template defaults — the single input the mapping was computed from.
   * Exposed so downstream publishers (the future official API publisher
   * lib/marktplaats/apiPublisher.ts and the local Playwright browser test
   * lib/marktplaats/browserTest/) can reuse the exact same values without
   * re-reading or re-deriving them (rule: one mapping, reused everywhere).
   */
  template: ProductTemplate;
  data: Record<string, string>;
  price: number;
}

async function getStoredOverrides(shopifyProductId: string): Promise<{ customTitle?: string; customDescription?: string }> {
  const rows = await query<{ custom_title: string | null; custom_description: string | null }>(
    "SELECT custom_title, custom_description FROM marktplaats_product WHERE shopify_product_id = $1",
    [shopifyProductId]
  );
  const row = rows[0];
  return { customTitle: row?.custom_title ?? undefined, customDescription: row?.custom_description ?? undefined };
}

/**
 * Runs the full, side-effect-free pipeline used by both "Test Marktplaats
 * mapping" and the preview step before a real publish (FASE 26 / #18).
 */
export async function buildProductPreview(shopifyProductId: string): Promise<ProductPreview> {
  const product: ShopifyProduct = await getProduct(shopifyProductId);
  const rawData = await getStructuredFields(shopifyProductId);
  const overrides = await getStoredOverrides(shopifyProductId);

  const template = getTemplate(product.product_type);
  if (!template) {
    throw new Error(`Geen producttemplate gevonden voor Shopify product type "${product.product_type}". Ondersteund: iPhone, iPad, MacBook, iMac, Mac mini, Apple Watch.`);
  }

  // Fill in constant/sensible defaults (e.g. manufacturer info, "zonder
  // abonnement") for fields the merchant left empty in Shopify.
  const data: Record<string, string> = { ...rawData };
  for (const field of template.fields) {
    if ((!data[field.key] || data[field.key].trim().length === 0) && field.default) {
      data[field.key] = field.default;
    }
  }

  const shopifyTitle = generateShopifyTitle(template, data);
  const marktplaatsTitle = generateMarktplaatsTitle(template, data, shopifyTitle, overrides.customTitle);
  const marktplaatsDescription = generateMarktplaatsDescription(template, data, shopifyTitle, product.body_html, overrides.customDescription);

  const { mapping, attributes, source } = await getAttributesForProductType(product.product_type);
  const attributeResults = await mapProductToAttributes(template, data, mapping.l2CategoryId, attributes);

  const imageUrls = product.images.sort((a, b) => a.position - b.position).map((img) => img.src);
  const price = Number(product.variants[0]?.price ?? 0);
  const rawBarcode = product.variants[0]?.barcode ?? null;
  const ean = rawBarcode && rawBarcode.trim().length > 0 ? rawBarcode.trim() : null;

  const validation = runPreflightValidation({
    template,
    data,
    categoryMapping: mapping,
    attributeResults,
    title: marktplaatsTitle,
    description: marktplaatsDescription,
    imageCount: imageUrls.length,
  });

  const payloadPreview = buildMarktplaatsPayload({
    categoryMapping: mapping,
    title: marktplaatsTitle,
    description: marktplaatsDescription,
    price,
    attributeResults,
    imageUrls,
  });

  return {
    shopifyProductId,
    productType: product.product_type,
    shopifyTitle,
    marktplaatsTitle,
    marktplaatsDescription,
    categoryMapping: mapping,
    mappingSource: source,
    attributeResults,
    validation,
    payloadPreview,
    imageUrls,
    ean,
    template,
    data,
    price,
  };
}
