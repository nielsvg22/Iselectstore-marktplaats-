import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify/client";

vi.mock("@/lib/shopify/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shopify/client")>();
  return { ...actual, getAllProductMetafields: vi.fn(), getProduct: vi.fn(), listProducts: vi.fn() };
});
vi.mock("@/lib/logging", () => ({ logSync: vi.fn().mockResolvedValue(undefined) }));

const subscriptionService = vi.hoisted(() => ({
  findActiveSubscriptions: vi.fn(),
  claimForNotification: vi.fn(),
  releaseNotificationClaim: vi.fn(),
  markNotified: vi.fn(),
}));
vi.mock("@/services/inventory/subscriptionService", () => subscriptionService);

const historyService = vi.hoisted(() => ({
  recordSentNotification: vi.fn(),
  hasNotificationBeenSent: vi.fn(),
}));
vi.mock("@/services/inventory/notificationHistoryService", () => historyService);

const providerMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/services/notifications/emailProviderFactory", () => ({
  createEmailProvider: vi.fn(() => ({ name: "mock", send: providerMock.send })),
  EmailConfigError: class extends Error {},
  isProductionRuntime: () => false,
  assertEmailProviderConfigured: vi.fn(),
}));

import { checkProductObjectAndNotify, getProductUrl, getStorefrontBase, buildEmailHtml } from "@/services/inventory/notificationService";
import { normalizeStorage, normalizeIdentity, extractProductIdentity } from "@/services/shopify/productIdentity";

function makeProduct(partial: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 4242,
    title: "iPhone 15 Pro 256GB",
    product_type: "iPhone",
    vendor: "Apple",
    body_html: null,
    handle: "iphone-15-pro-256gb",
    images: [],
    variants: [
      { id: 1, price: "999.00", compare_at_price: null, inventory_quantity: 3, inventory_management: "shopify" },
    ],
    ...partial,
  } as ShopifyProduct;
}

const activeSub = {
  id: 77,
  email: "test@example.com",
  productType: "iPhone",
  model: "iPhone 15 Pro",
  storage: "256GB",
  signupAt: new Date().toISOString(),
  status: "active" as const,
  notifiedAt: null,
  matchedProductId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionService.findActiveSubscriptions.mockResolvedValue([activeSub]);
  subscriptionService.claimForNotification.mockResolvedValue(true);
  subscriptionService.releaseNotificationClaim.mockResolvedValue(undefined);
  subscriptionService.markNotified.mockResolvedValue(undefined);
  historyService.hasNotificationBeenSent.mockResolvedValue(false);
  historyService.recordSentNotification.mockResolvedValue(true);
  providerMock.send.mockResolvedValue({ ok: true, provider: "mock" });
  process.env.SHOPIFY_STOREFRONT_URL = "";
  process.env.SHOPIFY_STORE_DOMAIN = "ggh8q9-v1.myshopify.com";
});

describe("normalizeStorage", () => {
  it("maps every spelling of 256 to the same key", () => {
    expect(normalizeStorage("256 GB")).toBe("256GB");
    expect(normalizeStorage("256GB")).toBe("256GB");
    expect(normalizeStorage("256 gb")).toBe("256GB");
    expect(normalizeStorage(" 256gb ")).toBe("256GB");
    expect(normalizeStorage(256)).toBe("256GB");
  });

  it("keeps the TB unit instead of collapsing it to GB", () => {
    expect(normalizeStorage("1 TB")).toBe("1TB");
    expect(normalizeStorage("1tb")).toBe("1TB");
  });

  it("returns empty for unusable values instead of inventing one", () => {
    expect(normalizeStorage("")).toBe("");
    expect(normalizeStorage(undefined)).toBe("");
    expect(normalizeStorage("weet ik veel")).toBe("");
  });
});

describe("normalizeIdentity", () => {
  it("produces an identical key no matter the input spacing/case", () => {
    const a = normalizeIdentity({ productType: " iPhone ", model: "iPhone  15 Pro", storage: "256 gb" });
    const b = normalizeIdentity({ productType: "iPhone", model: "iPhone 15 Pro", storage: "256GB" });
    expect(a).toEqual(b);
  });
});

describe("extractProductIdentity consistency", () => {
  it("gives the same storage as normalizeStorage for title-derived values", () => {
    const fromTitle = extractProductIdentity(makeProduct({ title: "iPhone 15 Pro 512GB" }));
    expect(fromTitle.storage).toBe(normalizeStorage("512 GB"));
  });
});

describe("product URL", () => {
  it("uses the Shopify handle, never a title slug", () => {
    const url = getProductUrl(makeProduct({ handle: "iphone-15-pro-256gb", title: "iPhone 15 Pro 256GB Zwart" }));
    expect(url).toBe("https://ggh8q9-v1.myshopify.com/products/iphone-15-pro-256gb");
  });

  it("prefers SHOPIFY_STOREFRONT_URL over the myshopify domain", () => {
    process.env.SHOPIFY_STOREFRONT_URL = "https://iselectstore.nl/";
    expect(getStorefrontBase()).toBe("https://iselectstore.nl");
    expect(getProductUrl(makeProduct())).toBe("https://iselectstore.nl/products/iphone-15-pro-256gb");
  });

  it("falls back to a title slug only when no handle exists", () => {
    const url = getProductUrl(makeProduct({ handle: undefined, title: "iPhone 15 Pro 256GB Zwart" }));
    expect(url).toBe("https://ggh8q9-v1.myshopify.com/products/iphone-15-pro-256gb-zwart");
  });

  it("returns empty (never a broken link) when no storefront origin is configured", () => {
    process.env.SHOPIFY_STORE_DOMAIN = "";
    process.env.SHOPIFY_STOREFRONT_URL = "";
    expect(getProductUrl(makeProduct())).toBe("");
  });
});

describe("buildEmailHtml", () => {
  it("does not repeat the storage token after the title", () => {
    const identity = { productType: "iPhone", model: "iPhone 15 Pro", storage: "256GB" };
    const { subject, html, text } = buildEmailHtml({
      product: makeProduct(),
      identity,
      productUrl: "https://iselectstore.nl/products/iphone-15-pro-256gb",
    });
    expect(subject).toBe("Je iPhone 15 Pro 256GB is weer op voorraad");
    expect(subject).not.toContain("256GB 256GB");
    expect(html).toContain("iPhone 15 Pro 256GB");
    expect(html).not.toContain("256GB 256GB");
    expect(html).toContain('href="https://iselectstore.nl/products/iphone-15-pro-256gb"');
    expect(text).toContain("https://iselectstore.nl/products/iphone-15-pro-256gb");
  });

  it("escapes HTML in the product title", () => {
    const identity = { productType: "iPhone", model: '<script>alert(1)</script>', storage: "" };
    const { html } = buildEmailHtml({
      product: makeProduct({ title: '<img src=x onerror=alert(1)>' }),
      identity,
      productUrl: "https://iselectstore.nl/products/x",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("checkProductObjectAndNotify", () => {
  it("sends exactly one mail and marks the subscription notified", async () => {
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results).toHaveLength(1);
    expect(results[0].sent).toBe(true);
    expect(providerMock.send).toHaveBeenCalledTimes(1);
    expect(subscriptionService.claimForNotification).toHaveBeenCalledWith(77);
    expect(historyService.recordSentNotification).toHaveBeenCalledTimes(1);
    expect(subscriptionService.markNotified).toHaveBeenCalledWith(77, "4242");
    expect(subscriptionService.releaseNotificationClaim).not.toHaveBeenCalled();
  });

  it("never sends when the product has no tracked stock", async () => {
    const results = await checkProductObjectAndNotify(
      makeProduct({ variants: [{ id: 1, price: "9.00", compare_at_price: null, inventory_quantity: 0, inventory_management: "shopify" }] })
    );
    expect(results).toEqual([]);
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("never sends when the identity is incomplete", async () => {
    const results = await checkProductObjectAndNotify(makeProduct({ product_type: "" }));
    expect(results).toEqual([]);
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("skips when another run already sent this notification", async () => {
    historyService.hasNotificationBeenSent.mockResolvedValue(true);
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(results[0].skipped).toBe("already_sent");
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("skips when another run holds the lease (webhook vs cron race)", async () => {
    subscriptionService.claimForNotification.mockResolvedValue(false);
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(results[0].skipped).toBe("claimed_elsewhere");
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("releases the lease and writes no history when the provider fails", async () => {
    providerMock.send.mockResolvedValue({ ok: false, provider: "mock", error: "429 rate limited" });
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(results[0].error).toContain("rate limited");
    expect(subscriptionService.releaseNotificationClaim).toHaveBeenCalledWith(77);
    expect(historyService.recordSentNotification).not.toHaveBeenCalled();
    expect(subscriptionService.markNotified).not.toHaveBeenCalled();
  });

  it("releases the lease when the provider throws", async () => {
    providerMock.send.mockRejectedValue(new Error("network down"));
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(subscriptionService.releaseNotificationClaim).toHaveBeenCalledWith(77);
    expect(historyService.recordSentNotification).not.toHaveBeenCalled();
  });

  it("does not mark notified when the unique history insert loses the race", async () => {
    historyService.recordSentNotification.mockResolvedValue(false);
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(subscriptionService.markNotified).not.toHaveBeenCalled();
  });

  it("refuses to send when no storefront origin is configured", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "";
    process.env.SHOPIFY_STOREFRONT_URL = "";
    const results = await checkProductObjectAndNotify(makeProduct());
    expect(results[0].sent).toBe(false);
    expect(results[0].skipped).toBe("no_link");
    expect(providerMock.send).not.toHaveBeenCalled();
  });
});
