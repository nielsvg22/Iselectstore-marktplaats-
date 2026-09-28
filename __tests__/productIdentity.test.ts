import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractProductIdentity, resolveProductIdentity } from "@/services/shopify/productIdentity";
import type { ShopifyProduct } from "@/lib/shopify/client";
import { getAllProductMetafields } from "@/lib/shopify/client";

vi.mock("@/lib/shopify/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify/client")>();
  return { ...actual, getAllProductMetafields: vi.fn() };
});

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

  it("collapses whitespace left behind by removing the storage token", () => {
    const product = makeProduct({ title: "iPhone 15 Pro 256GB zwart" });
    const identity = extractProductIdentity(product);
    expect(identity.model).toBe("iPhone 15 Pro zwart");
    expect(identity.storage).toBe("256GB");
  });

  it("supports TB titles", () => {
    const product = makeProduct({ title: "MacBook Pro M3 1TB space grey" });
    const identity = extractProductIdentity(product);
    expect(identity.model).toBe("MacBook Pro M3 space grey");
    expect(identity.storage).toBe("1TB");
  });
});

describe("resolveProductIdentity", () => {
  beforeEach(() => {
    vi.mocked(getAllProductMetafields).mockReset();
  });

  it("returns title identity without a metafields call when the title is complete", async () => {
    const identity = await resolveProductIdentity(makeProduct());
    expect(identity).toEqual({ productType: "iPhone", model: "iPhone 15 Pro", storage: "256GB" });
    expect(getAllProductMetafields).not.toHaveBeenCalled();
  });

  it("enriches with metafields when the title has no storage token", async () => {
    vi.mocked(getAllProductMetafields).mockResolvedValue([
      { namespace: "custom", key: "storage_gb", value: 32, type: "number_integer" },
    ]);

    const identity = await resolveProductIdentity(
      makeProduct({ title: "Apple Watch SE 40mm", product_type: "Apple Watch" })
    );
    expect(identity).toEqual({ productType: "Apple Watch", model: "Apple Watch SE 40mm", storage: "32GB" });
    expect(getAllProductMetafields).toHaveBeenCalledWith("1");
  });

  it("falls back to title identity when the metafields call fails", async () => {
    vi.mocked(getAllProductMetafields).mockRejectedValue(new Error("rate limited"));

    const identity = await resolveProductIdentity(
      makeProduct({ title: "Apple Watch SE 40mm", product_type: "Apple Watch" })
    );
    expect(identity).toEqual({ productType: "Apple Watch", model: "Apple Watch SE 40mm", storage: "" });
  });
});
