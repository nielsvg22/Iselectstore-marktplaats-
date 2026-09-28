import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES, listProductTypes, getTemplate } from "@/lib/templates/registry";
import { FIELD_LIBRARY } from "@/lib/templates/types";
import {
  validateQuickProductData,
  applyTemplateDefaults,
  buildQuickProductTitles,
} from "@/lib/templates/quickProduct";
import {
  metafieldTypeFor,
  metafieldsForTemplateData,
  MKT_NAMESPACE,
  STOREFRONT_MIRROR_KEYS,
  STOREFRONT_MIRROR_NAMESPACE,
} from "@/lib/shopify/metafields";
import { AI_FIELD_METAFIELD_TYPE } from "@/lib/ai/allowedFields";

const IPHONE_OK: Record<string, unknown> = {
  model: "iPhone 15 Pro",
  storage_gb: "256",
  color: "Zwart",
  battery_percentage: "94",
  condition: "Als nieuw",
  warranty_months: "12",
  sell_price: "569,00",
  new_price: "899",
};

describe("validateQuickProductData — Test A/B", () => {
  it("accepts a complete iPhone payload and normalizes values", () => {
    const result = validateQuickProductData("iPhone", IPHONE_OK);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    // comma -> dot for numbers
    expect(result.values.sell_price).toBe("569.00");
    expect(result.values.new_price).toBe("899");
    // defaults for empty fields with a preset
    expect(result.values.manufacturer_name).toBe("Apple");
    expect(result.values.subscription).toBe("Zonder abonnement");
    expect(result.values.simlock).toBe("Zonder simlock");
  });

  it("reports every missing required field per key", () => {
    const result = validateQuickProductData("iPhone", {});
    expect(result.ok).toBe(false);
    const keys = result.issues.map((i) => i.key);
    for (const required of ["model", "storage_gb", "color", "condition", "sell_price"]) {
      expect(keys).toContain(required);
    }
    // presets mean these never show up as errors
    expect(keys).not.toContain("manufacturer_name");
    const model = result.issues.find((i) => i.key === "model");
    expect(model?.message).toContain("Model");
  });

  it("rejects non-numeric numbers and select values outside the options", () => {
    const result = validateQuickProductData("iPhone", {
      ...IPHONE_OK,
      storage_gb: "256GB",
      condition: "Prachtig",
    });
    expect(result.ok).toBe(false);
    const keys = result.issues.map((i) => i.key);
    expect(keys).toContain("storage_gb");
    expect(keys).toContain("condition");
  });

  it("rejects unknown product types", () => {
    const result = validateQuickProductData("Fruitmand", IPHONE_OK);
    expect(result.ok).toBe(false);
    expect(result.issues[0].key).toBe("productType");
  });

  it("drops keys that are not part of the template", () => {
    const result = validateQuickProductData("iPhone", {
      ...IPHONE_OK,
      evil_field: "payload",
      __proto__pollution: "x",
    });
    expect(result.values.evil_field).toBeUndefined();
    expect(result.values.__proto__pollution).toBeUndefined();
    expect(Object.keys(result.values).every((k) => getTemplate("iPhone")!.fields.some((f) => f.key === k))).toBe(true);
  });

  it("normalizes booleans", () => {
    const values = applyTemplateDefaults(PRODUCT_TEMPLATES.iPhone, {
      box_included: "1",
      ...IPHONE_OK,
    });
    expect(values.box_included).toBe("true");
  });

  it("validates every product type with at least one valid payload", () => {
    for (const type of listProductTypes()) {
      const template = PRODUCT_TEMPLATES[type];
      const data: Record<string, unknown> = {};
      for (const field of template.fields) {
        if (field.required) {
          data[field.key] =
            field.kind === "number" ? "10" : field.options ? field.options[0] : "X";
        }
      }
      const result = validateQuickProductData(type, data);
      expect(result.ok, `${type}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });
});

describe("buildQuickProductTitles — Test B (reuse, no duplication)", () => {
  it("matches the shared title generators exactly", () => {
    const titles = buildQuickProductTitles("iPhone", {
      ...IPHONE_OK,
      battery_percentage: "94",
      warranty_months: "12",
    });
    expect(titles.shopifyTitle).toBe("iPhone 15 Pro 256GB Zwart");
    expect(titles.marktplaatsTitle).toBe(
      "iPhone 15 Pro 256GB Zwart / 94% batt / 12 mnd garantie"
    );
  });

  it("never leaks battery/warranty into the Shopify title", () => {
    const titles = buildQuickProductTitles("MacBook", {
      model: "MacBook Air",
      screen_size: "13",
      chip: "M2",
      ram_gb: "8",
      storage_gb: "256",
      battery_percentage: "88",
      warranty_months: "6",
      sell_price: "649",
    });
    expect(titles.shopifyTitle).toBe("MacBook Air 13 M2 8GB 256GB");
    expect(titles.shopifyTitle).not.toMatch(/batt|garantie|88%|6 mnd/i);
    expect(titles.marktplaatsTitle).toContain("88% batt");
    expect(titles.marktplaatsTitle).toContain("6 mnd garantie");
  });
});

describe("metafield mapping — Test B (single source of truth)", () => {
  // Mirrors the live definitions in the store (queried 2026-09-28).
  const LIVE_TYPES: Record<string, string> = {
    model: "single_line_text_field",
    storage_gb: "number_integer",
    color: "single_line_text_field",
    battery_percentage: "number_integer",
    condition: "single_line_text_field",
    warranty_months: "number_integer",
    accessories: "multi_line_text_field",
    box_included: "boolean",
    cosmetic_notes: "multi_line_text_field",
    sell_price: "number_decimal",
    new_price: "number_decimal",
    generation: "single_line_text_field",
    sim_type: "single_line_text_field",
    wifi_cellular: "single_line_text_field",
    apple_pencil_support: "boolean",
    screen_size: "single_line_text_field",
    model_year: "number_integer",
    chip: "single_line_text_field",
    cpu_variant: "single_line_text_field",
    gpu_variant: "single_line_text_field",
    ram_gb: "number_integer",
    keyboard_layout: "single_line_text_field",
    cycle_count: "number_integer",
    keyboard_included: "boolean",
    mouse_included: "boolean",
    watch_series: "single_line_text_field",
    watch_case_size: "single_line_text_field",
    watch_material: "single_line_text_field",
    watch_band: "single_line_text_field",
    watch_connectivity: "single_line_text_field",
    subscription: "single_line_text_field",
    simlock: "single_line_text_field",
    manufacturer_name: "single_line_text_field",
  };

  it("every FIELD_LIBRARY key maps to its live metafield type", () => {
    for (const key of Object.keys(FIELD_LIBRARY)) {
      expect(metafieldTypeFor(key), key).toBe(LIVE_TYPES[key]);
    }
  });

  it("stays consistent with the AI write path (AI flow unchanged)", () => {
    for (const [key, type] of Object.entries(AI_FIELD_METAFIELD_TYPE)) {
      expect(metafieldTypeFor(key), key).toBe(type);
    }
  });

  it("writes mkt metafields plus the storefront custom mirror", () => {
    const template = PRODUCT_TEMPLATES.iPhone;
    const { values } = validateQuickProductData("iPhone", IPHONE_OK);
    const writes = metafieldsForTemplateData(template, values);

    const mkt = writes.filter((w) => w.namespace === MKT_NAMESPACE);
    expect(mkt.map((w) => w.key)).toContain("model");
    expect(mkt.map((w) => w.key)).toContain("sell_price");
    expect(mkt.find((w) => w.key === "sell_price")?.type).toBe("number_decimal");

    const mirrored = writes
      .filter((w) => w.namespace === STOREFRONT_MIRROR_NAMESPACE)
      .map((w) => w.key);
    expect(mirrored.sort()).toEqual([...STOREFRONT_MIRROR_KEYS].sort());
  });

  it("skips empty values", () => {
    const template = PRODUCT_TEMPLATES.iPhone;
    const writes = metafieldsForTemplateData(template, {
      model: "iPhone 15",
      warranty_months: "",
      accessories: "  ",
    });
    expect(writes.map((w) => w.key)).not.toContain("warranty_months");
    expect(writes.map((w) => w.key)).not.toContain("accessories");
  });
});
