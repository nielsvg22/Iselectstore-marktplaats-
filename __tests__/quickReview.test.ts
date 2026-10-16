import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/auth/extensionRequest", () => ({ authenticateExtensionRequest: vi.fn() }));
vi.mock("@/lib/marktplaats/attributeCache", () => ({ getAttributesForProductType: vi.fn() }));
vi.mock("@/lib/marktplaats/mappingEngine", () => ({ mapProductToAttributes: vi.fn() }));
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { getAttributesForProductType } from "@/lib/marktplaats/attributeCache";
import { mapProductToAttributes } from "@/lib/marktplaats/mappingEngine";
import { POST } from "@/app/api/shopify/quick-review/route";
const values = { model: "iPhone 15 Pro", storage_gb: "256", color: "Zwart", condition: "Als nieuw", sell_price: "569" };
function request(body: unknown = { productType: "iPhone", values, imageCount: 2 }) { return new NextRequest("https://iselectstore-marktplaats-app.vercel.app/api/shopify/quick-review", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateExtensionRequest).mockReturnValue({ ok: true, claims: {} as never, headers: {} });
});
describe("Controle van nog niet aangemaakt product", () => {
  it("vereist Shopify-authenticatie en valideert templatevelden", async () => {
    expect((await POST(request({ productType: "iPhone", values: {} }))).status).toBe(400);
    expect(getAttributesForProductType).not.toHaveBeenCalled();
    vi.mocked(authenticateExtensionRequest).mockReturnValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
  });
  it("meldt ontbrekende verplichte categoriekenmerken en vermeldt testdata", async () => {
    vi.mocked(getAttributesForProductType).mockResolvedValue({ source: "mock", mapping: { l1CategoryId: "1", l2CategoryId: "2", l2CategoryName: "Telefoons" }, attributes: [{ key: "gpsr", labels: { nl: "Fabrikantadres" }, mandatory: true, writable: true }] } as never);
    vi.mocked(mapProductToAttributes).mockResolvedValue([]);
    const response = await POST(request());
    const data = await response.json();
    expect(data.source).toBe("mock");
    expect(data.missingMandatory).toEqual(["Fabrikantadres"]);
    expect(data.missingFields).toContain("Batterijconditie (%)");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("presenteert een niet beschikbare categoriecontrole nooit als geslaagd", async () => {
    vi.mocked(getAttributesForProductType).mockRejectedValue(new Error("private database detail"));
    const data = await (await POST(request())).json();
    expect(data.source).toBe("unavailable");
    expect(JSON.stringify(data)).not.toContain("private database detail");
  });
});
