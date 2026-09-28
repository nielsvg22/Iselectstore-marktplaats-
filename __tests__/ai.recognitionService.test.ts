import { describe, it, expect, vi } from "vitest";
import { ProductImageRecognitionService, MAX_IMAGES_PER_ANALYSIS } from "../lib/ai/productImageRecognitionService";
import type { VisionAnalysisInput, VisionAnalysisResult, VisionProvider, ImageInput } from "../lib/ai/types";

function fakeImage(tag: string): ImageInput {
  return { dataUrl: `data:image/png;base64,${tag}`, filename: `${tag}.png` };
}

// Scripts a single combined result keyed by the filename of the FIRST image —
// matches the new one-call-per-analysis behavior (all photos sent together).
class ScriptedProvider implements VisionProvider {
  constructor(private script: Record<string, VisionAnalysisResult>) {}
  async analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    const tag = input.images[0].filename?.replace(".png", "") ?? "";
    return this.script[tag] ?? { fields: {}, warnings: [] };
  }
}

describe("ProductImageRecognitionService", () => {
  it("recognizes iPhone battery health from a battery screenshot", async () => {
    const provider = new ScriptedProvider({
      battery: { fields: { battery_percentage: { value: "94%", confidence: 0.99 } }, warnings: [] },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "iPhone", images: [fakeImage("battery")] });

    const field = result.fields.find((f) => f.key === "battery_percentage");
    expect(field).toBeDefined();
    expect(field?.value).toBe(94);
    expect(field?.level).toBe("HIGH");
  });

  it("recognizes model and storage from an iPhone info screenshot", async () => {
    const provider = new ScriptedProvider({
      info: {
        fields: {
          model: { value: "iPhone 15 Pro", confidence: 0.98 },
          storage_gb: { value: "256 GB", confidence: 0.86 },
        },
        warnings: [],
      },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "iPhone", images: [fakeImage("info")] });

    expect(result.fields.find((f) => f.key === "model")?.value).toBe("iPhone 15 Pro");
    expect(result.fields.find((f) => f.key === "storage_gb")?.value).toBe("256GB");
    expect(result.fields.find((f) => f.key === "storage_gb")?.level).toBe("MEDIUM");
  });

  it("recognizes model, chip and ram from a MacBook 'Over deze Mac' screenshot", async () => {
    const provider = new ScriptedProvider({
      aboutthismac: {
        fields: {
          model: { value: "MacBook Pro 14", confidence: 0.97 },
          chip: { value: "M3 Pro", confidence: 0.99 },
          ram_gb: { value: "18 GB", confidence: 0.98 },
        },
        warnings: [],
      },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "MacBook", images: [fakeImage("aboutthismac")] });

    expect(result.fields.find((f) => f.key === "chip")?.value).toBe("Apple M3 Pro");
    expect(result.fields.find((f) => f.key === "ram_gb")?.value).toBe("18GB");
  });

  it("recognizes battery health and cycle count from a MacBook battery screenshot", async () => {
    const provider = new ScriptedProvider({
      macbattery: {
        fields: {
          battery_percentage: { value: "93%", confidence: 0.89 },
          cycle_count: { value: "87", confidence: 0.95 },
        },
        warnings: [],
      },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "MacBook", images: [fakeImage("macbattery")] });

    expect(result.fields.find((f) => f.key === "battery_percentage")?.value).toBe(93);
    expect(result.fields.find((f) => f.key === "cycle_count")?.value).toBe(87);
  });

  it("recognizes storage from a MacBook storage overview screenshot", async () => {
    const provider = new ScriptedProvider({
      macstorage: { fields: { storage_gb: { value: "512GB SSD", confidence: 0.91 } }, warnings: [] },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "MacBook", images: [fakeImage("macstorage")] });

    expect(result.fields.find((f) => f.key === "storage_gb")?.value).toBe("512GB");
  });

  it("only returns fields allowed for the given product type", async () => {
    // Provider tries to sneak in a field that isn't on the Apple Watch allow-list.
    const provider = new ScriptedProvider({
      watch: {
        fields: {
          watch_series: { value: "Series 9", confidence: 0.95 },
          ram_gb: { value: "18GB", confidence: 0.9 },
        },
        warnings: [],
      },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "Apple Watch", images: [fakeImage("watch")] });

    expect(result.fields.map((f) => f.key)).not.toContain("ram_gb");
  });

  it("never fabricates a value: omits fields the provider marks null or low-confidence", async () => {
    const provider = new ScriptedProvider({
      unclear: {
        fields: {
          storage_gb: { value: null, confidence: 0.2 },
          color: { value: "Zwart", confidence: 0.1 },
        },
        warnings: [],
      },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "iPhone", images: [fakeImage("unclear")] });

    expect(result.fields).toHaveLength(0);
    expect(result.omittedFields.map((o) => o.key)).toEqual(expect.arrayContaining(["storage_gb", "color"]));
  });

  it("sends all photos of the same product to the provider in a single combined call", async () => {
    const analyzeImage = vi.fn().mockResolvedValue({
      fields: { storage_gb: { value: "512 GB", confidence: 0.92 } },
      warnings: [],
    });
    const provider: VisionProvider = { analyzeImage };
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({ productType: "iPhone", images: [fakeImage("photo1"), fakeImage("photo2")] });

    expect(analyzeImage).toHaveBeenCalledTimes(1);
    expect(analyzeImage.mock.calls[0][0].images).toHaveLength(2);
    expect(result.fields.find((f) => f.key === "storage_gb")?.value).toBe("512GB");
  });

  it("caps a request at the maximum number of images and warns about the rest", async () => {
    const analyzeImage = vi.fn().mockResolvedValue({ fields: {}, warnings: [] });
    const provider: VisionProvider = { analyzeImage };
    const service = new ProductImageRecognitionService(provider);
    const images = Array.from({ length: MAX_IMAGES_PER_ANALYSIS + 2 }, (_, i) => fakeImage(`photo${i}`));

    const result = await service.recognize({ productType: "iPhone", images });

    expect(analyzeImage.mock.calls[0][0].images).toHaveLength(MAX_IMAGES_PER_ANALYSIS);
    expect(result.warnings.some((w) => w.includes(String(MAX_IMAGES_PER_ANALYSIS)))).toBe(true);
  });

  it("marks a field as differing from the existing Shopify value without overwriting it", async () => {
    const provider = new ScriptedProvider({
      ram: { fields: { ram_gb: { value: "18GB", confidence: 0.98 } }, warnings: [] },
    });
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({
      productType: "MacBook",
      images: [fakeImage("ram")],
      existingValues: { ram_gb: "16GB" },
    });

    const field = result.fields.find((f) => f.key === "ram_gb");
    expect(field?.differsFromExisting).toBe(true);
    expect(field?.existingValue).toBe("16GB");
    expect(field?.value).toBe("18GB");
  });
});
