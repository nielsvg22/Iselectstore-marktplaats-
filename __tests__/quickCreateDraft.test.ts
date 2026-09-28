import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

import { getQuickCreateDraft, saveQuickCreateDraft } from "@/services/shopify/quickCreateDraftService";
import { POST, GET, OPTIONS } from "@/app/api/shopify/quick-create/draft/route";

const SECRET = "draft-test-secret";
const CLIENT_ID = "draft-test-client-id";
const DEST = "https://ggh8q9-v1.myshopify.com";

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function makeToken(overrides: Record<string, unknown> = {}): string {
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
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

beforeAll(() => {
  process.env.SHOPIFY_APP_CLIENT_SECRET = SECRET;
  process.env.SHOPIFY_APP_CLIENT_ID = CLIENT_ID;
  process.env.SHOPIFY_STORE_DOMAIN = "ggh8q9-v1.myshopify.com";
});

beforeEach(() => {
  queryMock.mockReset();
});

describe("quickCreateDraftService", () => {
  it("saves a draft with an upsert", async () => {
    queryMock.mockResolvedValueOnce([]);
    await saveQuickCreateDraft("draft-1", "iPhone", { model: "iPhone 14" }, [{ dataUrl: "data:image/jpeg;base64,AA", filename: "a.jpg" }]);

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (draft_id) DO UPDATE"),
      ["draft-1", "iPhone", JSON.stringify({ model: "iPhone 14" }), JSON.stringify([{ dataUrl: "data:image/jpeg;base64,AA", filename: "a.jpg" }])]
    );
  });

  it("returns null when no draft row exists", async () => {
    queryMock.mockResolvedValueOnce([]);
    const draft = await getQuickCreateDraft("missing");
    expect(draft).toBeNull();
  });

  it("returns the draft when a fresh row exists", async () => {
    queryMock.mockResolvedValueOnce([
      {
        draft_id: "draft-1",
        product_type: "iPhone",
        values: { model: "iPhone 14" },
        images: [],
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const draft = await getQuickCreateDraft("draft-1");
    expect(draft).toEqual({
      draftId: "draft-1",
      productType: "iPhone",
      values: { model: "iPhone 14" },
      images: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("quick-create draft route", () => {
  it("OPTIONS returns CORS preflight", async () => {
    const req = new Request("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft", {
      headers: { Origin: "https://admin.shopify.com" },
    });
    const res = await OPTIONS(req as never);
    expect(res.status).toBe(204);
  });

  it("POST rejects a body missing required fields", async () => {
    const req = new Request("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: "d1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("POST saves a valid draft", async () => {
    queryMock.mockResolvedValueOnce([]);
    const req = new Request("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: "d1", productType: "iPhone", values: { model: "iPhone 14" }, images: [] }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalled();
  });

  it("GET rejects requests without a valid Shopify id-token", async () => {
    const req = new NextRequest(
      "https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft?draftId=d1",
      { headers: { Origin: "https://admin.shopify.com" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("GET returns the draft for an authenticated request", async () => {
    queryMock.mockResolvedValueOnce([
      { draft_id: "d1", product_type: "iPhone", values: { model: "iPhone 14" }, images: [], updated_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const token = makeToken();
    const req = new NextRequest(
      "https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft?draftId=d1",
      { headers: { Origin: "https://admin.shopify.com", Authorization: `Bearer ${token}` } }
    );
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.draft.productType).toBe("iPhone");
  });

  it("GET returns null draft when none was saved yet", async () => {
    queryMock.mockResolvedValueOnce([]);
    const token = makeToken();
    const req = new NextRequest(
      "https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-create/draft?draftId=missing",
      { headers: { Origin: "https://admin.shopify.com", Authorization: `Bearer ${token}` } }
    );
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.draft).toBeNull();
  });
});
