// Turns the SAME ProductPreview used by the mapping-test and the (future)
// official API publisher into a generic, label-driven fill plan for the
// Playwright browser-test publisher. This is the one place that decides
// "which Dutch label(s) to look for on the real page" — it does NOT
// re-derive Shopify -> Marktplaats values; those come straight from
// buildProductPreview() (lib/marktplaats/orchestrator.ts), so there is only
// ever one mapping in this codebase.

import { ProductPreview } from "../orchestrator";
import { BrowserFieldPlanItem, BrowserTestPlan } from "./types";

/**
 * A few fields' real Marktplaats page label can differ from our internal
 * FIELD_LIBRARY label (e.g. we say "Opslag (GB)" internally, the page might
 * say "Opslagcapaciteit"). List the most likely real-page label(s) first;
 * the first match wins. Unlisted fields fall back to the internal label.
 * Adjust this once the real page has been inspected (see fillForm()'s debug
 * screenshot + "visible labels" dump for that).
 */
const LABEL_OVERRIDES: Record<string, string[]> = {
  model: ["Model"],
  storage_gb: ["Opslagcapaciteit", "Opslag"],
  color: ["Kleur"],
  condition: ["Conditie", "Staat"],
  battery_percentage: ["Batterijconditie", "Batterij"],
  warranty_months: ["Garantie"],
  manufacturer_name: ["Merk", "Handelsnaam fabrikant"],
  chip: ["Chip", "Processor"],
  ram_gb: ["RAM", "Geheugen"],
  screen_size: ["Schermformaat", "Beeldschermgrootte"],
};

/** Select-field values whose real-page option text may differ from ours. */
const VALUE_SYNONYMS: Record<string, string[]> = {
  "Als nieuw": ["Zo goed als nieuw", "Nieuw"],
  "Zeer nette staat": ["Zeer goed"],
  "Nette staat": ["Goed"],
  "Zichtbare gebruikssporen": ["Gebruikt", "Redelijk"],
};

function labelsFor(key: string, fallback: string): string[] {
  const overrides = LABEL_OVERRIDES[key];
  if (!overrides) return [fallback];
  // De-dupe while keeping override labels first.
  return Array.from(new Set([...overrides, fallback]));
}

export function buildBrowserTestPlan(preview: ProductPreview): BrowserTestPlan {
  const fields: BrowserFieldPlanItem[] = [];

  fields.push({ key: "title", labels: ["Titel", "Titel van je advertentie"], kind: "text", value: preview.marktplaatsTitle, required: true });
  fields.push({
    key: "price",
    labels: ["Vraagprijs", "Prijs"],
    kind: "number",
    value: preview.price > 0 ? String(preview.price) : "",
    required: true,
  });
  if (preview.categoryMapping) {
    fields.push({
      key: "category",
      labels: ["Categorie"],
      kind: "select",
      value: preview.categoryMapping.l2CategoryName,
      valueSynonyms: [preview.categoryMapping.l1CategoryName],
      required: true,
    });
  }

  for (const fieldDef of preview.template.fields) {
    const value = preview.data[fieldDef.key];
    if (value === undefined || value === null || value.toString().trim().length === 0) continue;

    fields.push({
      key: fieldDef.key,
      labels: labelsFor(fieldDef.key, fieldDef.label),
      kind: fieldDef.kind === "boolean" ? "select" : (fieldDef.kind as BrowserFieldPlanItem["kind"]),
      value: value.toString(),
      valueSynonyms: VALUE_SYNONYMS[value],
      required: fieldDef.required,
    });
  }

  fields.push({
    key: "description",
    labels: ["Beschrijving", "Omschrijving"],
    kind: "textarea",
    value: preview.marktplaatsDescription,
    required: true,
  });

  return {
    shopifyProductId: preview.shopifyProductId,
    productType: preview.productType,
    fields,
    imageUrls: preview.imageUrls,
    categoryLabel: preview.categoryMapping ? `${preview.categoryMapping.l1CategoryName} > ${preview.categoryMapping.l2CategoryName}` : null,
  };
}
