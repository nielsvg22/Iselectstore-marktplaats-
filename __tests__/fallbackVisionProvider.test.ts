import { describe, it, expect, vi } from "vitest";
import { FallbackVisionProvider } from "../lib/ai/fallbackVisionProvider";
import type { VisionAnalysisResult, VisionProvider } from "../lib/ai/types";

const baseInput = {
  productType: "iPhone" as const,
  allowedFieldKeys: ["battery_percentage"],
  fieldLabels: { battery_percentage: "Batterijconditie (%)" },
  images: [{ dataUrl: "data:image/jpeg;base64,AAAA", filename: "photo.jpg" }],
};

const okResult: VisionAnalysisResult = { fields: { battery_percentage: { value: "94%", confidence: 0.98 } }, warnings: [] };

describe("FallbackVisionProvider", () => {
  it("returns the first provider's result when it succeeds", async () => {
    const first: VisionProvider = { analyzeImage: vi.fn().mockResolvedValue(okResult) };
    const second: VisionProvider = { analyzeImage: vi.fn() };
    const provider = new FallbackVisionProvider([first, second]);

    const result = await provider.analyzeImage(baseInput);

    expect(result).toEqual(okResult);
    expect(second.analyzeImage).not.toHaveBeenCalled();
  });

  it("tries the next provider when the first throws", async () => {
    const first: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("503 overloaded")) };
    const second: VisionProvider = { analyzeImage: vi.fn().mockResolvedValue(okResult) };
    const provider = new FallbackVisionProvider([first, second]);

    const result = await provider.analyzeImage(baseInput);

    expect(result).toEqual(okResult);
    expect(second.analyzeImage).toHaveBeenCalledWith(baseInput);
  });

  it("walks a three-provider chain (Gemini -> Groq -> OpenRouter) until one succeeds", async () => {
    const gemini: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("429 rate_limit")) };
    const groq: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("503 high demand")) };
    const openrouter: VisionProvider = { analyzeImage: vi.fn().mockResolvedValue(okResult) };
    const provider = new FallbackVisionProvider([gemini, groq, openrouter]);

    const result = await provider.analyzeImage(baseInput);

    expect(result).toEqual(okResult);
    expect(gemini.analyzeImage).toHaveBeenCalledTimes(1);
    expect(groq.analyzeImage).toHaveBeenCalledTimes(1);
    expect(openrouter.analyzeImage).toHaveBeenCalledTimes(1);
  });

  it("throws the last provider's error when every provider fails", async () => {
    const first: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("first down")) };
    const lastErr = new Error("last down too");
    const last: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(lastErr) };
    const provider = new FallbackVisionProvider([first, last]);

    await expect(provider.analyzeImage(baseInput)).rejects.toThrow("last down too");
  });

  it("requires at least one provider", () => {
    expect(() => new FallbackVisionProvider([])).toThrow();
  });
});
