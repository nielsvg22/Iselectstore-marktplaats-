import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES } from "@/lib/templates/registry";
import { buildBrowserTestPlan } from "@/lib/marktplaats/browserTest/fieldPlan";
import type { ProductPreview } from "@/lib/marktplaats/orchestrator";

// buildBrowserTestPlan is pure — it only reads from the already-built
// ProductPreview (same object the mapping-test and future API publisher
// use), so we construct one by hand here instead of hitting Shopify/DB.
function fakePreview(overrides: Partial<ProductPreview> = {}): ProductPreview {
  const template = PRODUCT_TEMPLATES.iPhone;
  const data: Record<string, string> = {
    model: "iPhone 15 Pro",
    storage_gb: "256",
    color: "Zwart titanium",
    battery_percentage: "97",
    condition: "Zeer nette staat",
    manufacturer_name: "Apple",
    subscription: "Zonder abonnement",
    simlock: "Zonder simlock",
  };

  return {
    shopifyProductId: "123",
    productType: "iPhone",
    shopifyTitle: "iPhone 15 Pro 256GB Zwart titanium",
    marktplaatsTitle: "iPhone 15 Pro 256GB Zwart titanium - 97% batterij",
    marktplaatsDescription: "Een nette iPhone 15 Pro, 97% batterijconditie.",
    categoryMapping: {
      shopifyProductType: "iPhone",
      l1CategoryId: "UNVERIFIED",
      l2CategoryId: "UNVERIFIED",
      l1CategoryName: "Telecommunicatie",
      l2CategoryName: "Mobiele telefoons | Apple iPhone",
    },
    mappingSource: "mock",
    attributeResults: [],
    validation: { checks: [], publishable: true },
    payloadPreview: {
      categoryId: 0,
      priceModel: { modelType: "fixed", askingPrice: 69900 },
      location: {},
      translations: [],
      imageUrls: ["https://cdn.shopify.com/img1.jpg", "https://cdn.shopify.com/img2.jpg"],
    },
    imageUrls: ["https://cdn.shopify.com/img1.jpg", "https://cdn.shopify.com/img2.jpg"],
    template,
    data,
    price: 699,
    ...overrides,
  };
}

describe("buildBrowserTestPlan", () => {
  it("includes title, price, category and description as top-level fields", () => {
    const plan = buildBrowserTestPlan(fakePreview());
    const keys = plan.fields.map((f) => f.key);
    expect(keys).toContain("title");
    expect(keys).toContain("price");
    expect(keys).toContain("category");
    expect(keys).toContain("description");
  });

  it("only includes template fields that actually have a value", () => {
    const plan = buildBrowserTestPlan(fakePreview());
    const keys = plan.fields.map((f) => f.key);
    expect(keys).toContain("model");
    expect(keys).toContain("storage_gb");
    // warranty_months has no value in our fake data -> must be skipped, not sent as empty
    expect(keys).not.toContain("warranty_months");
  });

  it("applies the real-page label override for storage_gb instead of the internal label", () => {
    const plan = buildBrowserTestPlan(fakePreview());
    const storageField = plan.fields.find((f) => f.key === "storage_gb");
    expect(storageField?.labels[0]).toBe("Opslagcapaciteit");
    // internal FIELD_LIBRARY label stays as a fallback, never dropped
    expect(storageField?.labels).toContain("Opslag (GB)");
  });

  it("attaches value synonyms for condition so a differently-worded option still matches", () => {
    const plan = buildBrowserTestPlan(fakePreview());
    const conditionField = plan.fields.find((f) => f.key === "condition");
    expect(conditionField?.value).toBe("Zeer nette staat");
    expect(conditionField?.valueSynonyms).toContain("Zeer goed");
  });

  it("carries the raw price (euros, not cents) and all image URLs through unchanged", () => {
    const plan = buildBrowserTestPlan(fakePreview());
    const priceField = plan.fields.find((f) => f.key === "price");
    expect(priceField?.value).toBe("699");
    expect(plan.imageUrls).toEqual(["https://cdn.shopify.com/img1.jpg", "https://cdn.shopify.com/img2.jpg"]);
  });

  it("skips the category field entirely when there is no category mapping", () => {
    const plan = buildBrowserTestPlan(fakePreview({ categoryMapping: null }));
    expect(plan.fields.map((f) => f.key)).not.toContain("category");
    expect(plan.categoryLabel).toBeNull();
  });
});
