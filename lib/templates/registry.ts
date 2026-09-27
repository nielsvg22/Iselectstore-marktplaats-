import { FIELD_LIBRARY, ProductTemplate, ShopifyProductType, FieldDef } from "./types";

function fields(...keys: string[]): FieldDef[] {
  return keys.map((k) => {
    const f = FIELD_LIBRARY[k];
    if (!f) throw new Error(`Unknown field key in template: ${k}`);
    return f;
  });
}

const iphone: ProductTemplate = {
  productType: "iPhone",
  fields: fields(
    "model",
    "generation",
    "storage_gb",
    "color",
    "battery_percentage",
    "sim_type",
    "condition",
    "warranty_months",
    "accessories",
    "box_included",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["model", "storage_gb", "color"],
  shopifyFeatureFields: ["model", "storage_gb", "color", "sim_type", "battery_percentage", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "sim_type", "cosmetic_notes", "accessories", "box_included"],
  marktplaatsAttributes: ["model", "storage_gb", "color", "sim_type"],
};

const ipad: ProductTemplate = {
  productType: "iPad",
  fields: fields(
    "model",
    "generation",
    "screen_size",
    "storage_gb",
    "color",
    "wifi_cellular",
    "sim_type",
    "battery_percentage",
    "condition",
    "warranty_months",
    "apple_pencil_support",
    "accessories",
    "box_included",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["model", "storage_gb", "wifi_cellular"],
  shopifyFeatureFields: ["model", "screen_size", "storage_gb", "color", "wifi_cellular", "battery_percentage", "condition", "warranty_months", "apple_pencil_support"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "wifi_cellular", "apple_pencil_support", "cosmetic_notes", "accessories", "box_included"],
  marktplaatsAttributes: ["model", "storage_gb", "color", "wifi_cellular"],
};

const macbook: ProductTemplate = {
  productType: "MacBook",
  fields: fields(
    "model",
    "screen_size",
    "model_year",
    "chip",
    "cpu_variant",
    "gpu_variant",
    "ram_gb",
    "storage_gb",
    "color",
    "keyboard_layout",
    "battery_percentage",
    "cycle_count",
    "condition",
    "warranty_months",
    "accessories",
    "box_included",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["model", "screen_size", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "color", "chip", "battery_percentage", "condition", "warranty_months", "keyboard_layout", "cycle_count"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "cycle_count", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: ["model", "ram_gb", "storage_gb", "color", "chip"],
};

const imac: ProductTemplate = {
  productType: "iMac",
  fields: fields(
    "model",
    "screen_size",
    "model_year",
    "chip",
    "ram_gb",
    "storage_gb",
    "gpu_variant",
    "color",
    "keyboard_included",
    "mouse_included",
    "condition",
    "warranty_months",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["model", "screen_size", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "color", "chip", "condition", "warranty_months", "keyboard_included", "mouse_included"],
  marktplaatsTitleExtraFields: ["warranty_months"],
  marktplaatsDescriptionFields: ["warranty_months", "condition", "keyboard_included", "mouse_included", "cosmetic_notes"],
  marktplaatsAttributes: ["model", "ram_gb", "storage_gb", "color", "chip"],
};

const macmini: ProductTemplate = {
  productType: "Mac mini",
  fields: fields(
    "model",
    "model_year",
    "chip",
    "cpu_variant",
    "gpu_variant",
    "ram_gb",
    "storage_gb",
    "condition",
    "warranty_months",
    "accessories",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["model", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "chip", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["warranty_months"],
  marktplaatsDescriptionFields: ["warranty_months", "condition", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: ["model", "ram_gb", "storage_gb", "chip"],
};

const applewatch: ProductTemplate = {
  productType: "Apple Watch",
  fields: fields(
    "watch_series",
    "watch_case_size",
    "color",
    "watch_material",
    "watch_connectivity",
    "watch_band",
    "battery_percentage",
    "condition",
    "warranty_months",
    "accessories",
    "cosmetic_notes",
    "sell_price",
    "new_price"
  ),
  shopifyTitleFields: ["watch_series", "watch_case_size", "watch_connectivity"],
  shopifyFeatureFields: ["watch_series", "watch_case_size", "color", "watch_material", "watch_connectivity", "watch_band", "battery_percentage", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "watch_band", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: ["watch_series", "watch_case_size", "color", "watch_connectivity"],
};

export const PRODUCT_TEMPLATES: Record<ShopifyProductType, ProductTemplate> = {
  iPhone: iphone,
  iPad: ipad,
  MacBook: macbook,
  iMac: imac,
  "Mac mini": macmini,
  "Apple Watch": applewatch,
};

export function getTemplate(productType: string): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES[productType as ShopifyProductType];
}

export function listProductTypes(): ShopifyProductType[] {
  return Object.keys(PRODUCT_TEMPLATES) as ShopifyProductType[];
}
