import type { ProductPreview } from "../marktplaats/orchestrator";

/** TikTok's post_info.title for a photo post is capped at 90 characters; post_info.description at 4000. */
const TITLE_MAX_LENGTH = 90;

export interface TiktokCaption {
  title: string;
  description: string;
}

/**
 * Emoji-bullet fact list, identical content to lib/instagram/captionBuilder.ts
 * (same FACT_LABELS/FACT_ORDER) — kept as its own copy here rather than a
 * shared import so the two platforms' caption formats can diverge later
 * without one edit silently changing the other.
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

/** Short headline for post_info.title (90-char cap) — the full fact list lives in the description instead. */
function buildTitle(preview: ProductPreview): string {
  const price = `€${preview.price.toFixed(2).replace(".", ",")}`;
  const base = `${preview.shopifyTitle} - ${price}`;
  return base.length <= TITLE_MAX_LENGTH ? base : base.slice(0, TITLE_MAX_LENGTH - 1) + "…";
}

/**
 * Builds a TikTok description matching the same BestBuyPhone-style format
 * as lib/instagram/captionBuilder.ts's buildInstagramCaption — fact list,
 * "Inbegrepen" block, fixed "Verkoopopties" block, price, call to action,
 * hashtags — now that post_info.description (4000 chars) is confirmed to
 * exist separately from the 90-char title, there's no need for the
 * cramped one-liner this used to be.
 */
function buildDescription(preview: ProductPreview): string {
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
  lines.push("📩 Stuur ons een bericht om 'm te reserveren, of bestel direct via de link in bio!");

  lines.push("");
  lines.push("#iselectstore #refurbished #tweedehands #apple #nieuwinassortiment");

  return lines.join("\n").slice(0, 4000);
}

export function buildTiktokCaption(preview: ProductPreview): TiktokCaption {
  return { title: buildTitle(preview), description: buildDescription(preview) };
}
