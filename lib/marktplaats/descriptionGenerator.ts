import { ProductTemplate } from "../templates/types";
import { FIELD_LIBRARY } from "../templates/types";

function formatLine(key: string, value: string): string | null {
  const field = FIELD_LIBRARY[key];
  const label = field?.label ?? key;
  if (field?.kind === "boolean") {
    return value === "true" ? `${label}: ja` : null; // skip when false/empty
  }
  if (key === "battery_percentage") return `Batterijconditie: ${value}%`;
  if (key === "warranty_months") return `Garantie: ${value} maanden`;
  if (key === "cycle_count") return `Cycli: ${value}`;
  return `${label}: ${value}`;
}

/**
 * Marktplaats description generator. Never a blind copy of the Shopify
 * description — built from structured fields, skipping anything empty.
 */
export function generateMarktplaatsDescription(
  template: ProductTemplate,
  data: Record<string, string>,
  shopifyTitle: string,
  shopifyBodyHtml: string | null,
  customDescription?: string
): string {
  if (customDescription && customDescription.trim().length > 0) {
    return customDescription.trim();
  }

  const specLines: string[] = [];
  for (const key of template.marktplaatsDescriptionFields) {
    if (key === "cosmetic_notes" || key === "accessories") continue; // handled separately below
    const value = data[key];
    if (!value || value.trim().length === 0) continue;
    const line = formatLine(key, value);
    if (line) specLines.push(`- ${line}`);
  }

  const sections: string[] = [shopifyTitle, ""];

  if (specLines.length > 0) {
    sections.push("Specificaties:", ...specLines, "");
  }

  const cosmetic = data.cosmetic_notes;
  if (cosmetic && cosmetic.trim().length > 0) {
    sections.push("Uiterlijke staat:", cosmetic.trim(), "");
  }

  const accessories = data.accessories;
  if (accessories && accessories.trim().length > 0) {
    sections.push("Inclusief:", accessories.trim(), "");
  }

  if (shopifyBodyHtml && shopifyBodyHtml.trim().length > 0) {
    const plain = shopifyBodyHtml.replace(/<[^>]+>/g, "").trim();
    if (plain.length > 0) sections.push(plain, "");
  }

  sections.push("Alle foto's zijn van het daadwerkelijke apparaat.");

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
