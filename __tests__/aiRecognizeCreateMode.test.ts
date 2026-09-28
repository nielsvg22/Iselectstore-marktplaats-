// Herkenning voor een nóg niet bestaand product (create-mode): dezelfde
// /api/ai/recognize-route, zonder productId en zonder Shopify-read.
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({ analyzeImage: vi.fn() }));

vi.mock("@/lib/ai/visionProviderFactory", () => ({
  createVisionProviderFromEnv: () => ({ analyzeImage: hoisted.analyzeImage }),
}));
vi.mock("@/lib/shopify/client", () => ({ getStructuredFields: vi.fn(async () => ({ model: "Oud model" })) }));
vi.mock("@/lib/logging", () => ({ logSync: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []) }));

import { POST } from "@/app/api/ai/recognize/route";
import { getStructuredFields } from "@/lib/shopify/client";
import { logSync } from "@/lib/logging";

const image = { dataUrl: "data:image/png;base64,AAAA", filename: "screenshot.png" };

async function call(body: unknown) {
  const res = await POST(
    new Request("https://iselectstore-marktplaats-app.vercel.app/api/ai/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.analyzeImage.mockResolvedValue({
    fields: {
      model: { value: "iPhone 15 Pro", confidence: 0.98 },
      storage_gb: { value: "256 GB", confidence: 0.86 },
      battery_percentage: { value: "94%", confidence: 0.99 },
    },
    warnings: [],
  });
});

describe("POST /api/ai/recognize — create-mode voor /admin/quick-create", () => {
  it("herkent velden zonder productId en leest geen bestaande waarden", async () => {
    const { res, json } = await call({ productType: "iPhone", images: [image], mode: "create" });
    expect(res.status).toBe(200);
    expect(json.result.productType).toBe("iPhone");
    const model = json.result.fields.find((f: { key: string }) => f.key === "model");
    expect(model.value).toBe("iPhone 15 Pro");
    expect(model.level).toBe("HIGH");
    const storage = json.result.fields.find((f: { key: string }) => f.key === "storage_gb");
    expect(storage.value).toBe("256GB");
    expect(storage.level).toBe("MEDIUM");
    expect(getStructuredFields).not.toHaveBeenCalled();
    const logged = vi.mocked(logSync).mock.calls[0][0];
    expect(logged.shopifyProductId).toBeUndefined();
    expect(logged.message).toContain("mode=create");
  });

  it("leest in edit-mode wél de bestaande waarden van het product", async () => {
    const { res } = await call({ productType: "iPhone", images: [image], productId: "166000001" });
    expect(res.status).toBe(200);
    expect(getStructuredFields).toHaveBeenCalledWith("166000001");
    const logged = vi.mocked(logSync).mock.calls[0][0];
    expect(logged.message).toContain("mode=edit");
  });

  it("leest in testmodus geen bestaande waarden", async () => {
    const { res } = await call({
      productType: "iPhone",
      images: [image],
      productId: "166000001",
      testMode: true,
    });
    expect(res.status).toBe(200);
    expect(getStructuredFields).not.toHaveBeenCalled();
  });

  it("weigert een onbekend producttype", async () => {
    const { res, json } = await call({ productType: "Toaster", images: [image], mode: "create" });
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
    expect(hoisted.analyzeImage).not.toHaveBeenCalled();
  });

  it("weigert een niet-afbeelding", async () => {
    const { res } = await call({ productType: "iPhone", images: [{ dataUrl: "nope", filename: "x" }], mode: "create" });
    expect(res.status).toBe(400);
    expect(hoisted.analyzeImage).not.toHaveBeenCalled();
  });
});
