import type { ProductPreview } from "../marktplaats/orchestrator";

/**
 * Builds a short, Instagram-appropriate caption from a product preview —
 * deliberately NOT the same text as marktplaatsDescription (that's written
 * for Marktplaats' listing format/audience, far too long and formal for an
 * Instagram caption).
 */
export function buildInstagramCaption(preview: ProductPreview): string {
  const lines: string[] = [];

  lines.push(`${preview.shopifyTitle} ✨`);
  lines.push(`€${preview.price.toFixed(2).replace(".", ",")}`);

  const facts: string[] = [];
  if (preview.data.condition) facts.push(`Conditie: ${preview.data.condition}`);
  if (preview.data.battery_percentage) facts.push(`Batterij: ${preview.data.battery_percentage}%`);
  if (preview.data.warranty_months) facts.push(`${preview.data.warranty_months} maanden garantie`);
  if (facts.length > 0) lines.push(facts.join(" · "));

  lines.push("");
  lines.push("Nu te koop bij iSelectStore — link in bio.");
  lines.push("");
  lines.push("#iselectstore #refurbished #tweedehands #apple");

  return lines.join("\n");
}
