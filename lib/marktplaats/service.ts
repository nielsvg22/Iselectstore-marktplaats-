import { buildProductPreview, ProductPreview } from "./orchestrator";
import { getTemplate } from "../templates/registry";
import { FIELD_LIBRARY } from "../templates/types";
import { AttributeMappingResult, getAttributeMapping } from "./mappingEngine";
import { getAttributesForProductType } from "./attributeCache";
import { ValidationResult } from "./validator";
import { MarktplaatsAttributeOption, MarktplaatsAttributeType, MarktplaatsCategoryAttribute } from "./types";

/**
 * MarktplaatsService — the ONE place that turns a Shopify product into
 * Marktplaats advertisement data.
 *
 * It deliberately delegates to the existing pipeline (orchestrator → mapping
 * engine → validator → payload builder) instead of re-implementing any of it,
 * so the future official API publisher and the local Playwright browser test
 * can never drift apart.
 */
export type DraftFieldKind = "text" | "textarea" | "select" | "number";

export type DraftFieldMappingStatus =
  | AttributeMappingResult["status"]
  | "mapped"
  | "no_matching_attribute";

export interface DraftField {
  /** Internal field key (= Shopify metafield key under `mkt`). */
  key: string;
  /** Our own label (FIELD_LIBRARY). */
  label: string;
  /** Shopify value incl. template defaults. */
  value: string;
  kind: DraftFieldKind;
  /** Resolved Marktplaats category attribute key (single source: attribute mapping table). */
  marktplaatsKey: string | null;
  /** Human label Marktplaats itself uses for that attribute. */
  marktplaatsLabel: string | null;
  marktplaatsType?: MarktplaatsAttributeType;
  marktplaatsOptions?: MarktplaatsAttributeOption[];
  mappingStatus: DraftFieldMappingStatus;
  /**
   * True when we *intend* this field to exist on Marktplaats (it is part of
   * the attribute mapping for this category). Used by the browser test to
   * decide between "⚠ niet gevonden" and a neutral "niet van toepassing".
   */
  expectsMarktplaatsField: boolean;
}

export interface AdvertisementDraft {
  shopifyProductId: string;
  productType: string;
  title: string;
  description: string;
  price: number;
  category: {
    l1CategoryId: string;
    l2CategoryId: string;
    l1CategoryName: string;
    l2CategoryName: string;
  } | null;
  fields: DraftField[];
  imageUrls: string[];
  validation: ValidationResult;
  /** Full preview incl. raw structured data — shared by every publisher. */
  preview: ProductPreview;
}

function nlLabel(attr: MarktplaatsCategoryAttribute): string | null {
  return attr.labels?.nl ?? attr.labels?.nl_NL ?? Object.values(attr.labels ?? {})[0] ?? null;
}

function kindForField(key: string): DraftFieldKind {
  const kind = FIELD_LIBRARY[key]?.kind;
  if (kind === "textarea") return "textarea";
  if (kind === "select" || kind === "boolean") return "select";
  if (kind === "number") return "number";
  return "text";
}

function displayValue(key: string, raw: string): string {
  if (FIELD_LIBRARY[key]?.kind !== "boolean") return raw;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "ja" || normalized === "yes") return "Ja";
  if (normalized === "false" || normalized === "nee" || normalized === "no") return "Nee";
  return raw;
}

export class MarktplaatsService {
  /**
   * Builds the Marktplaats advertisement data for one Shopify product using
   * exactly the mapping/validation used for the official API.
   */
  async buildAdvertisement(shopifyProductId: string): Promise<AdvertisementDraft> {
    const preview = await buildProductPreview(shopifyProductId);
    const template = getTemplate(preview.productType);
    if (!template) {
      throw new Error(`Geen producttemplate gevonden voor "${preview.productType}".`);
    }

    const { attributes } = await getAttributesForProductType(preview.productType);
    const attributesByKey = new Map(attributes.map((a) => [a.key, a]));
    const fieldMapping = preview.categoryMapping
      ? await getAttributeMapping(preview.categoryMapping.l2CategoryId)
      : {};
    const resultsByKey = new Map(preview.attributeResults.map((r) => [r.internalField, r]));

    const fields: DraftField[] = [];
    for (const field of template.fields) {
      const raw = preview.data[field.key];
      if (!raw || raw.trim().length === 0) continue;

      const mpKey = fieldMapping[field.key] ?? null;
      const attr = mpKey ? attributesByKey.get(mpKey) ?? null : null;
      const result = resultsByKey.get(field.key);

      let mappingStatus: DraftFieldMappingStatus;
      if (result && result.status !== "missing_value") {
        mappingStatus = result.status;
      } else if (mpKey && attr) {
        mappingStatus = "mapped";
      } else {
        mappingStatus = "no_matching_attribute";
      }

      fields.push({
        key: field.key,
        label: field.label,
        value: displayValue(field.key, raw.trim()),
        kind: kindForField(field.key),
        marktplaatsKey: mpKey && attr ? mpKey : null,
        marktplaatsLabel: attr ? nlLabel(attr) : null,
        marktplaatsType: attr?.type,
        marktplaatsOptions: attr?.options,
        mappingStatus,
        expectsMarktplaatsField: Boolean(result) || Boolean(mpKey && attr),
      });
    }

    return {
      shopifyProductId: preview.shopifyProductId,
      productType: preview.productType,
      title: preview.marktplaatsTitle,
      description: preview.marktplaatsDescription,
      price: Number(preview.payloadPreview.priceModel.askingPrice ?? 0),
      category: preview.categoryMapping
        ? {
            l1CategoryId: preview.categoryMapping.l1CategoryId,
            l2CategoryId: preview.categoryMapping.l2CategoryId,
            l1CategoryName: preview.categoryMapping.l1CategoryName,
            l2CategoryName: preview.categoryMapping.l2CategoryName,
          }
        : null,
      fields,
      imageUrls: preview.imageUrls,
      validation: preview.validation,
      preview,
    };
  }

  /** Preflight validation for a draft — same checks the API publish path uses. */
  validateAdvertisement(draft: AdvertisementDraft): ValidationResult {
    return draft.validation;
  }
}

export const marktplaatsService = new MarktplaatsService();
