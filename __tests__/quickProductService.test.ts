import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify/client", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  getProduct: vi.fn(),
  getStructuredFields: vi.fn(),
  setProductMetafields: vi.fn(async () => {}),
  getAllProductMetafields: vi.fn(async () => []),
  addProductImage: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({ logSync: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []) }));

import {
  createQuickProduct,
  updateQuickProduct,
  readQuickProduct,
  addQuickProductImage,
  QuickProductError,
} from "@/services/shopify/quickProductService";
import {
  createProduct,
  updateProduct,
  getProduct,
  getStructuredFields,
  setProductMetafields,
  addProductImage,
} from "@/lib/shopify/client";
import { MKT_NAMESPACE, STOREFRONT_MIRROR_NAMESPACE } from "@/lib/shopify/metafields";

const validValues = {
  model: "iPhone 15 Pro",
  storage_gb: "256",
  color: "Zwart",
  condition: "Als nieuw",
  sell_price: "569",
};

const mockedCreate = vi.mocked(createProduct);
const mockedUpdate = vi.mocked(updateProduct);
const mockedGet = vi.mocked(getProduct);
const mockedFields = vi.mocked(getStructuredFields);
const mockedSet = vi.mocked(setProductMetafields);
const mockedImage = vi.mocked(addProductImage);

function shopifyProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1659199999,
    title: "iPhone 15 Pro 256GB Zwart",
    product_type: "iPhone",
    vendor: "iSelectStore",
    body_html: null,
    handle: "iphone-15-pro-256gb-zwart",
    status: "draft",
    tags: "iPhone, pre-owned",
    images: [],
    variants: [
      {
        id: 6604500001,
        price: "569.00",
        compare_at_price: null,
        inventory_quantity: 1,
        inventory_management: "shopify",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreate.mockResolvedValue(shopifyProduct() as never);
  mockedUpdate.mockResolvedValue(shopifyProduct({ status: "active" }) as never);
  mockedGet.mockResolvedValue(shopifyProduct() as never);
  mockedFields.mockResolvedValue({ model: "iPhone 15 Pro", storage_gb: "256" } as never);
  mockedImage.mockResolvedValue({ id: 42, src: "https://cdn/img.jpg", position: 1 } as never);
});

describe("createQuickProduct — Test A (draft/active, voorraad=1, metafields)", () => {
  it("creates a draft product with tracked inventory of 1", async () => {
    const result = await createQuickProduct({
      productType: "iPhone",
      values: validValues,
      status: "draft",
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const payload = mockedCreate.mock.calls[0][0] as {
      status: string;
      vendor: string;
      tags: string;
      product_type: string;
      title: string;
      variants: Array<Record<string, unknown>>;
    };
    expect(payload.status).toBe("draft");
    expect(payload.vendor).toBe("iSelectStore");
    expect(payload.tags).toBe("iPhone, pre-owned");
    expect(payload.product_type).toBe("iPhone");
    expect(payload.title).toBe("iPhone 15 Pro 256GB Zwart");
    expect(payload.variants[0].inventory_management).toBe("shopify");
    expect(payload.variants[0].inventory_quantity).toBe(1);
    expect(payload.variants[0].price).toBe("569");

    expect(result.status).toBe("draft");
    expect(result.shopifyTitle).toBe("iPhone 15 Pro 256GB Zwart");
  });

  it("creates an active product when requested", async () => {
    const result = await createQuickProduct({
      productType: "iPhone",
      values: validValues,
      status: "active",
    });
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ status: "active" });
    expect(result.status).toBe("active");
  });

  it("writes mkt metafields and the storefront custom mirror", async () => {
    await createQuickProduct({
      productType: "iPhone",
      values: validValues,
      status: "draft",
    });

    expect(mockedSet).toHaveBeenCalledTimes(1);
    const [productId, writes] = mockedSet.mock.calls[0];
    expect(productId).toBe("1659199999");
    const mktKeys = writes.filter((w) => w.namespace === MKT_NAMESPACE).map((w) => w.key);
    expect(mktKeys).toEqual(
      expect.arrayContaining(["model", "storage_gb", "color", "condition", "sell_price"])
    );
    const mirror = writes.filter((w) => w.namespace === STOREFRONT_MIRROR_NAMESPACE);
    expect(mirror.map((w) => w.key).sort()).toEqual(["condition", "storage_gb"]);
    expect(writes.find((w) => w.key === "storage_gb" && w.namespace === STOREFRONT_MIRROR_NAMESPACE)?.value).toBe("256");
  });

  it("rejects an invalid status without touching Shopify", async () => {
    await expect(
      createQuickProduct({ productType: "iPhone", values: validValues, status: "published" as never })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid data with per-field issues and never creates a product", async () => {
    const err = await createQuickProduct({
      productType: "iPhone",
      values: { model: "", sell_price: "abc" },
      status: "draft",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(QuickProductError);
    expect(err.status).toBe(400);
    expect(err.issues.map((i: { key: string }) => i.key)).toEqual(
      expect.arrayContaining(["model", "storage_gb", "color", "condition", "sell_price"])
    );
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedSet).not.toHaveBeenCalled();
  });

  it("rejects an unknown product type", async () => {
    await expect(
      createQuickProduct({ productType: "Fruitmand", values: {}, status: "draft" })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("updateQuickProduct — quick-edit save", () => {
  it("updates title, variant price and metafields for an existing product", async () => {
    await updateQuickProduct({
      productId: "1659199999",
      productType: "iPhone",
      values: { ...validValues, sell_price: "599" },
    });

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const [id, payload] = mockedUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("1659199999");
    expect(payload.title).toBe("iPhone 15 Pro 256GB Zwart");
    expect(payload.product_type).toBe("iPhone");
    expect(payload).not.toHaveProperty("tags"); // type unchanged -> tags untouched
    expect(payload.variants).toEqual([{ id: 6604500001, price: "599", compare_at_price: null }]);
    expect(mockedSet).toHaveBeenCalledTimes(1);
  });

  it("keeps tags in sync when the product type changes", async () => {
    await updateQuickProduct({
      productId: "1659199999",
      productType: "iPad",
      values: {
        model: "iPad Air",
        storage_gb: "64",
        color: "Blauw",
        condition: "Nette staat",
        sell_price: "429",
      },
    });
    const payload = mockedUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.product_type).toBe("iPad");
    expect(payload.tags).toBe("iPad, pre-owned");
  });

  it("maps a missing product to 404", async () => {
    mockedGet.mockRejectedValue(new Error("Shopify API 404: Not Found"));
    const err = await updateQuickProduct({
      productId: "123",
      productType: "iPhone",
      values: validValues,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(QuickProductError);
    expect(err.status).toBe(404);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-numeric product ids", async () => {
    await expect(
      updateQuickProduct({ productId: "abc; DROP", productType: "iPhone", values: validValues })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe("readQuickProduct — block initial state", () => {
  it("returns metafield values with the variant price as source of truth", async () => {
    mockedGet.mockResolvedValue(
      shopifyProduct({
        status: "active",
        variants: [
          {
            id: 6604500001,
            price: "549.00",
            compare_at_price: "699.00",
            inventory_quantity: 1,
            inventory_management: "shopify",
          },
        ],
      }) as never
    );
    mockedFields.mockResolvedValue({ model: "iPhone 15 Pro", storage_gb: "256", sell_price: "999" } as never);

    const read = await readQuickProduct("1659199999");
    expect(read.productType).toBe("iPhone");
    expect(read.status).toBe("active");
    expect(read.values.model).toBe("iPhone 15 Pro");
    expect(read.values.sell_price).toBe("549.00"); // variant wins over stale metafield
    expect(read.values.new_price).toBe("699.00");
    expect(read.shopifyTitle).toBe("iPhone 15 Pro 256GB");
    expect(read.knownProductTypes).toContain("MacBook");
  });
});

describe("addQuickProductImage — Test C (upload validation)", () => {
  it("rejects unsupported extensions and invalid data", async () => {
    await expect(addQuickProductImage("1", "malware.exe", "AAAA")).rejects.toMatchObject({ status: 400 });
    await expect(addQuickProductImage("1", "empty.png", "")).rejects.toMatchObject({ status: 400 });
    expect(mockedImage).not.toHaveBeenCalled();
  });

  it("rejects files above 3 MB", async () => {
    const huge = Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString("base64");
    await expect(addQuickProductImage("1", "big.png", huge)).rejects.toMatchObject({ status: 400 });
    expect(mockedImage).not.toHaveBeenCalled();
  });

  it("rejects data that does not match the declared image type", async () => {
    await expect(
      addQuickProductImage("1", "fake.png", Buffer.from("not an image at all").toString("base64"))
    ).rejects.toMatchObject({ status: 400 });
    expect(mockedImage).not.toHaveBeenCalled();
  });

  it("uploads a valid PNG", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]);
    const res = await addQuickProductImage("1659199999", "photo.png", png.toString("base64"));
    expect(res.imageId).toBe(42);
    expect(mockedImage).toHaveBeenCalledTimes(1);
    const [, buffer, filename] = mockedImage.mock.calls[0];
    expect(filename).toBe("photo.png");
    expect(buffer.length).toBe(png.length);
  });
});
