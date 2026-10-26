// Mirrors lib/templates/registry.ts in the Marktplaats app — kept in sync
// manually since this extension bundle can't import from that separate
// Next.js project. If you add/change a field there, update it here too.

// `mfType` must exactly match the metafield definition type already created
// on the store (namespace "mkt") — see MARKTPLAATS_INTEGRATION.md. Writing a
// mismatched type would conflict with the existing definition.
export const FIELD_LIBRARY = {
  model: { key: "model", label: "Model", kind: "text", required: true, mfType: "single_line_text_field" },
  storage_gb: { key: "storage_gb", label: "Opslag (GB)", kind: "number", required: true, mfType: "number_integer" },
  color: { key: "color", label: "Kleur", kind: "text", required: true, mfType: "single_line_text_field" },
  battery_percentage: { key: "battery_percentage", label: "Batterijconditie (%)", kind: "number", required: false, mfType: "number_integer" },
  condition: {
    key: "condition",
    label: "Conditie",
    kind: "select",
    required: true,
    options: ["Als nieuw", "Zeer nette staat", "Nette staat", "Zichtbare gebruikssporen"],
    mfType: "single_line_text_field",
  },
  warranty_months: { key: "warranty_months", label: "Garantie (maanden)", kind: "number", required: false, mfType: "number_integer" },
  accessories: { key: "accessories", label: "Accessoires", kind: "textarea", required: false, mfType: "multi_line_text_field" },
  box_included: { key: "box_included", label: "Doos aanwezig", kind: "boolean", required: false, mfType: "boolean" },
  cosmetic_notes: { key: "cosmetic_notes", label: "Uiterlijke staat (opmerking)", kind: "textarea", required: false, mfType: "multi_line_text_field" },
  sell_price: { key: "sell_price", label: "Verkoopprijs", kind: "number", required: true, mfType: "number_decimal" },
  new_price: { key: "new_price", label: "Nieuwprijs (indien bekend)", kind: "number", required: false, mfType: "number_decimal" },
  generation: { key: "generation", label: "Generatie / variant", kind: "text", required: false, mfType: "single_line_text_field" },
  sim_type: { key: "sim_type", label: "SIM", kind: "select", required: false, options: ["Fysieke SIM", "eSIM", "Fysieke SIM + eSIM"], mfType: "single_line_text_field" },
  wifi_cellular: { key: "wifi_cellular", label: "Wi-Fi / Cellular", kind: "select", required: false, options: ["Wi-Fi", "Wi-Fi + Cellular"], mfType: "single_line_text_field" },
  apple_pencil_support: { key: "apple_pencil_support", label: "Apple Pencil ondersteuning", kind: "boolean", required: false, mfType: "boolean" },
  subscription: { key: "subscription", label: "Abonnement", kind: "select", required: false, options: ["Zonder abonnement", "Met abonnement"], mfType: "single_line_text_field", default: "Zonder abonnement" },
  simlock: { key: "simlock", label: "Simlock", kind: "select", required: false, options: ["Zonder simlock", "Met simlock"], mfType: "single_line_text_field", default: "Zonder simlock" },
  manufacturer_name: { key: "manufacturer_name", label: "Handelsnaam fabrikant", kind: "text", required: false, mfType: "single_line_text_field", default: "Apple" },
  screen_size: { key: "screen_size", label: "Schermformaat", kind: "text", required: false, mfType: "single_line_text_field" },
  model_year: { key: "model_year", label: "Modeljaar", kind: "number", required: false, mfType: "number_integer" },
  chip: { key: "chip", label: "Chip", kind: "text", required: true, mfType: "single_line_text_field" },
  cpu_variant: { key: "cpu_variant", label: "CPU-variant", kind: "text", required: false, mfType: "single_line_text_field" },
  gpu_variant: { key: "gpu_variant", label: "GPU-variant", kind: "text", required: false, mfType: "single_line_text_field" },
  ram_gb: { key: "ram_gb", label: "RAM (GB)", kind: "number", required: true, mfType: "number_integer" },
  keyboard_layout: { key: "keyboard_layout", label: "Toetsenbordindeling", kind: "text", required: false, mfType: "single_line_text_field" },
  cycle_count: { key: "cycle_count", label: "Laadcycli", kind: "number", required: false, mfType: "number_integer" },
  keyboard_included: { key: "keyboard_included", label: "Toetsenbord aanwezig", kind: "boolean", required: false, mfType: "boolean" },
  mouse_included: { key: "mouse_included", label: "Muis aanwezig", kind: "boolean", required: false, mfType: "boolean" },
  watch_series: { key: "watch_series", label: "Serie", kind: "text", required: true, mfType: "single_line_text_field" },
  watch_case_size: { key: "watch_case_size", label: "Kastmaat", kind: "text", required: true, mfType: "single_line_text_field" },
  watch_material: { key: "watch_material", label: "Materiaal", kind: "text", required: false, mfType: "single_line_text_field" },
  watch_band: { key: "watch_band", label: "Bandje", kind: "text", required: false, mfType: "single_line_text_field" },
  watch_connectivity: { key: "watch_connectivity", label: "Connectiviteit", kind: "select", required: true, options: ["GPS", "GPS + Cellular"], mfType: "single_line_text_field" },
};

function fields(...keys) {
  return keys.map((k) => FIELD_LIBRARY[k]);
}

export const PRODUCT_TEMPLATES = {
  iPhone: fields("model", "generation", "storage_gb", "color", "battery_percentage", "sim_type", "subscription", "simlock", "condition", "warranty_months", "accessories", "box_included", "cosmetic_notes", "sell_price", "new_price", "manufacturer_name"),
  iPad: fields("model", "generation", "screen_size", "storage_gb", "color", "wifi_cellular", "sim_type", "battery_percentage", "condition", "warranty_months", "apple_pencil_support", "accessories", "box_included", "cosmetic_notes", "sell_price", "new_price", "subscription", "simlock", "manufacturer_name"),
  MacBook: fields("model", "screen_size", "model_year", "chip", "cpu_variant", "gpu_variant", "ram_gb", "storage_gb", "color", "keyboard_layout", "battery_percentage", "cycle_count", "condition", "warranty_months", "accessories", "box_included", "cosmetic_notes", "sell_price", "new_price", "manufacturer_name"),
  iMac: fields("model", "screen_size", "model_year", "chip", "ram_gb", "storage_gb", "gpu_variant", "color", "keyboard_included", "mouse_included", "condition", "warranty_months", "cosmetic_notes", "sell_price", "new_price", "manufacturer_name"),
  "Mac mini": fields("model", "model_year", "chip", "cpu_variant", "gpu_variant", "ram_gb", "storage_gb", "condition", "warranty_months", "accessories", "cosmetic_notes", "sell_price", "new_price", "manufacturer_name"),
  "Apple Watch": fields("watch_series", "watch_case_size", "color", "watch_material", "watch_connectivity", "watch_band", "battery_percentage", "condition", "warranty_months", "accessories", "cosmetic_notes", "sell_price", "new_price", "subscription", "simlock", "manufacturer_name"),
};

export const PRODUCT_TYPES = Object.keys(PRODUCT_TEMPLATES);
