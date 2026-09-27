import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES } from "@/lib/templates/registry";
import { generateMarktplaatsDescription } from "@/lib/marktplaats/descriptionGenerator";

describe("Marktplaats description generator", () => {
  it("skips empty fields and includes filled ones (MacBook example from spec)", () => {
    const template = PRODUCT_TEMPLATES.MacBook;
    const data = {
      ram_gb: "18",
      storage_gb: "512",
      color: "Space Black",
      battery_percentage: "94",
      warranty_months: "12",
      cycle_count: "87",
      cosmetic_notes: "Lichte gebruikssporen aan de onderzijde.",
      accessories: "Originele oplader.",
    };

    const desc = generateMarktplaatsDescription(template, data, "MacBook Pro 14\" M3 Pro 18GB 512GB", null);

    expect(desc).toContain("Batterijconditie: 94%");
    expect(desc).toContain("Garantie: 12 maanden");
    expect(desc).toContain("Cycli: 87");
    expect(desc).toContain("Lichte gebruikssporen aan de onderzijde.");
    expect(desc).toContain("Originele oplader.");
    expect(desc).toContain("Alle foto's zijn van het daadwerkelijke apparaat.");
  });

  it("uses the custom description verbatim when set", () => {
    const template = PRODUCT_TEMPLATES.iPhone;
    const desc = generateMarktplaatsDescription(template, {}, "iPhone 15 Pro", null, "Mijn eigen beschrijving");
    expect(desc).toBe("Mijn eigen beschrijving");
  });

  it("never blindly copies the raw Shopify HTML body without stripping tags", () => {
    const template = PRODUCT_TEMPLATES.iPhone;
    const desc = generateMarktplaatsDescription(template, {}, "iPhone 15 Pro", "<p>Some <b>html</b></p>");
    expect(desc).not.toContain("<p>");
    expect(desc).toContain("Some html");
  });
});
