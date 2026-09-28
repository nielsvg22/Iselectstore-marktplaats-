import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

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

import { POST, OPTIONS } from "@/app/api/shopify/quick-create/route";
import { createProduct, setProductMetafields } from "@/lib/shopify/client";

const SECRET = "route-test-secret";
const CLIENT_ID = "route-test-client-id";
const DEST = "https://ggh8q9-v1.myshopify.com";

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function makeToken(overrides: Record<string, unknown> = {}, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: `${DEST}/admin`,
      dest: DEST,
      aud: CLIENT_ID,
      sub: "42",
      exp: Math.floor(Date.now() / 1000) + 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      ...overrides,
    })
  );
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function jsonRequest(body: unknown, token?: string, origin = "https://admin.shopify.com"): Request {
  const raw = body === "__MALFORMED__" ? "{invalid json" : JSON.stringify(body);
  return new Request("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw,
  });
}

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
  process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  process.env.SHOPIFY_APP_CLIENT_ID = CLIENT_ID;
  process.env.SHOPIFY_STORE_DOMAIN = "ggh8q9-v1.myshopify.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://iselectstore-marktplaats-app.vercel.app";
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createProduct).mockResolvedValue({
    id: 166000001,
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

async function call(body: unknown, token?: string, origin?: string) {
  const res = await POST(jsonRequest(body, token, origin) as never);
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, json };
}

describe("POST /api/shopify/quick-create — endpoint tests (Test A)", () => {
  it("answers preflight for the Shopify admin origin", async () => {
    const res = await OPTIONS(
      new Request("https://x/api/shopify/quick-create", { method: "OPTIONS", headers: { Origin: "https://admin.shopify.com" } }) as never
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://admin.shopify.com");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("does not grant CORS to foreign origins", async () => {
    const res = await OPTIONS(
      new Request("https://x/api/shopify/quick-create", { method: "OPTIONS", headers: { Origin: "https://evil.example.com" } }) as never
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects requests without a Shopify id-token with 401", async () => {
    const { res, json } = await call(validBody, undefined);
    expect(res.status).toBe(401);
    expect(json.error).toMatch(/Shopify/i);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("rejects tokens for another store or app with 401", async () => {
    const foreign = makeToken({ dest: "https://other.myshopify.com", iss: "https://other.myshopify.com/admin" });
    const { res } = await call(validBody, foreign);
    expect(res.status).toBe(401);

    const wrongSecret = makeToken({}, "another-secret");
    const { res: res2 } = await call(validBody, wrongSecret);
    expect(res2.status).toBe(401);
  });

  it("creates a product and returns both titles", async () => {
    const { res, json } = await call(validBody, makeToken());
    expect(res.status).toBe(200);
    expect(json.productId).toBe("166000001");
    expect(json.status).toBe("draft");
    expect(json.shopifyTitle).toBe("iPhone 14 128GB Blauw");
    expect(json.marktplaatsTitle).toContain("iPhone 14 128GB Blauw");
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(setProductMetafields).toHaveBeenCalledTimes(1);
  });

  it("returns 400 with per-field issues for invalid data", async () => {
    const { res, json } = await call(
      { ...validBody, values: { model: "", sell_price: "gratis" } },
      makeToken()
    );
    expect(res.status).toBe(400);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(json.issues.some((i: { key: string }) => i.key === "sell_price")).toBe(true);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const { res } = await call("__MALFORMED__", makeToken());
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown product type", async () => {
    const { res, json } = await call({ ...validBody, productType: "Fruitmand" }, makeToken());
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad status value", async () => {
    const { res } = await call({ ...validBody, status: "live" }, makeToken());
    expect(res.status).toBe(400);
    expect(createProduct).not.toHaveBeenCalled();
  });
});
