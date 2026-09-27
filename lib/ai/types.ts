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

/** Abstraction so the underlying AI/vision vendor can be swapped without touching the service or UI. */
export interface VisionProvider {
  analyzeImage(input: VisionAnalysisInput & { images: [ImageInput] }): Promise<VisionAnalysisResult>;
}

export interface RecognizedField {
  key: string;
  label: string;
  value: string | number;
  confidence: number;
  level: ConfidenceLevel;
  existingValue?: string;
  differsFromExisting?: boolean;
  sourceConflict?: { imageIndex: number; filename?: string; value: string | number }[];
}

export interface RecognitionResult {
  productType: ShopifyProductType;
  fields: RecognizedField[];
  omittedFields: { key: string; label: string; reason: string }[];
  warnings: string[];
  raw: { imageIndex: number; result: VisionAnalysisResult }[];
}
