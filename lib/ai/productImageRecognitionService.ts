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

export class ProductImageRecognitionService {
  constructor(private provider: VisionProvider) {}

  async recognize(params: {
    productType: ShopifyProductType;
    images: ImageInput[];
    existingValues?: Record<string, string>;
  }): Promise<RecognitionResult> {
    const { productType, images, existingValues = {} } = params;

    const allowedFieldKeys = ALLOWED_AI_FIELDS[productType];
    if (!allowedFieldKeys || allowedFieldKeys.length === 0) {
      throw new Error(`Geen AI-herkenning beschikbaar voor producttype "${productType}".`);
    }
    if (images.length === 0) {
      throw new Error("Geen afbeelding ontvangen.");
    }

    const fieldLabels: Record<string, string> = {};
    for (const key of allowedFieldKeys) fieldLabels[key] = FIELD_LIBRARY[key]?.label ?? key;

    const raw: RecognitionResult["raw"] = [];
    const warnings: string[] = [];

    // Per-image analysis, not a single multi-image call: keeps conflict
    // detection deterministic and independently testable, rather than
    // trusting the model to reconcile disagreements itself.
    for (let i = 0; i < images.length; i++) {
      let result;
      try {
        result = await this.provider.analyzeImage({
          images: [images[i]],
          productType,
          allowedFieldKeys,
          fieldLabels,
        });
      } catch (err) {
        throw new Error("De AI-service is tijdelijk niet beschikbaar.");
      }
      raw.push({ imageIndex: i, result });
      warnings.push(...result.warnings.map((w) => (images.length > 1 ? `Foto ${i + 1}: ${w}` : w)));
    }

    if (raw.every((r) => Object.keys(r.result.fields).length === 0)) {
      warnings.push("Er is geen productinformatie gevonden op de geüploade foto('s).");
    }

    const fields: RecognizedField[] = [];
    const omittedFields: RecognitionResult["omittedFields"] = [];

    for (const key of allowedFieldKeys) {
      // Collect every image's answer for this field, normalizing as we go.
      const perImage: { imageIndex: number; filename?: string; value: string | number; confidence: number }[] = [];
      for (const { imageIndex, result } of raw) {
        const f = result.fields[key];
        if (!f || f.value === null || f.value === undefined) continue;
        if (f.confidence < MIN_CONFIDENCE_TO_SHOW) continue;
        const normalized = normalizeField(key, f.value);
        if (normalized === null) continue;
        perImage.push({ imageIndex, filename: images[imageIndex].filename, value: normalized, confidence: f.confidence });
      }

      if (perImage.length === 0) {
        omittedFields.push({ key, label: fieldLabels[key], reason: "Niet gevonden of te onzeker op de foto('s)." });
        continue;
      }

      // Conflict: two images disagree on the normalized value.
      const distinctValues = new Set(perImage.map((p) => String(p.value)));
      const best = perImage.reduce((a, b) => (b.confidence > a.confidence ? b : a));

      const recognized: RecognizedField = {
        key,
        label: fieldLabels[key],
        value: best.value,
        confidence: best.confidence,
        level: confidenceLevel(best.confidence),
      };

      if (distinctValues.size > 1) {
        recognized.sourceConflict = perImage.map((p) => ({ imageIndex: p.imageIndex, filename: p.filename, value: p.value }));
      }

      const existing = existingValues[key];
      if (existing !== undefined && existing !== "" && String(existing) !== String(best.value)) {
        recognized.existingValue = existing;
        recognized.differsFromExisting = true;
      }

      fields.push(recognized);
    }

    return { productType, fields, omittedFields, warnings, raw };
  }
}
