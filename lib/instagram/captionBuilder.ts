import type { ProductPreview } from "../marktplaats/orchestrator";

/**
 * Emoji-bullet fact list, styled after the client's other store's
 * (BestBuyPhone) Instagram format — one icon + label per filled-in field.
 * See lib/templates/registry.ts's shopifyFeatureFields per product type
 * (iPhone/iPad/MacBook/Mac/Watch each expose a different subset of this
 * same key set). Model/storage/color stay out of this list: they're
 * already part of shopifyTitle, so repeating them would be redundant.
 * warranty_months/accessories/box_included are handled separately below
 * (their own "Inbegrepen" block, matching the reference format) rather
 * than listed here.
 */
const FACT_LABELS: Record<string, (value: string) => string> = {
  condition: (v) => `✨ Staat: ${v}`,
  cosmetic_notes: (v) => `👀 Cosmetisch: ${v}`,
  battery_percentage: (v) => `🔋 Batterijcapaciteit: ${v}%`,
  sim_type: (v) => `📶 Simkaart: ${v}`,
  wifi_cellular: (v) => `🌐 Connectiviteit: ${v}`,
  screen_size: (v) => `📐 Schermgrootte: ${v}"`,
  apple_pencil_support: (v) => (v.toLowerCase() === "true" || v.toLowerCase() === "ja" ? "✏️ Apple Pencil-ondersteuning" : ""),
  ram_gb: (v) => `💾 RAM: ${v}GB`,
  chip: (v) => `⚙️ Chip: ${v}`,
  cycle_count: (v) => `🔁 Laadcycli: ${v}`,
  keyboard_layout: (v) => `⌨️ Toetsenbord: ${v}`,
  watch_band: (v) => `⌚ Bandje: ${v}`,
};

const FACT_ORDER = [
  "condition",
  "cosmetic_notes",
  "battery_percentage",
  "sim_type",
  "wifi_cellular",
  "screen_size",
  "apple_pencil_support",
  "ram_gb",
  "chip",
  "cycle_count",
  "keyboard_layout",
  "watch_band",
];

/**
 * Builds an Instagram caption matching the client's established
 * BestBuyPhone-style format 1-op-1: "NIEUW! - <titel>", an emoji-bullet
 * fact list, an "Inbegrepen" block (warranty + accessories/box as actually
 * entered at upload), a fixed "Verkoopopties" block (iSelectStore's
 * standing pickup/shipping policy — same for every product, not
 * per-product data), the price, a call to action, and hashtags. The one
 * thing deliberately left out is the reference post's new-vs-refurbished
 * price comparison — this shop doesn't record an original "nieuwprijs" per
 * product, so that section would have to be invented.
 */
export function buildInstagramCaption(preview: ProductPreview): string {
  const lines: string[] = [];

  lines.push(`🔔 NIEUW! - ${preview.shopifyTitle}`);
  lines.push("");

  const facts = FACT_ORDER.map((key) => {
    const value = preview.data[key];
    if (!value || value.trim().length === 0) return null;
    const text = FACT_LABELS[key](value.trim());
    return text.length > 0 ? text : null;
  }).filter((f): f is string => f !== null);
  for (const fact of facts) lines.push(fact);

  const included: string[] = [];
  if (preview.data.warranty_months) included.push(`${preview.data.warranty_months} maanden garantie`);
  const boxIncluded = (preview.data.box_included || "").toLowerCase();
  if (boxIncluded === "true" || boxIncluded === "ja") included.push("Originele doos");
  if (preview.data.accessories) included.push(preview.data.accessories);
  if (included.length > 0) {
    lines.push("");
    lines.push("Inbegrepen:");
    for (const item of included) lines.push(item);
  }

  lines.push("");
  lines.push("Verkoopopties:");
  lines.push("🚗 Afhalen in Apeldoorn");
  lines.push("📦 Verzenden");

  lines.push("");
  lines.push(`💶 Onze prijs: €${preview.price.toFixed(2).replace(".", ",")} ✅`);

  lines.push("");
  lines.push("📩 Stuur ons een bericht via Instagram om 'm te reserveren, of bestel direct via de link in bio!");

  lines.push("");
  lines.push("#iselectstore #refurbished #tweedehands #apple #nieuwinassortiment");

  return lines.join("\n");
}
