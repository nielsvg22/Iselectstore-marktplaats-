import { describe, it, expect, vi } from "vitest";
import { FallbackVisionProvider } from "../lib/ai/fallbackVisionProvider";
import type { VisionAnalysisResult, VisionProvider } from "../lib/ai/types";

const baseInput = {
  productType: "iPhone" as const,
  allowedFieldKeys: ["battery_percentage"],
  fieldLabels: { battery_percentage: "Batterijconditie (%)" },
  images: [{ dataUrl: "data:image/jpeg;base64,AAAA", filename: "photo.jpg" }] as [{ dataUrl: string; filename: string }],
};

const okResult: VisionAnalysisResult = { fields: { battery_percentage: { value: "94%", confidence: 0.98 } }, warnings: [] };

describe("FallbackVisionProvider", () => {
  it("returns the primary provider's result when it succeeds", async () => {
    const primary: VisionProvider = { analyzeImage: vi.fn().mockResolvedValue(okResult) };
    const fallback: VisionProvider = { analyzeImage: vi.fn() };
    const provider = new FallbackVisionProvider(primary, fallback);

    const result = await provider.analyzeImage(baseInput);

    expect(result).toEqual(okResult);
    expect(fallback.analyzeImage).not.toHaveBeenCalled();
  });

  it("retries with the fallback provider when the primary throws", async () => {
    const primary: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("503 overloaded")) };
    const fallback: VisionProvider = { analyzeImage: vi.fn().mockResolvedValue(okResult) };
    const provider = new FallbackVisionProvider(primary, fallback);

    const result = await provider.analyzeImage(baseInput);

    expect(result).toEqual(okResult);
    expect(fallback.analyzeImage).toHaveBeenCalledWith(baseInput);
  });

  it("throws the fallback's error when both providers fail", async () => {
    const primary: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(new Error("primary down")) };
    const fallbackErr = new Error("fallback down too");
    const fallback: VisionProvider = { analyzeImage: vi.fn().mockRejectedValue(fallbackErr) };
    const provider = new FallbackVisionProvider(primary, fallback);

    await expect(provider.analyzeImage(baseInput)).rejects.toThrow("fallback down too");
  });
});
