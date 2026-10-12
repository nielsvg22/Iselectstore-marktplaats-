// Turns either (a) the manual test form, or (b) the shared Shopify pipeline
// output (lib/marktplaats/orchestrator.ts buildProductPreview — reused as-is,
// never re-implemented, per the assignment) into a GoedGeplaatst
// POST /ads/ body. Mirrors how lib/marktplaats/payloadBuilder.ts does the
// same job for the official Marktplaats API client.

import { ProductPreview } from "../marktplaats/orchestrator";
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
  source: "shopify" | "manufacturer-config" | "missing";
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
  manufacturer: ManufacturerInfo
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
      value = shopifyValues[attr.key];
      source = "shopify";
    }

    statuses.push({ key: attr.key, label: attr.label, mandatory: attr.mandatory, value, source });
    if (attr.mandatory && value === null) missingMandatory.push(attr.key);
  }

  return { statuses, missingMandatory };
}

export function buildManualAdPayload(params: {
  input: ManualAdInput;
  userId: number;
  categoryId: number;
  categoryAttributes: GoedgeplaatstAttributeDefinition[];
  manufacturer: ManufacturerInfo;
}): AdMappingResult {
  const { input, userId, categoryId, categoryAttributes, manufacturer } = params;
  assertConceptStatusOnly("concept");

  const { statuses, missingMandatory } = resolveAttributes(categoryAttributes, {}, manufacturer);

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
}): AdMappingResult {
  const { preview, userId, categoryId, categoryAttributes, manufacturer } = params;
  assertConceptStatusOnly("concept");

  const shopifyValues: Record<string, string | number> = {};
  for (const r of preview.attributeResults) {
    if (r.marktplaatsAttributeKey && r.marktplaatsValue !== null) {
      shopifyValues[r.marktplaatsAttributeKey] = r.marktplaatsValue;
    }
  }

  const { statuses, missingMandatory } = resolveAttributes(categoryAttributes, shopifyValues, manufacturer);

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
