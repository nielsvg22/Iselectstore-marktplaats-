import { describe, it, expect } from "vitest";
import { isSoldOut, isBackInStock } from "../lib/soldImage/detectSoldOut";

describe("isSoldOut", () => {
  it("is true when every tracked variant is at zero", () => {
    expect(isSoldOut({ variants: [{ inventory_quantity: 0, inventory_management: "shopify" }] })).toBe(true);
  });

  it("is true when every tracked variant is negative (oversold)", () => {
    expect(isSoldOut({ variants: [{ inventory_quantity: -2, inventory_management: "shopify" }] })).toBe(true);
  });

  it("is false when at least one tracked variant still has stock", () => {
    expect(
      isSoldOut({
        variants: [
          { inventory_quantity: 0, inventory_management: "shopify" },
          { inventory_quantity: 3, inventory_management: "shopify" },
        ],
      })
    ).toBe(false);
  });

  it("is false when inventory isn't tracked at all, regardless of quantity", () => {
    expect(isSoldOut({ variants: [{ inventory_quantity: 0, inventory_management: null }] })).toBe(false);
  });

  it("ignores untracked variants when mixed with tracked ones", () => {
    expect(
      isSoldOut({
        variants: [
          { inventory_quantity: 0, inventory_management: "shopify" },
          { inventory_quantity: 999, inventory_management: null },
        ],
      })
    ).toBe(true);
  });
});

describe("isBackInStock", () => {
  it("is true once a tracked variant has positive stock", () => {
    expect(isBackInStock({ variants: [{ inventory_quantity: 5, inventory_management: "shopify" }] })).toBe(true);
  });

  it("is false while all tracked variants are still at zero", () => {
    expect(isBackInStock({ variants: [{ inventory_quantity: 0, inventory_management: "shopify" }] })).toBe(false);
  });

  it("is false for untracked inventory", () => {
    expect(isBackInStock({ variants: [{ inventory_quantity: 5, inventory_management: null }] })).toBe(false);
  });
});
