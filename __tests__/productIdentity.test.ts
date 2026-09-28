import { describe, it, expect } from "vitest";
import { extractProductIdentity } from "@/services/shopify/productIdentity";
import type { ShopifyProduct } from "@/lib/shopify/client";

function makeProduct(partial: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 1,
    title: "iPhone 15 Pro 256GB",
    product_type: "iPhone",
    vendor: "Apple",
    body_html: null,
    images: [],
    variants: [
      { id: 1, price: "999.00", compare_at_price: null, inventory_quantity: 1, inventory_management: "shopify" },
    ],
    ...partial,
  } as ShopifyProduct;
}

describe("extractProductIdentity", () => {
  it("extracts identity from title when no metafields present", () => {
    const product = makeProduct();
    const identity = extractProductIdentity(product);
    expect(identity.productType).toBe("iPhone");
    expect(identity.model).toBe("iPhone 15 Pro");
    expect(identity.storage).toBe("256GB");
  });

  it("prefers mkt.model and custom.storage_gb metafields", () => {
    const product = makeProduct({
      title: "iPhone 15 Pro 256GB",
    }) as ShopifyProduct & {
      metafields: { namespace: string; key: string; value: string }[];
    };
    product.metafields = [
      { namespace: "app--428689915905--mkt", key: "model", value: "iPhone 15 Pro" },
      { namespace: "custom", key: "storage_gb", value: "256" },
    ];
    const identity = extractProductIdentity(product);
    expect(identity.model).toBe("iPhone 15 Pro");
    expect(identity.storage).toBe("256GB");
  });

  it("does not match wrong storage", () => {
    const product = makeProduct({ title: "iPhone 15 Pro 512GB" });
    const identity = extractProductIdentity(product);
    expect(identity.storage).toBe("512GB");
  });
});
