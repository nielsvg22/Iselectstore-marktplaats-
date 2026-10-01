import { ProductTemplate } from "../templates/types";
import { FIELD_LIBRARY } from "../templates/types";

// Marktplaats' eigen titelveld telt af met "N/60" (hz-TextField-characterCountAmount)
// — 60 tekens, geverifieerd op het echte plaatsingsformulier. Onze eigen validator
// moet dezelfde grens hanteren, anders wordt een te lange titel pas daar afgekeurd.
const MARKTPLAATS_TITLE_MAX_LENGTH = 60;

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
 * Marktplaats title = core (Shopify title, of een slimmere kern via
 * `template.markplaatatsTitleFields`) + korte extras (batt / conditie /
 * garantie), compact genoeg om binnen de 60 tekens te blijven.
 */
// Kleurnamen inkorten voor de advertentietitel ("Space Grey" -> "grijs") —
// de volledige waarde blijft staan in het `mkt.color`-attribuut.
const COLOR_SHORT: Record<string, string> = {
  "space grey": "grijs",
  "space gray": "grijs",
  "space black": "zwart",
  gray: "grijs",
  grijs: "grijs",
  silver: "zilver",
  zilver: "zilver",
  black: "zwart",
  zwart: "zwart",
  white: "wit",
  wit: "wit",
  gold: "goud",
  goud: "goud",
  starlight: "sterrenlicht",
  midnight: "middernacht",
  blue: "blauw",
  blauw: "blauw",
  purple: "paars",
  paars: "paars",
  red: "rood",
  rood: "rood",
  green: "groen",
  groen: "groen",
  pink: "roze",
  roze: "roze",
};

// Conditie-akkorderingen voor de titel ("Zeer nette staat" -> "zeer net").
const CONDITION_SHORT: Record<string, string> = {
  "als nieuw": "als nieuw",
  "zeer nette staat": "zeer net",
  "nette staat": "net",
};

function shortTitleValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (key === "color") return COLOR_SHORT[trimmed.toLowerCase()] ?? humanizeValue(key, trimmed);
  if (key === "condition") return CONDITION_SHORT[trimmed.toLowerCase()] ?? trimmed;
  return humanizeValue(key, trimmed);
}

export function generateMarktplaatsTitle(
  template: ProductTemplate,
  data: Record<string, string>,
  shopifyTitle: string,
  customTitle?: string
): string {
  if (customTitle && customTitle.trim().length > 0) {
    return customTitle.trim();
  }

  const core = template.marktplaatsTitleFields
    ? template.marktplaatsTitleFields
        .map((key) => {
          const value = data[key];
          return value && value.trim().length > 0 ? shortTitleValue(key, value) : null;
        })
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : shopifyTitle;

  const extras: string[] = [];
  for (const key of template.marktplaatsTitleExtraFields) {
    const value = data[key];
    if (!value || value.trim().length === 0) continue;
    if (key === "battery_percentage") {
      extras.push(`${value}% batt`);
    } else if (key === "warranty_months") {
      extras.push(`${value} mnd garantie`);
    } else {
      extras.push(`${shortTitleValue(key, value)}`);
    }
  }

  const rebuild = (ex: string[]): string => (ex.length > 0 ? `${core} / ${ex.join(" / ")}` : core);
  let title = rebuild(extras);

  if (title.length <= MARKTPLAATS_TITLE_MAX_LENGTH) {
    return title;
  }

  // Intelligent shortening: garantie eerst beknopter ("12 mnd garantie" ->
  // "garantie"), daarna extras één voor één vanaf het einde laten vallen
  // (conditie vóór batt), zodat de kern (model/chip/opslag/kleur) intact blijft.
  const remaining = [...extras];
  let garantieBeknopt = false;
  while (remaining.length > 0 && title.length > MARKTPLAATS_TITLE_MAX_LENGTH) {
    const last = remaining[remaining.length - 1];
    if (!garantieBeknopt && /^\d+ mnd garantie$/.test(last)) {
      garantieBeknopt = true;
      remaining[remaining.length - 1] = "garantie";
    } else {
      remaining.pop();
    }
    title = rebuild(remaining);
  }

  if (title.length > MARKTPLAATS_TITLE_MAX_LENGTH) {
    title = title.slice(0, MARKTPLAATS_TITLE_MAX_LENGTH - 1).trim() + "…";
  }

  return title;
}
