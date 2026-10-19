export type WatermarkStatus = "applied" | "error";

export interface WatermarkedImageRow {
  shopifyImageId: string;
  shopifyProductId: string;
  originalImageId: string | null;
  originalImageSrc: string | null;
  status: WatermarkStatus;
  appliedAt: string | null;
  lastError: string | null;
}
