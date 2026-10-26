import type { ProductPreview } from "../marktplaats/orchestrator";

/**
 * Human-readable Dutch labels for the structured fields entered when a
 * product is uploaded (see lib/templates/registry.ts's shopifyFeatureFields
 * per product type — iPhone/iPad/MacBook/Mac/Watch each expose a different
 * subset of this same key set). Model/storage/color are deliberately left
 * out here: they're already part of shopifyTitle, so repeating them would
 * be redundant in the caption.
 */
const FACT_LABELS: Record<string, (value: string) => string> = {
  condition: (v) => `Conditie: ${v}`,
  battery_percentage: (v) => `Batterij: ${v}%`,
  warranty_months: (v) => `${v} maanden garantie`,
  sim_type: (v) => `${v}`,
  wifi_cellular: (v) => `${v}`,
  screen_size: (v) => `${v}" scherm`,
  apple_pencil_support: (v) => (v.toLowerCase() === "true" || v.toLowerCase() === "ja" ? "Apple Pencil-ondersteuning" : ""),
  ram_gb: (v) => `${v}GB RAM`,
  chip: (v) => `${v}-chip`,
  cycle_count: (v) => `${v} laadcycli`,
  keyboard_layout: (v) => `${v}-toetsenbord`,
  keyboard_included: (v) => (v.toLowerCase() === "true" || v.toLowerCase() === "ja" ? "Incl. toetsenbord" : ""),
  mouse_included: (v) => (v.toLowerCase() === "true" || v.toLowerCase() === "ja" ? "Incl. muis" : ""),
};

// Order matters: condition/battery/warranty first (what a buyer cares about
// most), the rest after, in roughly the order registry.ts lists them.
const FACT_ORDER = [
  "condition",
  "battery_percentage",
  "warranty_months",
  "sim_type",
  "wifi_cellular",
  "screen_size",
  "apple_pencil_support",
  "ram_gb",
  "chip",
  "cycle_count",
  "keyboard_layout",
  "keyboard_included",
  "mouse_included",
];

/**
 * Builds a short, Instagram-appropriate caption from a product preview —
 * deliberately NOT the same text as marktplaatsDescription (that's written
 * for Marktplaats' listing format/audience, far too long and formal for an
 * Instagram caption). Pulls in whichever structured fields (lib/templates/
 * registry.ts's shopifyFeatureFields) were actually filled in when the
 * product was uploaded — works across iPhone/iPad/MacBook/Mac/Watch alike,
 * since each only ever populates its own relevant subset of preview.data.
 */
export function buildInstagramCaption(preview: ProductPreview): string {
  const lines: string[] = [];

  lines.push(`${preview.shopifyTitle} ✨`);
  lines.push(`€${preview.price.toFixed(2).replace(".", ",")}`);

  const facts = FACT_ORDER.map((key) => {
    const value = preview.data[key];
    if (!value || value.trim().length === 0) return null;
    const text = FACT_LABELS[key](value.trim());
    return text.length > 0 ? text : null;
  }).filter((f): f is string => f !== null);

  if (facts.length > 0) lines.push(facts.join(" · "));

  lines.push("");
  lines.push("Nu te koop bij iSelectStore — link in bio.");
  lines.push("");
  lines.push("#iselectstore #refurbished #tweedehands #apple");

  return lines.join("\n");
}
