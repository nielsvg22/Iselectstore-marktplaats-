// ProductImageRecognitionService — the only place that talks to a
// VisionProvider. Deliberately has no knowledge of Shopify's REST client, the
// Marktplaats mapping engine, or any UI. Callers (API routes) are
// responsible for fetching existing field values and for writing confirmed
// results back to Shopify.
import { ShopifyProductType } from "../templates/types";
import { FIELD_LIBRARY } from "../templates/types";
import { ALLOWED_AI_FIELDS } from "./allowedFields";
import { normalizeField } from "./normalize";
import { confidenceLevel } from "./types";
import type { ImageInput, RecognitionResult, RecognizedField, VisionProvider } from "./types";

const MIN_CONFIDENCE_TO_SHOW = 0.3;

// All photos are assumed to be of the same physical product and are sent to
// the vision provider together in a single call, so it can combine
// information across them itself (a battery screenshot plus an "About this
// Mac" screenshot, say) instead of the app reconciling per-photo answers.
export const MAX_IMAGES_PER_ANALYSIS = 5;

export class ProductImageRecognitionService {
  constructor(private provider: VisionProvider) {}

  async recognize(params: {
    productType: ShopifyProductType;
    images: ImageInput[];
    existingValues?: Record<string, string>;
  }): Promise<RecognitionResult> {
    const { productType, existingValues = {} } = params;

    const allowedFieldKeys = ALLOWED_AI_FIELDS[productType];
    if (!allowedFieldKeys || allowedFieldKeys.length === 0) {
      throw new Error(`Geen AI-herkenning beschikbaar voor producttype "${productType}".`);
    }
    if (params.images.length === 0) {
      throw new Error("Geen afbeelding ontvangen.");
    }

    const images = params.images.slice(0, MAX_IMAGES_PER_ANALYSIS);
    const warnings: string[] = [];
    if (params.images.length > MAX_IMAGES_PER_ANALYSIS) {
      warnings.push(`Alleen de eerste ${MAX_IMAGES_PER_ANALYSIS} foto's zijn geanalyseerd (maximum per analyse).`);
    }

    const fieldLabels: Record<string, string> = {};
    for (const key of allowedFieldKeys) fieldLabels[key] = FIELD_LIBRARY[key]?.label ?? key;

    let raw;
    try {
      raw = await this.provider.analyzeImage({ images, productType, allowedFieldKeys, fieldLabels });
    } catch (err) {
      // Log the real provider error server-side (status codes, rate limits,
      // ...) but never leak provider internals to the client response.
      console.error("ProductImageRecognitionService: provider error", err);
      throw new Error("De AI-service is tijdelijk niet beschikbaar.");
    }
    warnings.push(...raw.warnings);

    if (Object.keys(raw.fields).length === 0) {
      warnings.push("Er is geen productinformatie gevonden op de geüploade foto('s).");
    }

    const fields: RecognizedField[] = [];
    const omittedFields: RecognitionResult["omittedFields"] = [];

    for (const key of allowedFieldKeys) {
      const f = raw.fields[key];
      if (!f || f.value === null || f.value === undefined || f.confidence < MIN_CONFIDENCE_TO_SHOW) {
        omittedFields.push({ key, label: fieldLabels[key], reason: "Niet gevonden of te onzeker op de foto('s)." });
        continue;
      }
      const normalized = normalizeField(key, f.value);
      if (normalized === null) {
        omittedFields.push({ key, label: fieldLabels[key], reason: "Niet gevonden of te onzeker op de foto('s)." });
        continue;
      }

      const recognized: RecognizedField = {
        key,
        label: fieldLabels[key],
        value: normalized,
        confidence: f.confidence,
        level: confidenceLevel(f.confidence),
      };

      const existing = existingValues[key];
      if (existing !== undefined && existing !== "" && String(existing) !== String(normalized)) {
        recognized.existingValue = existing;
        recognized.differsFromExisting = true;
      }

      fields.push(recognized);
    }

    return { productType, fields, omittedFields, warnings, raw };
  }
}
