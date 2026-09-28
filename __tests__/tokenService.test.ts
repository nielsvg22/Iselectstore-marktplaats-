import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const originalFetch = global.fetch;

describe("getShopifyAccessToken", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret";
    delete process.env.SHOPIFY_APP_CLIENT_ID;
    delete process.env.SHOPIFY_APP_CLIENT_SECRET;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reuses a still-valid token from the database without refreshing", async () => {
    queryMock.mockResolvedValueOnce([
      { access_token: "shpat_existing", expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    ]);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getShopifyAccessToken } = await import("../lib/shopify/tokenService");
    const token = await getShopifyAccessToken();

    expect(token).toBe("shpat_existing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes via client_credentials when the stored token is expired", async () => {
    queryMock
      .mockResolvedValueOnce([{ access_token: "shpat_old", expires_at: new Date(Date.now() - 1000).toISOString() }])
      .mockResolvedValueOnce([]); // the UPDATE/INSERT call

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "shpat_fresh", expires_in: 86400 }),
    }) as unknown as typeof fetch;

    const { getShopifyAccessToken } = await import("../lib/shopify/tokenService");
    const token = await getShopifyAccessToken();

    expect(token).toBe("shpat_fresh");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://test-shop.myshopify.com/admin/oauth/access_token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("refreshes when no token row exists yet", async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "shpat_new", expires_in: 86400 }),
    }) as unknown as typeof fetch;

    const { getShopifyAccessToken } = await import("../lib/shopify/tokenService");
    const token = await getShopifyAccessToken();

    expect(token).toBe("shpat_new");
  });

  it("throws a clear error when Shopify rejects the refresh", async () => {
    queryMock.mockResolvedValueOnce([]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_client"}',
    }) as unknown as typeof fetch;

    const { getShopifyAccessToken } = await import("../lib/shopify/tokenService");
    await expect(getShopifyAccessToken()).rejects.toThrow(/Shopify token refresh failed \(401\)/);
  });
});
