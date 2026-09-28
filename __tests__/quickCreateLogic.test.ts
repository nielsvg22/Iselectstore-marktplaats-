// Formulierlogica van /admin/quick-create: beginwaarden, verplichte-velden-
// teller en het omzetten van AI-waarden naar formulierwaarden (spec §14).
import { describe, it, expect } from "vitest";
import {
  aiFieldsToValues,
  aiValueForField,
  initialValuesFor,
  missingRequiredCount,
} from "@/app/admin/quick-create/quickCreateLogic";
import { getTemplate } from "@/lib/templates/registry";

function fieldDef(productType: string, key: string) {
  const def = getTemplate(productType)?.fields.find((f) => f.key === key);
  if (!def) throw new Error(`onbekend veld: ${key}`);
  return def;
}

describe("initialValuesFor", () => {
  it("levert template-defaults zonder verplichte velden te vullen", () => {
    const initials = initialValuesFor("iPhone");
    expect(initials.manufacturer_name).toBe("Apple");
    expect(initials.sell_price).toBeUndefined();
    expect(initials.model).toBeUndefined();
  });

  it("leegt object voor onbekend producttype", () => {
    expect(initialValuesFor("Toaster")).toEqual({});
  });
});

describe("missingRequiredCount", () => {
  const template = getTemplate("iPhone")!;

  it("telt alle verplichte velden bij een leeg formulier", () => {
    const required = template.fields.filter((f) => f.required).length;
    expect(required).toBeGreaterThan(0);
    expect(missingRequiredCount(template, {})).toBe(required);
  });

  it("telt af naarmate velden gevuld raken en is default-bewust", () => {
    const all = Object.fromEntries(
      template.fields.filter((f) => f.required).map((f) => [f.key, "1"])
    );
    expect(missingRequiredCount(template, all)).toBe(0);

    const missingOne = { ...all };
    const firstRequired = template.fields.find((f) => f.required)!;
    missingOne[firstRequired.key] = "";
    expect(missingRequiredCount(template, missingOne)).toBe(1);
  });

  it("is 0 voor een onbekend template", () => {
    expect(missingRequiredCount(undefined, {})).toBe(0);
  });
});

describe("aiValueForField", () => {
  it("haalt het numerieke deel uit AI-getalvelden", () => {
    expect(aiValueForField(fieldDef("MacBook", "ram_gb"), "18GB")).toBe("18");
    expect(aiValueForField(fieldDef("iPhone", "storage_gb"), "256 GB")).toBe("256");
    expect(aiValueForField(fieldDef("iPhone", "battery_percentage"), "94%")).toBe("94");
    expect(aiValueForField(fieldDef("MacBook", "cycle_count"), 87)).toBe("87");
    expect(aiValueForField(fieldDef("iPhone", "sell_price"), "geen")).toBeNull();
  });

  it("matcht selectopties ook case-insensitief en faalt otherwise", () => {
    expect(aiValueForField(fieldDef("iPhone", "sim_type"), "eSIM")).toBe("eSIM");
    expect(aiValueForField(fieldDef("iPhone", "sim_type"), "esim")).toBe("eSIM");
    expect(aiValueForField(fieldDef("iPhone", "sim_type"), "Physical SIM")).toBeNull();
  });

  it("gebruikt tekstvelden zoals ze zijn (getrimd)", () => {
    expect(aiValueForField(fieldDef("MacBook", "chip"), "  Apple M3 Pro ")).toBe("Apple M3 Pro");
    expect(aiValueForField(fieldDef("Apple Watch", "watch_case_size"), "45mm")).toBe("45mm");
  });
});

describe("aiFieldsToValues", () => {
  const template = getTemplate("MacBook")!;

  it("vult geldige velden en slaat onbekende/niet-passende over", () => {
    const { values, appliedKeys } = aiFieldsToValues(template, {}, [
      { key: "ram_gb", value: "18GB" },
      { key: "chip", value: "M3 Pro" },
      { key: "battery_percentage", value: "93%" },
      { key: "bestaat_niet", value: "x" },
      { key: "sell_price", value: "wat dan ook" },
    ]);
    expect(appliedKeys).toEqual(["ram_gb", "chip", "battery_percentage"]);
    expect(values.ram_gb).toBe("18");
    expect(values.chip).toBe("M3 Pro");
    expect(values.battery_percentage).toBe("93");
    expect(values.bestaat_niet).toBeUndefined();
    expect(values.sell_price).toBeUndefined();
  });

  it("mutateert de invoerwaarden niet", () => {
    const original = { color: "Zwart" };
    const { values } = aiFieldsToValues(template, original, [{ key: "chip", value: "M3" }]);
    expect(original).toEqual({ color: "Zwart" });
    expect(values.color).toBe("Zwart");
  });

  it("levert niets op bij onbekend template", () => {
    const { values, appliedKeys } = aiFieldsToValues(undefined, { a: "b" }, [{ key: "chip", value: "M3" }]);
    expect(values).toEqual({ a: "b" });
    expect(appliedKeys).toEqual([]);
  });
});
