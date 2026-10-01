import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression test for a real production bug (digest 327334863): Shopify
// removed numbered (?page=N) REST pagination entirely — it now responds
// 400 "page cannot be passed". listProducts() must use cursor-based
// page_info (from the Link response header) instead.

vi.mock("../lib/shopify/tokenService", () => ({ getShopifyAccessToken: vi.fn().mockResolvedValue("shpat_test") }));

const originalFetch = global.fetch;

function jsonResponse(body: unknown, linkHeader?: string) {
  return {
    ok: true,
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === "link" ? (linkHeader ?? null) : null) },
  };
}

describe("listProducts", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_API_VERSION = "2024-10";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("never sends a page= query param", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ products: [{ id: 1 }] }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { listProducts } = await import("../lib/shopify/client");
    await listProducts(10);

    for (const call of fetchSpy.mock.calls) {
      const url = call[0] as string;
      expect(url).not.toMatch(/[?&]page=\d/);
    }
  });

  it("follows the Link header's page_info cursor when more than one page (250) is needed", async () => {
    // pageSize caps at 250, so a limit above that forces a second fetch — the
    // one path that actually exercises cursor-following.
    const page1 = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: 251 }, { id: 252 }];

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ products: page1 }, '<https://test-shop.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=ABC123>; rel="next"')
      )
      .mockResolvedValueOnce(jsonResponse({ products: page2 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { listProducts } = await import("../lib/shopify/client");
    const products = await listProducts(252);

    expect(products).toHaveLength(252);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("page_info=ABC123");
    expect(secondCallUrl).not.toMatch(/[?&]page=\d/);
  });

  it("stops when a page comes back shorter than the page size (no more results)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ products: [{ id: 1 }] }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { listProducts } = await import("../lib/shopify/client");
    const products = await listProducts(50);

    expect(products).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
