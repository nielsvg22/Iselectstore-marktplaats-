// Per-productType → GoedGeplaatst-attribuutsleutel mapping, ONAFHANKELIJK van
// de gedeelde `marktplaats_attribute_mapping`-DB-tabel (die is gevuld via de
// Playwright-discovery op het consumenten-plaatsingsformulier van
// marktplaats.nl en gebruikt soms andere sleutelnamen/waardeformaten dan
// GoedGeplaatst's eigen, apart opgehaalde attributencatalogus — zie
// lib/goedgeplaatst/mapper.ts's module-comment voor waarom we die tabel hier
// niet (meer) gebruiken).
//
// Alle sleutelnamen en waarde-enums hieronder zijn live geverifieerd tegen
// POST /attributes/ voor de bijbehorende categoryId (zie
// lib/goedgeplaatst/categoryMap.ts) — nooit verzonnen. Een producttype-veld
// zonder GoedGeplaatst-equivalent voor die categorie staat hier bewust niet
// in (bv. iPad/MacBook hebben geen simlock/abonnement/batterij-attribuut bij
// GoedGeplaatst, ook al heeft ons eigen template die velden wel).

import { CONDITION_ATTRIBUTE_MAP } from "../marktplaats/feedBuilder";

export interface AttributeFieldMapping {
  /** lib/templates/types.ts FIELD_LIBRARY-sleutel, d.w.z. preview.data[shopifyField]. */
  shopifyField: string;
  /** Zet de ruwe Shopify-waarde om naar een geldige GoedGeplaatst-waarde, of null als er geen betrouwbare match is (nooit verzinnen — dan gewoon weglaten). */
  transform?: (raw: string) => string | null;
}

/** "256" -> "256 GB", "1024" -> "1 TB" — zelfde eenheid-conventie als iPhone's "storage". */
function formatGbUnit(raw: string): string | null {
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return null;
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

/**
 * iPad's "capacity"-enum is inconsistent geformatteerd (live bevestigd):
 * ["16 GB","32 GB","64 GB","128","256","512","1tb"] — sommige met "GB"-
 * suffix, sommige zonder, "1tb" lowercase zonder spatie. Kiest de exacte
 * match uit die echte lijst i.p.v. een eigen, mogelijk niet-passend format.
 */
const IPAD_CAPACITY_VALUES: Record<number, string> = {
  16: "16 GB",
  32: "32 GB",
  64: "64 GB",
  128: "128",
  256: "256",
  512: "512",
  1024: "1tb",
};
function formatIpadCapacity(raw: string): string | null {
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return null;
  return IPAD_CAPACITY_VALUES[gb] ?? null;
}

/**
 * Buckets voor MacBook/iMac/Mac mini se RAM- en opslag-attributen —
 * GoedGeplaatst geeft hier géén los getal door maar een vaste reeks
 * (live bevestigd). Dit is een afgeleide categorisering van een echt
 * Shopify-getal, geen verzonnen waarde — grenzen hieronder exact zoals
 * live opgehaald.
 */
function bucketRam(raw: string): string | null {
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return null;
  if (gb < 2) return "Minder dan 2 GB";
  if (gb <= 6) return "4 tot 6 GB";
  if (gb <= 16) return "8 tot 16 GB";
  if (gb <= 32) return "16 tot 32 GB";
  if (gb <= 64) return "32 tot 64 GB";
  return "64 GB of meer";
}
function bucketHarddisk(raw: string): string | null {
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return null;
  if (gb < 200) return "Minder dan 200 GB";
  if (gb < 500) return "200 tot 500 GB";
  if (gb < 1000) return "500 tot 1000 GB";
  return "1000 GB of meer";
}

/**
 * Model-/productlijn-enums (iPad/MacBook/iMac-MacMini) zijn vaste, korte
 * lijsten, maar ons eigen "model"-veld is vrije tekst (FIELD_LIBRARY.model,
 * kind: "text", geen options) — dus een letterlijke match is niet
 * gegarandeerd. Conservatieve aanpak: alleen matchen als de ruwe
 * Shopify-tekst een van de echte enum-waarden daadwerkelijk als substring
 * bevat (hoofdletterongevoelig) — geen gok, geen fuzzy-afstand-matching.
 * Geen match => null (ongemapt), nooit een verzonnen modelnaam.
 */
function matchEnumSubstring(raw: string, options: string[]): string | null {
  const low = raw.toLowerCase();
  // Langste optie eerst zodat bv. "iPad Pro 1" voor "iPad" gekozen wordt
  // wanneer de tekst allebei bevat.
  const sorted = [...options].sort((a, b) => b.length - a.length);
  for (const opt of sorted) {
    if (opt === "Overige modellen" || opt === "Overige typen") continue;
    if (low.includes(opt.toLowerCase())) return opt;
  }
  return null;
}

function conditionTransform(raw: string): string | null {
  return CONDITION_ATTRIBUTE_MAP[raw] ?? null;
}

export const GOEDGEPLAATST_ATTRIBUTE_MAP: Record<string, Record<string, AttributeFieldMapping>> = {
  iPhone: {
    // Al werkend via de generieke attributeResults-DB-route (categoryId
    // 225 heeft live-geverifieerde discovered keys) — hier niet dupliceren,
    // buildAdPayloadFromShopifyPreview() gebruikt voor iPhone nog steeds
    // preview.attributeResults als primaire bron (zie mapper.ts).
  },
  iPad: {
    condition: { shopifyField: "condition", transform: conditionTransform },
    model: { shopifyField: "model", transform: (raw) => matchEnumSubstring(raw, ["iPad", "iPad Air", "iPad Mini", "iPad Pro 1"]) },
    internet: {
      shopifyField: "wifi_cellular",
      transform: (raw) => (raw === "Wi-Fi" ? "Wi-Fi" : raw === "Wi-Fi + Cellular" ? "Wi-Fi en 3G" : null),
    },
    capacity: { shopifyField: "storage_gb", transform: formatIpadCapacity },
    color: { shopifyField: "color" },
    // screenSize was eerder ongemapt (vrije tekst gaf geen garantie op een
    // exacte enum-match) — nu dat screen_size in het formulier zelf een
    // dropdown is (lib/templates/registry.ts, IPAD_SCREEN_SIZE_OPTIONS,
    // dezelfde live-opgehaalde "7 inch".."13 inch"-lijst), is de ruwe
    // waarde altijd al exact geldig.
    screenSize: { shopifyField: "screen_size" },
  },
  MacBook: {
    condition: { shopifyField: "condition", transform: conditionTransform },
    model: { shopifyField: "model", transform: (raw) => matchEnumSubstring(raw, ["MacBook Pro", "MacBook Air", "MacBook"]) },
    harddisk: { shopifyField: "storage_gb", transform: bucketHarddisk },
    memoryRAM: { shopifyField: "ram_gb", transform: bucketRam },
    keyboardtype: { shopifyField: "keyboard_layout", transform: (raw) => matchEnumSubstring(raw, ["Qwerty", "Azerty"]) },
    // screenSize was eerder ongemapt — nu een dropdown in het formulier
    // (MACBOOK_SCREEN_SIZE_OPTIONS, live-opgehaalde "11 inch".."17 inch" +
    // "Overige groottes"), dus de ruwe waarde is altijd al exact geldig.
    screenSize: { shopifyField: "screen_size" },
    // GEEN "color"-attribuut voor deze categorie bij GoedGeplaatst (live
    // bevestigd — eerder per ongeluk toegevoegd, een live testcall wees dit
    // uit: "unknown key/value pair for field: ... color"). Niet toevoegen.
    // processorSpeed: geen betrouwbare Shopify-bron (chip-naam is geen
    // GHz-getal) — ongemapt.
  },
  iMac: {
    condition: { shopifyField: "condition", transform: conditionTransform },
    model: { shopifyField: "model", transform: (raw) => matchEnumSubstring(raw, ["iMac Pro", "iMac"]) },
    memoryRAM: { shopifyField: "ram_gb", transform: bucketRam },
    totalmemory: { shopifyField: "storage_gb", transform: formatGbUnit },
    // type (HDD/SSD) en processorSpeed: geen Shopify-bron, ongemapt.
  },
  "Mac mini": {
    condition: { shopifyField: "condition", transform: conditionTransform },
    model: { shopifyField: "model", transform: (raw) => matchEnumSubstring(raw, ["Mac Mini", "Mac Pro"]) },
    memoryRAM: { shopifyField: "ram_gb", transform: bucketRam },
    totalmemory: { shopifyField: "storage_gb", transform: formatGbUnit },
  },
  "Apple Watch": {
    condition: { shopifyField: "condition", transform: conditionTransform },
    color: { shopifyField: "color" },
    brand: { shopifyField: "manufacturer_name" },
    // operatingSystem (Android/iOS/Windows): geen enkele waarde is correct
    // voor watchOS — bewust NOOIT gemapt, zou verzinnen zijn.
    // measures/caracteristics: LIST-type multi-select, geen Shopify-bron.
    // simlock/subscription/battery/kastmaat/bandje: geen GoedGeplaatst-
    // attribuut voor deze categorie — ongemapt, niet onze keuze.
  },
};
