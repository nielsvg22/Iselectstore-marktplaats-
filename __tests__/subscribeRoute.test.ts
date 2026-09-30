import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/lib/rateLimit";

const sub = vi.hoisted(() => ({ createSubscription: vi.fn() }));
vi.mock("@/services/inventory/subscriptionService", () => sub);

const shopify = vi.hoisted(() => ({ getProduct: vi.fn() }));
vi.mock("@/lib/shopify/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify/client")>();
  return { ...actual, ...shopify };
});

vi.mock("@/services/shopify/productIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/shopify/productIdentity")>();
  return { ...actual, resolveProductIdentity: vi.fn(async () => ({ productType: "iPhone", model: "iPhone 15 Pro", storage: "256GB" })) };
});

import { POST, OPTIONS } from "@/app/api/inventory/subscribe/route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/inventory/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  sub.createSubscription.mockResolvedValue({ subscription: { id: 1 }, created: true });
  shopify.getProduct.mockResolvedValue({ id: 111, title: "iPhone 15 Pro 256GB", product_type: "iPhone", handle: "iphone-15-pro-256gb", images: [], variants: [] });
  process.env.CORS_ORIGINS = "";
  process.env.SHOPIFY_STOREFRONT_URL = "https://iselectstore.nl";
  process.env.SHOPIFY_STORE_DOMAIN = "ggh8q9-v1.myshopify.com";
});

describe("POST /api/inventory/subscribe", () => {
  it("accepts a valid sign-up and stores the resolved identity", async () => {
    const res = await POST(req({ email: "Test@Example.com", productId: "111" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toBe("ok");
    expect(sub.createSubscription).toHaveBeenCalledWith({
      email: "test@example.com",
      productType: "iPhone",
      model: "iPhone 15 Pro",
      storage: "256GB",
    });
  });

  it("rejects an invalid e-mail without touching the database", async () => {
    const res = await POST(req({ email: "niet-geldig", productId: "111" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
    expect(sub.createSubscription).not.toHaveBeenCalled();
  });

  it("rejects an unknown e-mail shape without touching the database", async () => {
    const res = await POST(req({ email: "a@b", productId: "111" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
    expect(sub.createSubscription).not.toHaveBeenCalled();
  });

  it("returns already_subscribed for an identical second sign-up", async () => {
    sub.createSubscription.mockResolvedValue({ subscription: { id: 1 }, created: false });
    const res = await POST(req({ email: "test@example.com", productId: "111" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.code).toBe("already_subscribed");
  });

  it("rejects a malformed product id", async () => {
    const res = await POST(req({ email: "test@example.com", productId: "111; DROP TABLE" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_product");
    expect(sub.createSubscription).not.toHaveBeenCalled();
  });

  it("returns invalid_product when Shopify does not know the product", async () => {
    shopify.getProduct.mockRejectedValue(new Error("404"));
    const res = await POST(req({ email: "test@example.com", productId: "999" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_product");
  });

  it("returns unrecognized_product when the identity is incomplete", async () => {
    const { resolveProductIdentity } = await import("@/services/shopify/productIdentity");
    vi.mocked(resolveProductIdentity).mockResolvedValueOnce({ productType: "", model: "", storage: "" });
    const res = await POST(req({ email: "test@example.com", productId: "111" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("unrecognized_product");
    expect(sub.createSubscription).not.toHaveBeenCalled();
  });

  it("rate-limits after the configured number of attempts", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 25; i++) {
      last = await POST(req({ email: `user${i}@example.com`, productId: "111" }));
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect((await last!.json()).code).toBe("rate_limited");
  });

  it("answers the CORS preflight for the storefront origin", async () => {
    const res = await OPTIONS(new NextRequest("http://localhost/api/inventory/subscribe", { method: "OPTIONS", headers: { origin: "https://iselectstore.nl" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://iselectstore.nl");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });

  it("does not echo the storefront origin back when it is not allow-listed", async () => {
    const res = await OPTIONS(new NextRequest("http://localhost/api/inventory/subscribe", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still allows theme-preview origins on *.myshopify.com", async () => {
    const res = await OPTIONS(new NextRequest("http://localhost/api/inventory/subscribe", { method: "OPTIONS", headers: { origin: "https://ggh8q9-v1.myshopify.com" } }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://ggh8q9-v1.myshopify.com");
  });
});
