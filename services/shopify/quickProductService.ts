// Quick-create / quick-edit product service behind the Admin UI extension.
// Reuses the existing Shopify REST client, template registry and title
// generators so a product created here is indistinguishable from one created
// through the regular admin flow: same vendor/tags, tracked inventory of 1,
// structured `mkt` metafields + storefront `custom` mirror, which keeps the
// Marktplaats publish flow, voorraadmeldingen, admin panel and AI flow working
// without any changes.
import {
  getProduct,
  createProduct,
  updateProduct,
  setProductMetafields,
  getStructuredFields,
  addProductImage,
  ShopifyProduct,
} from "@/lib/shopify/client";
import { getTemplate, listProductTypes } from "@/lib/templates/registry";
import {
  validateQuickProductData,
  applyTemplateDefaults,
  QuickProductIssue,
} from "@/lib/templates/quickProduct";
import { metafieldsForTemplateData } from "@/lib/shopify/metafields";
import {
  generateShopifyTitle,
  generateMarktplaatsTitle,
} from "@/lib/marktplaats/titleGenerator";
import { logSync } from "@/lib/logging";
import { query } from "@/lib/db";

export type ProductStatus = "draft" | "active";

export class QuickProductError extends Error {
  constructor(
    message: string,
    public status: number = 400,
    public issues?: QuickProductIssue[]
  ) {
    super(message);
    this.name = "QuickProductError";
  }
}

export interface QuickProductResult {
  productId: string;
  title: string;
  handle?: string;
  status?: string;
  productType: string;
  shopifyTitle: string;
  marktplaatsTitle: string;
}

export interface QuickProductRead {
  productId: string;
  productType: string;
  knownProductTypes: string[];
  title: string;
  status?: string;
  shopifyTitle: string;
  marktplaatsTitle: string;
  values: Record<string, string>;
}

function assertProductId(productId: string): string {
  const id = String(productId || "").trim();
  if (!/^\d+$/.test(id)) {
    throw new QuickProductError("Ongeldig product-id.", 400);
  }
  return id;
}

function validateOrThrow(
  productType: string,
  values: Record<string, unknown>
): Record<string, string> {
  const result = validateQuickProductData(productType, values);
  if (!result.ok) {
    throw new QuickProductError(
      "Vul de gemarkeerde velden correct in.",
      400,
      result.issues
    );
  }
  return result.values;
}

function buildTitles(
  productType: string,
  values: Record<string, string>
): { shopifyTitle: string; marktplaatsTitle: string } {
  const template = getTemplate(productType);
  if (!template) {
    throw new QuickProductError("Onbekend producttype.", 400);
  }
  const shopifyTitle = generateShopifyTitle(template, values);
  if (shopifyTitle.trim().length === 0) {
    throw new QuickProductError(
      "De Shopify-titel komt leeg uit de titelvelden — vul minstens de titelvelden in.",
      400,
      [{ key: "model", message: "De titelvelden moeten minstens één waarde hebben." }]
    );
  }
  const marktplaatsTitle = generateMarktplaatsTitle(template, values, shopifyTitle);
  return { shopifyTitle, marktplaatsTitle };
}

async function getProductOr404(productId: string): Promise<ShopifyProduct> {
  try {
    return await getProduct(productId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      throw new QuickProductError("Product niet gevonden.", 404);
    }
    throw new QuickProductError("Het product kon niet worden geladen.", 502);
  }
}

async function storedMarktplaatsOverride(
  productId: string
): Promise<{ customTitle?: string }> {
  try {
    const rows = await query<{ custom_title: string | null }>(
      "SELECT custom_title FROM marktplaats_product WHERE shopify_product_id = $1",
      [productId]
    );
    return { customTitle: rows[0]?.custom_title ?? undefined };
  } catch {
    return {};
  }
}

export interface CreateQuickProductInput {
  productType: string;
  values: Record<string, unknown>;
  status: ProductStatus;
}

export async function createQuickProduct(
  input: CreateQuickProductInput
): Promise<QuickProductResult> {
  if (input.status !== "draft" && input.status !== "active") {
    throw new QuickProductError("Status moet 'draft' of 'active' zijn.", 400);
  }
  const template = getTemplate(input.productType);
  if (!template) {
    throw new QuickProductError("Onbekend producttype.", 400, [
      { key: "productType", message: "Kies een geldig producttype." },
    ]);
  }

  const values = validateOrThrow(input.productType, input.values);
  const { shopifyTitle, marktplaatsTitle } = buildTitles(input.productType, values);

  const product = await createProduct({
    title: shopifyTitle,
    product_type: input.productType,
    vendor: "iSelectStore",
    tags: `${input.productType}, pre-owned`,
    status: input.status,
    variants: [
      {
        price: values.sell_price,
        compare_at_price: values.new_price || null,
        inventory_management: "shopify",
        inventory_quantity: 1,
        inventory_policy: "deny",
        requires_shipping: true,
        taxable: true,
        fulfillment_service: "manual",
      },
    ],
  });

  const productId = String(product.id);
  const writes = metafieldsForTemplateData(template, values);
  await setProductMetafields(productId, writes);

  await logSync({
    shopifyProductId: productId,
    action: "quick_create",
    message: `type=${input.productType} status=${input.status} metafields=${writes.length} title=${shopifyTitle}`,
  });

  return {
    productId,
    title: product.title,
    handle: product.handle,
    status: input.status,
    productType: input.productType,
    shopifyTitle,
    marktplaatsTitle,
  };
}

export interface UpdateQuickProductInput {
  productId: string;
  productType: string;
  values: Record<string, unknown>;
}

export async function updateQuickProduct(
  input: UpdateQuickProductInput
): Promise<QuickProductResult> {
  const productId = assertProductId(input.productId);
  const existing = await getProductOr404(productId);
  const template = getTemplate(input.productType);
  if (!template) {
    throw new QuickProductError("Onbekend producttype.", 400, [
      { key: "productType", message: "Kies een geldig producttype." },
    ]);
  }

  const values = validateOrThrow(input.productType, input.values);
  const { shopifyTitle, marktplaatsTitle } = buildTitles(input.productType, values);

  const typeChanged = existing.product_type !== input.productType;
  const variant = existing.variants[0];
  const productUpdate: Record<string, unknown> = {
    title: shopifyTitle,
    product_type: input.productType,
  };
  if (typeChanged) {
    // Keep the tag convention in sync when the merchant switches template.
    productUpdate.tags = `${input.productType}, pre-owned`;
  }
  if (variant) {
    productUpdate.variants = [
      {
        id: variant.id,
        price: values.sell_price,
        compare_at_price: values.new_price || null,
      },
    ];
  }

  const updated = await updateProduct(productId, productUpdate);
  const writes = metafieldsForTemplateData(template, values);
  await setProductMetafields(productId, writes);

  await logSync({
    shopifyProductId: productId,
    action: "quick_update",
    message: `type=${input.productType} metafields=${writes.length} title=${shopifyTitle}`,
  });

  return {
    productId,
    title: updated.title,
    handle: updated.handle,
    status: updated.status,
    productType: input.productType,
    shopifyTitle,
    marktplaatsTitle,
  };
}

export async function readQuickProduct(productId: string): Promise<QuickProductRead> {
  const id = assertProductId(productId);
  const product: ShopifyProduct = await getProductOr404(id);
  const raw = await getStructuredFields(id);
  const override = await storedMarktplaatsOverride(id);

  const productType = product.product_type;
  const template = getTemplate(productType);

  const values: Record<string, string> = {};
  if (template) {
    for (const field of template.fields) {
      const value = raw[field.key];
      if (value !== undefined && String(value).trim() !== "") {
        values[field.key] = String(value);
      } else if (field.default !== undefined) {
        values[field.key] = field.default;
      }
    }
    // The variant is the authoritative price: show what Shopify has right now
    // (and write it back to the metafield on save, fixing any drift).
    const variant = product.variants[0];
    if (variant) {
      values.sell_price = variant.price;
      if (variant.compare_at_price) values.new_price = variant.compare_at_price;
      else delete values.new_price;
    }
  }

  const shopifyTitle = template
    ? generateShopifyTitle(template, applyTemplateDefaults(template, values))
    : product.title;
  const marktplaatsTitle = template
    ? generateMarktplaatsTitle(
        template,
        applyTemplateDefaults(template, values),
        shopifyTitle,
        override.customTitle
      )
    : product.title;

  return {
    productId: id,
    productType,
    knownProductTypes: listProductTypes(),
    title: product.title,
    status: product.status,
    shopifyTitle,
    marktplaatsTitle,
    values,
  };
}


const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export async function addQuickProductImage(
  productId: string,
  filename: string,
  dataBase64: string
): Promise<{ imageId: number; src?: string }> {
  const id = assertProductId(productId);

  const safeName = String(filename || "").split(/[\\/]/).pop() || "product-image.jpg";
  if (!/\.(jpe?g|png|webp|gif)$/i.test(safeName)) {
    throw new QuickProductError(
      "Alleen JPG, PNG, WebP of GIF-afbeeldingen worden ondersteund.",
      400
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(String(dataBase64 || ""), "base64");
  } catch {
    throw new QuickProductError("Ongeldige afbeeldingsdata.", 400);
  }
  if (buffer.length === 0) {
    throw new QuickProductError("Ongeldige afbeeldingsdata.", 400);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new QuickProductError(
      "Afbeelding is te groot — maximaal 3 MB per afbeelding.",
      400
    );
  }
  const mime = buffer.subarray(0, 4).toString("hex");
  const isImage =
    (mime.startsWith("ffd8ff") && /\.jpe?g$/i.test(safeName)) ||
    (mime === "89504e47" && /\.png$/i.test(safeName)) ||
    (mime.startsWith("474946") && /\.gif$/i.test(safeName)) ||
    (/^52494646/.test(mime) && /\.webp$/i.test(safeName));
  if (!isImage) {
    throw new QuickProductError(
      "Het bestand lijkt geen geldige afbeelding te zijn.",
      400
    );
  }

  const image = await addProductImage(id, buffer, safeName);
  await logSync({
    shopifyProductId: id,
    action: "quick_image",
    message: `file=${safeName} bytes=${buffer.length}`,
  });
  return { imageId: image.id, src: image.src };
}
