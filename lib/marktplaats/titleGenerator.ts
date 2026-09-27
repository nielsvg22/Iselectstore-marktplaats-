import { ProductTemplate } from "../templates/types";
import { FIELD_LIBRARY } from "../templates/types";

const MARKTPLAATS_TITLE_MAX_LENGTH = 80; // Verify against current Marktplaats API docs before going live.

function humanizeValue(key: string, value: string): string {
  if (key === "storage_gb" || key === "ram_gb") return `${value}GB`;
  if (key === "battery_percentage") return `${value}%`;
  return value;
}

/**
 * Clean Shopify title — built ONLY from shopifyTitleFields.
 * NEVER includes battery condition or warranty (rule #9 / acceptance #5-6).
 */
export function generateShopifyTitle(template: ProductTemplate, data: Record<string, string>): string {
  const parts = template.shopifyTitleFields
    .map((key) => {
      const value = data[key];
      if (!value || value.trim().length === 0) return null;
      return humanizeValue(key, value);
    })
    .filter((v): v is string => Boolean(v));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Marktplaats title = Shopify title + battery (if present) + warranty (if present),
 * truncated intelligently to the platform limit while keeping model/RAM/storage.
 */
export function generateMarktplaatsTitle(
  template: ProductTemplate,
  data: Record<string, string>,
  shopifyTitle: string,
  customTitle?: string
): string {
  if (customTitle && customTitle.trim().length > 0) {
    return customTitle.trim();
  }

  const extras: string[] = [];
  for (const key of template.marktplaatsTitleExtraFields) {
    const value = data[key];
    if (!value || value.trim().length === 0) continue;
    if (key === "battery_percentage") {
      extras.push(`${value}% batt`);
    } else if (key === "warranty_months") {
      extras.push(`${value} mnd garantie`);
    } else {
      extras.push(`${humanizeValue(key, value)}`);
    }
  }

  let title = shopifyTitle;
  if (extras.length > 0) {
    title = `${shopifyTitle} / ${extras.join(" / ")}`;
  }

  if (title.length <= MARKTPLAATS_TITLE_MAX_LENGTH) {
    return title;
  }

  // Intelligent shortening: drop extras one at a time from the end (garantie
  // before battery, since extras are ordered battery-then-warranty), keeping
  // the core Shopify title (model/RAM/storage) intact.
  const remaining = [...extras];
  while (remaining.length > 0 && title.length > MARKTPLAATS_TITLE_MAX_LENGTH) {
    remaining.pop();
    title = remaining.length > 0 ? `${shopifyTitle} / ${remaining.join(" / ")}` : shopifyTitle;
  }

  if (title.length > MARKTPLAATS_TITLE_MAX_LENGTH) {
    title = title.slice(0, MARKTPLAATS_TITLE_MAX_LENGTH - 1).trim() + "…";
  }

  return title;
}
