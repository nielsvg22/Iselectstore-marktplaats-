// Turns either (a) the manual test form, or (b) the shared Shopify pipeline
// output (lib/marktplaats/orchestrator.ts buildProductPreview — reused as-is,
// never re-implemented, per the assignment) into a GoedGeplaatst
// POST /ads/ body. Mirrors how lib/marktplaats/payloadBuilder.ts does the
// same job for the official Marktplaats API client.

import { ProductPreview } from "../marktplaats/orchestrator";
import { CONDITION_ATTRIBUTE_MAP, formatStorageValue } from "../marktplaats/feedBuilder";
import { GPSR_MANUFACTURER_ATTRIBUTE_KEYS, GoedgeplaatstAttributeDefinition, GoedgeplaatstCreateAdInput } from "./types";
import { assertConceptStatusOnly, ManufacturerInfo } from "./config";

export interface ManualAdInput {
  title: string;
  description: string;
  /** Euros, e.g. 249.95 — converted to cents below. */
  priceEuros: number;
  imageUrls: string[];
}

export interface MappedAttributeStatus {
  key: string;
  label: string;
  mandatory: boolean;
  value: string | number | null;
  /** "manual" = filled in through the portal's own invulveld (e.g. delivery, or EAN when Shopify has none) — never a Shopify or config value. */
  source: "shopify" | "manufacturer-config" | "manual" | "missing";
}

/**
 * Portal invulvelden (opdracht-punt 6) for attributes with no Shopify
 * source (delivery) or an optional Shopify-first fallback (ean). Never
 * invents a value by itself — only what the user actually typed/picked.
 */
export interface ManualAttributeOverrides {
  delivery?: string;
  ean?: string;
}

export interface AdMappingResult {
  payload: GoedgeplaatstCreateAdInput;
  attributeStatuses: MappedAttributeStatus[];
  /** True when any mandatory attribute (incl. GPSR manufacturer fields) could not be filled. */
  missingMandatory: string[];
}

function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Fills GPSR/DSA manufacturer attributes (manufacturerTradename,
 * manufacturerAddress, manufacturerEmail) from env-sourced config whenever
 * the category's attribute list marks them mandatory (STAP 3: mandatory
 * since 1 Feb 2025 for DSA-authorised business sellers). Never invents a
 * value — a missing config value is reported in `missingMandatory`, not
 * silently made up.
 */
function resolveAttributes(
  categoryAttributes: GoedgeplaatstAttributeDefinition[],
  shopifyValues: Record<string, string | number>,
  manufacturer: ManufacturerInfo,
  manualKeys: Set<string> = new Set()
): { statuses: MappedAttributeStatus[]; missingMandatory: string[] } {
  const statuses: MappedAttributeStatus[] = [];
  const missingMandatory: string[] = [];

  for (const attr of categoryAttributes) {
    if (!attr.writable) continue;

    let value: string | number | null = null;
    let source: MappedAttributeStatus["source"] = "missing";

    if (GPSR_MANUFACTURER_ATTRIBUTE_KEYS.includes(attr.key as (typeof GPSR_MANUFACTURER_ATTRIBUTE_KEYS)[number])) {
      const fromConfig =
        attr.key === "manufacturerTradename" ? manufacturer.tradename : attr.key === "manufacturerAddress" ? manufacturer.address : manufacturer.email;
      if (fromConfig) {
        value = fromConfig;
        source = "manufacturer-config";
      }
    } else if (shopifyValues[attr.key] !== undefined && shopifyValues[attr.key] !== "") {
      const raw = shopifyValues[attr.key];
      // GoedGeplaatst's "condition"/"storage" enums are byte-for-byte the
      // same vocabulary as Marktplaats' own (confirmed live, see
      // feedBuilder.ts) — our internal 4-tier Dutch condition string and
      // bare-number storage value need the same conversion applied there,
      // or GoedGeplaatst rejects/mismatches the value.
      if (attr.key === "condition" && typeof raw === "string") {
        value = CONDITION_ATTRIBUTE_MAP[raw] ?? raw;
      } else if (attr.key === "storage" && typeof raw === "string") {
        value = formatStorageValue(raw);
      } else {
        value = raw;
      }
      source = manualKeys.has(attr.key) ? "manual" : "shopify";
    }

    statuses.push({ key: attr.key, label: attr.label, mandatory: attr.mandatory, value, source });
    if (attr.mandatory && value === null) missingMandatory.push(attr.key);
  }

  return { statuses, missingMandatory };
}

/**
 * Merges the portal's manual invulvelden (delivery/ean) into the
 * shopify-derived attribute values, WITHOUT overwriting a real Shopify
 * value that is already present (ean: Shopify's barcode always wins when
 * set — the manual field is only a fallback for products Shopify has none
 * for). Returns which keys ended up manually sourced so resolveAttributes
 * can label them correctly instead of claiming they came from Shopify.
 */
function applyManualOverrides(
  shopifyValues: Record<string, string | number>,
  overrides?: ManualAttributeOverrides
): { values: Record<string, string | number>; manualKeys: Set<string> } {
  const values = { ...shopifyValues };
  const manualKeys = new Set<string>();
  if (overrides?.delivery && overrides.delivery.trim().length > 0) {
    values.delivery = overrides.delivery.trim();
    manualKeys.add("delivery");
  }
  if (overrides?.ean && overrides.ean.trim().length > 0 && (values.ean === undefined || values.ean === "")) {
    values.ean = overrides.ean.trim();
    manualKeys.add("ean");
  }
  return { values, manualKeys };
}

export function buildManualAdPayload(params: {
  input: ManualAdInput;
  userId: number;
  categoryId: number;
  categoryAttributes: GoedgeplaatstAttributeDefinition[];
  manufacturer: ManufacturerInfo;
  manualOverrides?: ManualAttributeOverrides;
}): AdMappingResult {
  const { input, userId, categoryId, categoryAttributes, manufacturer, manualOverrides } = params;
  assertConceptStatusOnly("concept");

  const { values, manualKeys } = applyManualOverrides({}, manualOverrides);
  const { statuses, missingMandatory } = resolveAttributes(categoryAttributes, values, manufacturer, manualKeys);

  const payload: GoedgeplaatstCreateAdInput = {
    userId,
    status: "concept",
    type: "supply",
    title: input.title.slice(0, 60),
    description: input.description,
    categoryId,
    attributes: [
      {
        portal: "marktplaats",
        locale: "nl_NL",
        values: statuses.filter((s) => s.value !== null).map((s) => ({ key: s.key, value: s.value as string | number })),
      },
    ],
    price: { model: "fixed", price: toCents(input.priceEuros) },
  };

  return { payload, attributeStatuses: statuses, missingMandatory };
}

/**
 * Builds a GoedGeplaatst concept-ad payload from the SAME ProductPreview the
 * Playwright bot and the Admarkt feed use (orchestrator.buildProductPreview)
 * — the title/description/price/images this produces are therefore always
 * byte-for-byte consistent with what those two other placement paths show.
 * Marktplaats-specific attribute *keys* still need their own GoedGeplaatst
 * category/attribute mapping (categoryAttributes param) since GoedGeplaatst
 * category ids are not the same id space as our internal marktplaats
 * category mapping table.
 */
export function buildAdPayloadFromShopifyPreview(params: {
  preview: ProductPreview;
  userId: number;
  categoryId: number;
  categoryAttributes: GoedgeplaatstAttributeDefinition[];
  manufacturer: ManufacturerInfo;
  manualOverrides?: ManualAttributeOverrides;
}): AdMappingResult {
  const { preview, userId, categoryId, categoryAttributes, manufacturer, manualOverrides } = params;
  assertConceptStatusOnly("concept");

  // Deliberately `r.shopifyValue` (the raw Shopify-sourced value), NOT
  // `r.marktplaatsValue`. `marktplaatsValue` only gets set when
  // mapProductToAttributes() (lib/marktplaats/mappingEngine.ts) can validate
  // the value against the MARKTPLAATS-side attribute catalog
  // (attributeCache/getAttributesForProductType) — and that catalog is the
  // mock_-prefixed placeholder set in this deployment (confirmed live: every
  // single attribute, for a real iPhone product, came back
  // "no_matching_attribute" / marktplaatsValue: null, even though the
  // correct key — e.g. "storage", "type" — was already resolved). GoedGeplaatst
  // has its OWN, already-correct, independently-fetched attribute catalog
  // (listAttributesForCategory() above) that resolveAttributes() validates
  // writability/mandatory against below — we don't need or want Marktplaats'
  // separate (and here, broken) catalog in the loop at all. This mirrors
  // exactly how lib/marktplaats/feedBuilder.ts already does it for the
  // Admarkt feed (see its own module comment) — same trap, same fix.
  const shopifyValues: Record<string, string | number> = {};
  for (const r of preview.attributeResults) {
    if (r.marktplaatsAttributeKey && r.shopifyValue && r.shopifyValue.trim().length > 0) {
      shopifyValues[r.marktplaatsAttributeKey] = r.shopifyValue;
    }
  }
  // Real, already-available Shopify data (variant barcode) — never invented.
  // Takes priority over a manual override below (see applyManualOverrides).
  if (preview.ean) {
    shopifyValues.ean = preview.ean;
  }

  const { values, manualKeys } = applyManualOverrides(shopifyValues, manualOverrides);
  const { statuses, missingMandatory } = resolveAttributes(categoryAttributes, values, manufacturer, manualKeys);

  // externalAdId: the assignment says this is required FOR PARTNER accounts
  // and, as a test value, to use the Shopify product id. Shopify's REST
  // product id is numeric; GraphQL gids (gid://shopify/Product/123) are not
  // — we extract the trailing numeric segment either way, and omit the
  // field entirely rather than send a non-numeric value GoedGeplaatst would
  // reject.
  const numericIdMatch = preview.shopifyProductId.match(/(\d+)\s*$/);
  const externalAdId = numericIdMatch ? Number(numericIdMatch[1]) : undefined;

  const payload: GoedgeplaatstCreateAdInput = {
    userId,
    status: "concept",
    externalAdId,
    type: "supply",
    title: preview.marktplaatsTitle.slice(0, 60),
    description: preview.marktplaatsDescription,
    categoryId,
    attributes: [
      {
        portal: "marktplaats",
        locale: "nl_NL",
        values: statuses.filter((s) => s.value !== null).map((s) => ({ key: s.key, value: s.value as string | number })),
      },
    ],
    price: { model: "fixed", price: toCents(preview.price) },
  };

  return { payload, attributeStatuses: statuses, missingMandatory };
}
