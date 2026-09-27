import { describe, it, expect } from "vitest";
import { PRODUCT_TEMPLATES } from "@/lib/templates/registry";
import { generateShopifyTitle, generateMarktplaatsTitle } from "@/lib/marktplaats/titleGenerator";

describe("iPhone template — FASE 49 testcase", () => {
  const template = PRODUCT_TEMPLATES.iPhone;
  const data = {
    model: "iPhone 15 Pro",
    storage_gb: "256",
    color: "Natural Titanium",
    battery_percentage: "94",
    warranty_months: "12",
  };

  it("builds the clean Shopify title without battery/warranty", () => {
    const title = generateShopifyTitle(template, data);
    expect(title).toBe("iPhone 15 Pro 256GB Natural Titanium");
    expect(title).not.toMatch(/batt/i);
    expect(title).not.toMatch(/garantie/i);
  });

  it("builds the extended Marktplaats title", () => {
    const shopifyTitle = generateShopifyTitle(template, data);
    const mpTitle = generateMarktplaatsTitle(template, data, shopifyTitle);
    expect(mpTitle).toBe("iPhone 15 Pro 256GB Natural Titanium / 94% batt / 12 mnd garantie");
  });
});

describe("MacBook template — FASE 49 testcase", () => {
  const template = PRODUCT_TEMPLATES.MacBook;
  const data = {
    model: "MacBook Pro",
    screen_size: '14"',
    chip: "M3 Pro",
    ram_gb: "18",
    storage_gb: "512",
    color: "Space Black",
    battery_percentage: "93",
    cycle_count: "87",
    warranty_months: "12",
  };

  it("builds the clean Shopify title without battery/warranty", () => {
    const title = generateShopifyTitle(template, data);
    expect(title).toBe('MacBook Pro 14" M3 Pro 18GB 512GB');
  });

  it("builds the extended Marktplaats title", () => {
    const shopifyTitle = generateShopifyTitle(template, data);
    const mpTitle = generateMarktplaatsTitle(template, data, shopifyTitle);
    expect(mpTitle).toBe('MacBook Pro 14" M3 Pro 18GB 512GB / 93% batt / 12 mnd garantie');
  });
});

describe("Marktplaats title override", () => {
  it("uses the custom title verbatim when set", () => {
    const template = PRODUCT_TEMPLATES.iPhone;
    const data = { model: "iPhone 15 Pro", storage_gb: "256", color: "Natural Titanium" };
    const shopifyTitle = generateShopifyTitle(template, data);
    const mpTitle = generateMarktplaatsTitle(template, data, shopifyTitle, "Mijn eigen titel");
    expect(mpTitle).toBe("Mijn eigen titel");
  });
});

describe("Marktplaats title length limit", () => {
  it("shortens intelligently, dropping extras before the core title", () => {
    const template = PRODUCT_TEMPLATES.MacBook;
    const data = {
      model: "MacBook Pro",
      screen_size: '16"',
      chip: "M3 Max met 16-core CPU en 40-core GPU variant",
      ram_gb: "128",
      storage_gb: "8000",
      battery_percentage: "100",
      warranty_months: "24",
    };
    const shopifyTitle = generateShopifyTitle(template, data);
    const mpTitle = generateMarktplaatsTitle(template, data, shopifyTitle);
    expect(mpTitle.length).toBeLessThanOrEqual(80);
  });
});
