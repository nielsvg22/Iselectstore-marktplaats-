// Shared vocabulary for product templates. Every field here maps 1:1 to a
// Shopify metafield under the `mkt` namespace (see lib/shopify/metafields.ts).
// This is intentionally flat — Shopify stays the single source of truth,
// this module only describes *which* fields exist per product type and how
// they're used downstream (Shopify title, Shopify "kenmerken", Marktplaats
// title/description/attributes).

export type ShopifyProductType =
  | "iPhone"
  | "iPad"
  | "MacBook"
  | "iMac"
  | "Mac mini"
  | "Apple Watch";

export type FieldKind = "text" | "number" | "select" | "boolean" | "textarea";

export interface FieldDef {
  /** Internal field key — also the Shopify metafield key under namespace `mkt`. */
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  /** Free-text help shown in the admin form. */
  help?: string;
  /** Used when the Shopify metafield is empty — e.g. constant manufacturer info. */
  default?: string;
}

export interface ProductTemplate {
  productType: ShopifyProductType;
  /** All fields the "new product" form shows for this type. */
  fields: FieldDef[];

  /**
   * Fields used to build the clean Shopify title, in order.
   * NEVER includes battery/warranty — see FASE 13 / rule #9.
   */
  shopifyTitleFields: string[];

  /** Fields shown as separate Shopify "kenmerken" (metafields), not folded into the title. */
  shopifyFeatureFields: string[];

  /**
   * Fields appended to the Shopify title *only* for the Marktplaats title,
   * always battery + warranty per the spec — kept as a template field so a
   * future product type could opt out without touching the generator.
   */
  marktplaatsTitleExtraFields: string[];

  /** Fields used to compose the Marktplaats description body, in display order. */
  marktplaatsDescriptionFields: string[];

  /**
   * Internal fields we *intend* to map to Marktplaats category attributes.
   * The actual attribute key/allowed values are resolved at runtime against
   * the live (or mocked) category attribute list — never hardcoded here.
   */
  marktplaatsAttributes: string[];
}

export const FIELD_LIBRARY: Record<string, FieldDef> = {
  model: { key: "model", label: "Model", kind: "text", required: true },
  storage_gb: { key: "storage_gb", label: "Opslag (GB)", kind: "number", required: true },
  color: { key: "color", label: "Kleur", kind: "text", required: true },
  battery_percentage: { key: "battery_percentage", label: "Batterijconditie (%)", kind: "number", required: false },
  condition: {
    key: "condition",
    label: "Conditie",
    kind: "select",
    required: true,
    options: ["Als nieuw", "Zeer nette staat", "Nette staat", "Zichtbare gebruikssporen"],
  },
  warranty_months: { key: "warranty_months", label: "Garantie (maanden)", kind: "number", required: false },
  accessories: { key: "accessories", label: "Accessoires", kind: "textarea", required: false },
  box_included: { key: "box_included", label: "Doos aanwezig", kind: "boolean", required: false },
  cosmetic_notes: { key: "cosmetic_notes", label: "Uiterlijke staat (opmerking)", kind: "textarea", required: false },
  sell_price: { key: "sell_price", label: "Verkoopprijs", kind: "number", required: true },
  new_price: { key: "new_price", label: "Nieuwprijs (indien bekend)", kind: "number", required: false },

  // iPhone / iPad
  generation: { key: "generation", label: "Generatie / variant", kind: "text", required: false },
  sim_type: { key: "sim_type", label: "SIM", kind: "select", required: false, options: ["Fysieke SIM", "eSIM", "Fysieke SIM + eSIM"] },
  wifi_cellular: { key: "wifi_cellular", label: "Wi-Fi / Cellular", kind: "select", required: false, options: ["Wi-Fi", "Wi-Fi + Cellular"] },
  apple_pencil_support: { key: "apple_pencil_support", label: "Apple Pencil ondersteuning", kind: "boolean", required: false },

  // Verplichte Marktplaats-kenmerken voor telefoons/tablets/wearables met SIM
  subscription: {
    key: "subscription",
    label: "Abonnement",
    kind: "select",
    required: false,
    options: ["Zonder abonnement", "Met abonnement"],
    default: "Zonder abonnement",
  },
  simlock: {
    key: "simlock",
    label: "Simlock",
    kind: "select",
    required: false,
    options: ["Zonder simlock", "Met simlock"],
    default: "Zonder simlock",
  },

  // EU GPSR-verplichte fabrikantnaam (constant voor alle Apple-producten)
  manufacturer_name: { key: "manufacturer_name", label: "Handelsnaam fabrikant", kind: "text", required: false, default: "Apple" },

  // MacBook / iMac / Mac mini
  screen_size: { key: "screen_size", label: "Schermformaat", kind: "text", required: false },
  model_year: { key: "model_year", label: "Modeljaar", kind: "number", required: false },
  chip: { key: "chip", label: "Chip", kind: "text", required: true },
  cpu_variant: { key: "cpu_variant", label: "CPU-variant", kind: "text", required: false },
  gpu_variant: { key: "gpu_variant", label: "GPU-variant", kind: "text", required: false },
  ram_gb: { key: "ram_gb", label: "RAM (GB)", kind: "number", required: true },
  keyboard_layout: { key: "keyboard_layout", label: "Toetsenbordindeling", kind: "text", required: false },
  cycle_count: { key: "cycle_count", label: "Laadcycli", kind: "number", required: false },
  keyboard_included: { key: "keyboard_included", label: "Toetsenbord aanwezig", kind: "boolean", required: false },
  mouse_included: { key: "mouse_included", label: "Muis aanwezig", kind: "boolean", required: false },

  // Apple Watch
  watch_series: { key: "watch_series", label: "Serie", kind: "text", required: true },
  watch_case_size: { key: "watch_case_size", label: "Kastmaat", kind: "text", required: true },
  watch_material: { key: "watch_material", label: "Materiaal", kind: "text", required: false },
  watch_band: { key: "watch_band", label: "Bandje", kind: "text", required: false },
  watch_connectivity: { key: "watch_connectivity", label: "Connectiviteit", kind: "select", required: true, options: ["GPS", "GPS + Cellular"] },
};

function fields(...keys: string[]): FieldDef[] {
  return keys.map((k) => {
    const f = FIELD_LIBRARY[k];
    if (!f) throw new Error(`Unknown field key in template: ${k}`);
    return f;
  });
}
