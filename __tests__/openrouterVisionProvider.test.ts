import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenRouterVisionProvider } from "../lib/ai/openrouterVisionProvider";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const baseInput = {
  productType: "iPhone" as const,
  allowedFieldKeys: ["battery_percentage", "storage_gb"],
  fieldLabels: { battery_percentage: "Batterijconditie (%)", storage_gb: "Opslag (GB)" },
  images: [
    { dataUrl: "data:image/jpeg;base64,AAAA", filename: "photo1.jpg" },
    { dataUrl: "data:image/jpeg;base64,BBBB", filename: "photo2.jpg" },
  ],
};

describe("OpenRouterVisionProvider", () => {
  it("sends every image in one chat-completions call with a JSON response format", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ battery_percentage: { value: "94%", confidence: 0.95 }, warnings: [] }) } }],
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const provider = new OpenRouterVisionProvider("test-key", "some/free-vision-model:free");
    const result = await provider.analyzeImage(baseInput);

    expect(fetchSpy).toHaveBeenCalledWith("https://openrouter.ai/api/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    const call = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((call.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(call.body as string);
    expect(body.model).toBe("some/free-vision-model:free");
    const imageParts = body.messages[0].content.filter((p: { type: string }) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    expect(imageParts[0].image_url.url).toBe("data:image/jpeg;base64,AAAA");
    expect(result.fields.battery_percentage).toEqual({ value: "94%", confidence: 0.95 });
  });

  it("strips a markdown code fence some free models wrap the JSON in", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"battery_percentage": {"value": "80%", "confidence": 0.8}, "warnings": []}\n```' } }],
      }),
    }) as unknown as typeof fetch;

    const provider = new OpenRouterVisionProvider("test-key");
    const result = await provider.analyzeImage(baseInput);

    expect(result.fields.battery_percentage).toEqual({ value: "80%", confidence: 0.8 });
  });

  it("only returns fields on the allow-list", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ battery_percentage: { value: "94%", confidence: 0.98 }, model: { value: "iPhone 15", confidence: 0.9 }, warnings: [] }),
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const provider = new OpenRouterVisionProvider("test-key");
    const result = await provider.analyzeImage(baseInput);

    expect(result.fields.battery_percentage).toBeDefined();
    expect((result.fields as Record<string, unknown>).model).toBeUndefined();
  });

  it("throws a clear error on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '{"error":"rate limited"}',
    }) as unknown as typeof fetch;

    const provider = new OpenRouterVisionProvider("test-key");
    await expect(provider.analyzeImage(baseInput)).rejects.toThrow(/OpenRouter Vision-aanroep mislukt \(429\)/);
  });

  it("throws when the response has no message content", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    }) as unknown as typeof fetch;

    const provider = new OpenRouterVisionProvider("test-key");
    await expect(provider.analyzeImage(baseInput)).rejects.toThrow(/geen structured output/);
  });
});
