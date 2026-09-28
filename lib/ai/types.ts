import { ShopifyProductType } from "../templates/types";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return "HIGH";
  if (confidence >= 0.7) return "MEDIUM";
  return "LOW";
}

export interface ImageInput {
  /** data: URL (base64) — never a bare filesystem path or externally-fetched URL. */
  dataUrl: string;
  filename?: string;
}

/** One field as returned directly by a VisionProvider, before normalization. */
export interface RawFieldResult {
  value: string | number | boolean | null;
  confidence: number;
}

export interface VisionAnalysisResult {
  fields: Record<string, RawFieldResult>;
  warnings: string[];
}

export interface VisionAnalysisInput {
  images: ImageInput[];
  productType: ShopifyProductType;
  allowedFieldKeys: string[];
  fieldLabels: Record<string, string>;
}

/** Abstraction so the underlying AI/vision vendor can be swapped without touching the service or UI.
 * `images` holds every photo for one recognition call (1-5, see MAX_IMAGES_PER_ANALYSIS in
 * productImageRecognitionService.ts) — a provider combines information across all of them in a
 * single API call rather than being called once per photo. */
export interface VisionProvider {
  analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisResult>;
}

export interface RecognizedField {
  key: string;
  label: string;
  value: string | number;
  confidence: number;
  level: ConfidenceLevel;
  existingValue?: string;
  differsFromExisting?: boolean;
  /** No longer produced: all photos are analyzed together in a single call, so the
   * provider itself reconciles disagreements between photos. Kept optional so old
   * UI code that still checks it degrades gracefully instead of breaking. */
  sourceConflict?: { imageIndex: number; filename?: string; value: string | number }[];
}

export interface RecognitionResult {
  productType: ShopifyProductType;
  fields: RecognizedField[];
  omittedFields: { key: string; label: string; reason: string }[];
  warnings: string[];
  raw: VisionAnalysisResult;
}
