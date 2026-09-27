export type StickerPosition = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type SoldImageMode = "none" | "auto";
export type SoldImageStatus = "none" | "pending" | "applied" | "restoring" | "restored" | "error";

export interface SoldImageSettings {
  mode: SoldImageMode;
  /** 0 = direct (next cron run), otherwise wait this many hours after out-of-stock is detected. */
  delayHours: number;
  stickerText: string;
  position: StickerPosition;
  /** Sticker band width as a percentage of the image width. */
  sizePercent: number;
  /** 0-1 */
  opacity: number;
  bandColorHex: string;
  textColorHex: string;
}

export interface SoldImageState {
  shopifyProductId: string;
  originalImageId: string | null;
  originalImageSrc: string | null;
  soldImageId: string | null;
  soldImageSrc: string | null;
  status: SoldImageStatus;
  outOfStockDetectedAt: string | null;
  applyAfter: string | null;
  appliedAt: string | null;
  restoredAt: string | null;
  lastError: string | null;
}

/** Minimal shape this module needs from a Shopify product — decoupled from the REST client's own type. */
export interface StockCheckInput {
  variants: { inventory_quantity: number; inventory_management: string | null }[];
}
