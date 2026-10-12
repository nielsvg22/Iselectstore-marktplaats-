import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { goedgeplaatstRequest, GoedgeplaatstApiError, GoedgeplaatstConfigError } from "@/lib/goedgeplaatst/client";
import { ForbiddenEndpointError } from "@/lib/goedgeplaatst/config";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, GOEDGEPLAATST_API_KEY: "test-key", GOEDGEPLAATST_USER_ID: "123", GOEDGEPLAATST_ENVIRONMENT: "sandbox" };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GoedGeplaatst REST client", () => {
  it("weigert elke aanroep zonder API-sleutel (mock-modus moet via service.ts, niet hier)", async () => {
    delete process.env.GOEDGEPLAATST_API_KEY;
    await expect(goedgeplaatstRequest("GET", "ads/")).rejects.toThrow(GoedgeplaatstConfigError);
  });

  it("stuurt de Authentication-header (niet Authorization) en nooit de sleutel in een foutmelding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: true, errors: [], data: [{ adId: 1 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await goedgeplaatstRequest("GET", "ads/");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authentication).toBe("test-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("gebruikt data uit de envelope bij result:true", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ result: true, errors: [], data: { adId: 42 } })) as unknown as typeof fetch;
    const data = await goedgeplaatstRequest<{ adId: number }>("GET", "ads/?adId=42");
    expect(data.adId).toBe(42);
  });

  it("gooit een GoedgeplaatstApiError bij result:false, ook met HTTP 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ result: false, errors: [{ field: "title", message: "te kort" }], data: null }, 200)
    ) as unknown as typeof fetch;
    await expect(goedgeplaatstRequest("POST", "ads/", {})).rejects.toThrow(GoedgeplaatstApiError);
  });

  it("blokkeert publish-paden al voordat er een fetch gedaan wordt", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(goedgeplaatstRequest("POST", "publish/", {})).rejects.toThrow(ForbiddenEndpointError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probeert het opnieuw bij HTTP 429 en slaagt daarna", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ result: true, errors: [], data: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const data = await goedgeplaatstRequest("GET", "ads/");
    expect(data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("geeft op na de maximale retries bij aanhoudende 429's", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(goedgeplaatstRequest("GET", "ads/")).rejects.toThrow(GoedgeplaatstApiError);
  });
});
