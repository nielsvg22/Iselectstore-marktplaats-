// Interne beheerapp-route /api/admin/quick-create: dezelfde creatie-logica als
// de extension-route, maar bewust zonder idToken-authenticatie (de beheerpagina
// draait server-side zonder Shopify-sessietoken, net als /api/ai/*).
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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

import { POST } from "@/app/api/admin/quick-create/route";
import { createProduct } from "@/lib/shopify/client";

const validBody = {
  productType: "iPhone",
  status: "draft",
  values: {
    model: "iPhone 14",
    storage_gb: "128",
    color: "Blauw",
    condition: "Nette staat",
    sell_price: "399",
  },
};

beforeAll(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "ggh8q9-v1.myshopify.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://iselectstore-marktplaats-app.vercel.app";
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createProduct).mockResolvedValue({
    id: 166000002,
    title: "iPhone 14 128GB Blauw",
    product_type: "iPhone",
    vendor: "iSelectStore",
    body_html: null,
    handle: "iphone-14-128gb-blauw",
    status: "draft",
    tags: "iPhone, pre-owned",
    images: [],
    variants: [
      { id: 1, price: "399", compare_at_price: null, inventory_quantity: 1, inventory_management: "shopify" },
    ],
  } as never);
});

async function call(body: unknown) {
  const raw = body === "__MALFORMED__" ? "{invalid json" : JSON.stringify(body);
  const res = await POST(
    new Request("https://iselectstore-marktplaats-app.vercel.app/api/admin/quick-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    }) as never
  );
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, json };
}

describe("POST /api/admin/quick-create (interne beheerapp-route)", () => {
  it("creëert een product zonder Shopify idToken", async () => {
    const { res, json } = await call(validBody);
    expect(res.status).toBe(200);
    expect(json.productId).toBe("166000002");
    expect(json.shopifyTitle).toContain("iPhone 14");
    expect(json.marktplaatsTitle).toBeTruthy();
    expect(createProduct).toHaveBeenCalledTimes(1);
  });

  it("accepteert status active en retourneert de status", async () => {
    const { res, json } = await call({ ...validBody, status: "active" });
    expect(res.status).toBe(200);
    expect(json.status).toBe("active");
  });

  it("retourneert 400 met veldissues bij onvolledige waarden", async () => {
    const { res, json } = await call({ productType: "iPhone", status: "draft", values: {} });
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("retourneert 400 voor een onbekend producttype", async () => {
    const { res, json } = await call({ productType: "Toaster", status: "draft", values: validBody.values });
    expect(res.status).toBe(400);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("retourneert 400 voor een ongeldige status", async () => {
    const { res } = await call({ ...validBody, status: "published" });
    expect(res.status).toBe(400);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("retourneert 400 voor kapotte JSON", async () => {
    const { res } = await call("__MALFORMED__");
    expect(res.status).toBe(400);
    expect(createProduct).not.toHaveBeenCalled();
  });
});
