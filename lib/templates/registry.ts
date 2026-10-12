import { FIELD_LIBRARY, ProductTemplate, ShopifyProductType, FieldDef } from "./types";

function fields(...keys: string[]): FieldDef[] {
  return keys.map((k) => {
    const f = FIELD_LIBRARY[k];
    if (!f) throw new Error(`Unknown field key in template: ${k}`);
    return f;
  });
}

/** Clones a FIELD_LIBRARY entry into a dropdown with a fixed set of options — used where free text led to real create-ad failures (see below). */
function withOptions(key: string, options: string[]): FieldDef {
  const base = FIELD_LIBRARY[key];
  if (!base) throw new Error(`Unknown field key in template: ${key}`);
  return { ...base, kind: "select", options };
}

/**
 * iPhone's "model"/"type" attribute at GoedGeplaatst (categoryId 1737) is a
 * fixed enum, not free text — live-confirmed via a real "invalid value"
 * error (2026-10-12) when a merchant typed "19 pro max" / "17 pro max"
 * (no such models, and missing the required "iPhone " prefix). Copied
 * byte-for-byte from that error's "valid options" list, including its
 * quirks (lowercase "xr"/"xs"/"xsmax", no bare "9"/"10" since those were
 * marketed as X). Never hand-edit this without a fresh live confirmation.
 */
const IPHONE_MODEL_OPTIONS = [
  "iPhone 2G Original", "iPhone 3G", "iPhone 3GS", "iPhone 4", "iPhone 4S",
  "iPhone 5", "iPhone 5C", "iPhone 5S", "iPhone 6", "iPhone 6 Plus",
  "iPhone 6S", "iPhone 6S Plus", "iPhone 7", "iPhone 7 Plus", "iPhone 8",
  "iPhone 8 Plus", "iPhone 11", "iPhone 11 Pro", "iPhone 11 Pro Max",
  "iPhone 12", "iPhone 12 Mini", "iPhone 12 Pro", "iPhone 12 Pro Max",
  "iPhone 13", "iPhone 13 mini", "iPhone 13 Pro", "iPhone 13 Pro Max",
  "iPhone 14", "iPhone 14 Plus", "iPhone 14 Pro", "iPhone 14 Pro Max",
  "iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max",
  "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max",
  "iPhone 16e", "iPhone 17 Air", "iPhone 17 Pro", "iPhone 17 Pro Max",
  "iPhone 17e", "iPhone 18 Pro", "iPhone 18 Pro Max", "iPhone Duo",
  "iPhone SE", "iPhone SE 2020", "iPhone SE (2022)", "iPhone X", "xr",
  "xs", "xsmax", "Overige typen",
];

/**
 * Same deal for "color" at categoryId 1737 — live-confirmed via the same
 * error when a merchant typed "Oranje" (not a supported color there at all).
 */
const IPHONE_COLOR_OPTIONS = ["Blauw", "Geel", "Goud", "Grijs", "Groen", "Paars", "Rood", "Roze", "Wit", "Zilver", "Zwart"];

/**
 * Dezelfde aanpak als iPhone's model/color hierboven, maar dan voor de
 * overige Apple-categorieën — live opgehaald via POST /attributes/ voor de
 * bijbehorende categoryId (zie lib/goedgeplaatst/categoryMap.ts), portal
 * "marktplaats", 2026-10-12. Elke categorie heeft zijn EIGEN kleur-/model-
 * enum bij GoedGeplaatst (bv. Apple Watch heeft wél "Oranje", iPhone niet)
 * — nooit hergebruiken tussen categorieën. Een categorie zonder
 * GoedGeplaatst-equivalent voor een veld (bv. geen "color" voor MacBook/
 * Mac mini, geen modelattribuut voor Apple Watch) krijgt hier bewust geen
 * dropdown — dat veld blijft vrije tekst, precies zoals
 * lib/goedgeplaatst/attributeMap.ts dat al documenteert.
 */
const IPAD_MODEL_OPTIONS = ["iPad", "iPad Air", "iPad Mini", "iPad Pro 1", "Overige modellen"];
const IPAD_COLOR_OPTIONS = ["Blauw", "goud", "Grijs", "Groen", "Rose Goud", "Wit", "zilver", "Zwart", "Overige kleuren"];
const MACBOOK_MODEL_OPTIONS = ["MacBook", "MacBook Pro", "MacBook Air", "Overige modellen"];
// categoryId 350 (Apple Desktops) is gedeeld tussen iMac en Mac mini — de
// volledige live enum is ["iMac Pro","iMac","Mac Mini","Mac Pro","Powermac",
// "Overige modellen"], hieronder bewust gesplitst per producttype (zelfde
// scoping als de bestaande matchEnumSubstring-lijsten) zodat een iMac-
// formulier geen "Mac Mini" als optie toont en andersom.
const IMAC_MODEL_OPTIONS = ["iMac Pro", "iMac", "Overige modellen"];
const MACMINI_MODEL_OPTIONS = ["Mac Mini", "Mac Pro", "Powermac", "Overige modellen"];
const APPLE_WATCH_COLOR_OPTIONS = ["Blauw", "Geel", "Grijs", "Groen", "Oranje", "Paars", "Rood", "Roze", "Wit", "Zilver", "Zwart"];

const iphone: ProductTemplate = {
  productType: "iPhone",
  fields: [
    withOptions("model", IPHONE_MODEL_OPTIONS),
    ...fields("generation", "storage_gb"),
    withOptions("color", IPHONE_COLOR_OPTIONS),
    ...fields(
      "battery_percentage",
      "sim_type",
      "subscription",
      "simlock",
      "condition",
      "warranty_months",
      "accessories",
      "box_included",
      "cosmetic_notes",
      "sell_price",
      "new_price",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["model", "storage_gb", "color"],
  shopifyFeatureFields: ["model", "storage_gb", "color", "sim_type", "battery_percentage", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "sim_type", "cosmetic_notes", "accessories", "box_included"],
  // Order matches the real Marktplaats "Telefoons | Apple" listing layout:
  // Conditie, Opslagcapaciteit, Abonnement, Simlock, Model, Batterijconditie,
  // Kleur, Handelsnaam fabrikant (EU GPSR field). "model" -> the real
  // discovered attribute key is "type" (marktplaats_attribute_mapping,
  // categoryId 225 — confirmed live against GoedGeplaatst's own /attributes/
  // for categoryId 1737 too, same key name "type"), was previously missing
  // here so the iPhone's model (e.g. "iPhone 15 Pro") never reached either
  // Marktplaats or GoedGeplaatst despite Shopify always having it.
  marktplaatsAttributes: [
    "condition",
    "storage_gb",
    "subscription",
    "simlock",
    "model",
    "battery_percentage",
    "color",
    "manufacturer_name",
  ],
};

const ipad: ProductTemplate = {
  productType: "iPad",
  fields: [
    withOptions("model", IPAD_MODEL_OPTIONS),
    ...fields("generation", "screen_size", "storage_gb"),
    withOptions("color", IPAD_COLOR_OPTIONS),
    ...fields(
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
      "new_price",
      "subscription",
      "simlock",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["model", "storage_gb", "wifi_cellular"],
  shopifyFeatureFields: ["model", "screen_size", "storage_gb", "color", "wifi_cellular", "battery_percentage", "condition", "warranty_months", "apple_pencil_support"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "wifi_cellular", "apple_pencil_support", "cosmetic_notes", "accessories", "box_included"],
  marktplaatsAttributes: [
    "condition",
    "storage_gb",
    "subscription",
    "simlock",
    "battery_percentage",
    "color",
    "manufacturer_name",
  ],
};

const macbook: ProductTemplate = {
  productType: "MacBook",
  fields: [
    withOptions("model", MACBOOK_MODEL_OPTIONS),
    ...fields(
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
      "new_price",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["model", "screen_size", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "color", "chip", "battery_percentage", "condition", "warranty_months", "keyboard_layout", "cycle_count"],
  // Advertentietitel: "MacBook Air M1 256GB grijs / 88% batt / zeer net / garantie"
  // — compact gehouden omdat Marktplaats max 60 tekens toelaat.
  marktplaatsTitleFields: ["model", "chip", "storage_gb", "color"],
  marktplaatsTitleExtraFields: ["battery_percentage", "condition", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "cycle_count", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: ["condition", "ram_gb", "storage_gb", "color", "chip", "manufacturer_name"],
};

const imac: ProductTemplate = {
  productType: "iMac",
  fields: [
    withOptions("model", IMAC_MODEL_OPTIONS),
    ...fields(
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
      "new_price",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["model", "screen_size", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "color", "chip", "condition", "warranty_months", "keyboard_included", "mouse_included"],
  marktplaatsTitleExtraFields: ["warranty_months"],
  marktplaatsDescriptionFields: ["warranty_months", "condition", "keyboard_included", "mouse_included", "cosmetic_notes"],
  marktplaatsAttributes: ["condition", "ram_gb", "storage_gb", "color", "chip", "manufacturer_name"],
};

const macmini: ProductTemplate = {
  productType: "Mac mini",
  fields: [
    withOptions("model", MACMINI_MODEL_OPTIONS),
    ...fields(
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
      "new_price",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["model", "chip", "ram_gb", "storage_gb"],
  shopifyFeatureFields: ["model", "ram_gb", "storage_gb", "chip", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["warranty_months"],
  marktplaatsDescriptionFields: ["warranty_months", "condition", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: ["condition", "ram_gb", "storage_gb", "chip", "manufacturer_name"],
};

const applewatch: ProductTemplate = {
  productType: "Apple Watch",
  fields: [
    ...fields("watch_series", "watch_case_size"),
    withOptions("color", APPLE_WATCH_COLOR_OPTIONS),
    ...fields(
      "watch_material",
      "watch_connectivity",
      "watch_band",
      "battery_percentage",
      "condition",
      "warranty_months",
      "accessories",
      "cosmetic_notes",
      "sell_price",
      "new_price",
      "subscription",
      "simlock",
      "manufacturer_name",
    ),
  ],
  shopifyTitleFields: ["watch_series", "watch_case_size", "watch_connectivity"],
  shopifyFeatureFields: ["watch_series", "watch_case_size", "color", "watch_material", "watch_connectivity", "watch_band", "battery_percentage", "condition", "warranty_months"],
  marktplaatsTitleExtraFields: ["battery_percentage", "warranty_months"],
  marktplaatsDescriptionFields: ["battery_percentage", "warranty_months", "condition", "watch_band", "accessories", "cosmetic_notes"],
  marktplaatsAttributes: [
    "condition",
    "watch_case_size",
    "subscription",
    "simlock",
    "battery_percentage",
    "color",
    "manufacturer_name",
  ],
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
