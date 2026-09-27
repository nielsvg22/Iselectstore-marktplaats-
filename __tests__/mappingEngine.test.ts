import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES } from "@/lib/templates/registry";
import { getMockCategoryAttributes } from "@/lib/marktplaats/mock";

// mapProductToAttributes hits the DB for the field->attribute mapping table,
// so here we test the pure coercion behaviour indirectly via the mock
// attribute definitions to keep this suite DB-free; DB-backed mapping is
// covered by the "Test Marktplaats mapping" route in manual/integration
// testing (see MARKTPLAATS_INTEGRATION.md).

describe("mock category attributes", () => {
  it("exposes writable LIST attributes with allowed options", () => {
    const attrs = getMockCategoryAttributes("UNVERIFIED");
    const storage = attrs.find((a) => a.key === "mock_opslagcapaciteit");
    expect(storage?.type).toBe("LIST");
    expect(storage?.options?.map((o) => o.value)).toContain("512GB");
    expect(storage?.writable).toBe(true);
  });
});

describe("all six product templates are registered", () => {
  it("covers iPhone, iPad, MacBook, iMac, Mac mini, Apple Watch", () => {
    expect(Object.keys(PRODUCT_TEMPLATES).sort()).toEqual(["Apple Watch", "MacBook", "Mac mini", "iMac", "iPad", "iPhone"].sort());
  });

  it("never puts battery/warranty in shopifyTitleFields", () => {
    for (const template of Object.values(PRODUCT_TEMPLATES)) {
      expect(template.shopifyTitleFields).not.toContain("battery_percentage");
      expect(template.shopifyTitleFields).not.toContain("warranty_months");
    }
  });
});
