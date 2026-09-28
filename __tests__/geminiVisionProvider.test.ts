import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiVisionProvider } from "../lib/ai/geminiVisionProvider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const baseInput = {
  productType: "iPhone" as const,
  allowedFieldKeys: ["battery_percentage", "storage_gb"],
  fieldLabels: { battery_percentage: "Batterijconditie (%)", storage_gb: "Opslag (GB)" },
  images: [{ dataUrl: "data:image/jpeg;base64,AAAA", filename: "photo.jpg" }] as [{ dataUrl: string; filename: string }],
};

describe("GeminiVisionProvider", () => {
  it("calls the generateContent endpoint with the model, key and inline image data", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ battery_percentage: { value: "94%", confidence: 0.98 }, warnings: [] }) }] } }],
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new GeminiVisionProvider("test-key", "gemini-3.8-flash");
    const result = await provider.analyzeImage(baseInput);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=test-key",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/jpeg", data: "AAAA" });
    expect(result.fields.battery_percentage).toEqual({ value: "94%", confidence: 0.98 });
  });

  it("only returns fields on the allow-list, ignoring anything else in the response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ battery_percentage: { value: "94%", confidence: 0.98 }, model: { value: "iPhone 15", confidence: 0.9 }, warnings: [] }) }],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const provider = new GeminiVisionProvider("test-key");
    const result = await provider.analyzeImage(baseInput);

    expect(result.fields.battery_percentage).toBeDefined();
    expect((result.fields as Record<string, unknown>).model).toBeUndefined();
  });

  it("throws a clear error on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '{"error":{"message":"overloaded"}}',
    }) as unknown as typeof fetch;

    const provider = new GeminiVisionProvider("test-key");
    await expect(provider.analyzeImage(baseInput)).rejects.toThrow(/Gemini Vision-aanroep mislukt \(503\)/);
  });

  it("throws when the response has no candidates text", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    }) as unknown as typeof fetch;

    const provider = new GeminiVisionProvider("test-key");
    await expect(provider.analyzeImage(baseInput)).rejects.toThrow(/geen structured output/);
  });

  it("throws on a data URL without a base64 payload", async () => {
    const provider = new GeminiVisionProvider("test-key");
    await expect(
      provider.analyzeImage({ ...baseInput, images: [{ dataUrl: "not-a-data-url", filename: "x.jpg" }] })
    ).rejects.toThrow(/Ongeldige afbeelding/);
  });
});
