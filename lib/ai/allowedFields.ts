import { ShopifyProductType } from "../templates/types";

// Only fields that are plausibly legible on a screenshot/photo. Deliberately
// excludes subjective/manual fields (condition, price, accessories, cosmetic
// notes, warranty) — those always require a human judgment call, never AI.
export const ALLOWED_AI_FIELDS: Record<ShopifyProductType, string[]> = {
  iPhone: ["model", "storage_gb", "color", "battery_percentage", "sim_type"],
  iPad: ["model", "storage_gb", "color", "battery_percentage"],
  MacBook: ["model", "screen_size", "model_year", "chip", "ram_gb", "storage_gb", "color", "battery_percentage", "cycle_count"],
  iMac: ["model", "screen_size", "model_year", "chip", "ram_gb", "storage_gb", "color"],
  "Mac mini": ["model", "model_year", "chip", "ram_gb", "storage_gb"],
  "Apple Watch": ["watch_series", "watch_case_size", "color", "battery_percentage"],
};

// Shopify metafield type for each AI-fillable field, matching the
// definitions already created for the `$app:mkt` namespace (see
// MARKTPLAATS_INTEGRATION.md). Only fields AI can ever produce need an entry.
export const AI_FIELD_METAFIELD_TYPE: Record<string, string> = {
  model: "single_line_text_field",
  storage_gb: "number_integer",
  color: "single_line_text_field",
  battery_percentage: "number_integer",
  sim_type: "single_line_text_field",
  screen_size: "single_line_text_field",
  model_year: "number_integer",
  chip: "single_line_text_field",
  ram_gb: "number_integer",
  cycle_count: "number_integer",
  watch_series: "single_line_text_field",
  watch_case_size: "single_line_text_field",
};

export function isAiFillableField(productType: ShopifyProductType, key: string): boolean {
  return (ALLOWED_AI_FIELDS[productType] ?? []).includes(key);
}
