import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { applySoldOverlay } from "../lib/soldImage/overlay";
import { SoldImageSettings } from "../lib/soldImage/types";

const settings: SoldImageSettings = {
  mode: "auto",
  delayHours: 0,
  stickerText: "VERKOCHT",
  position: "center",
  sizePercent: 60,
  opacity: 0.85,
  bandColorHex: "#dc2626",
  textColorHex: "#ffffff",
};

async function samplePng(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .png()
    .toBuffer();
}

describe("applySoldOverlay", () => {
  it("returns a valid JPEG with the original image's dimensions", async () => {
    const input = await samplePng(400, 300);
    const output = await applySoldOverlay(input, settings);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it("changes the pixels compared to the original (something was actually drawn)", async () => {
    const input = await samplePng(400, 300);
    const output = await applySoldOverlay(input, settings);
    expect(output.equals(input)).toBe(false);
  });

  it("works for every supported position without throwing", async () => {
    const input = await samplePng(400, 300);
    const positions: SoldImageSettings["position"][] = ["center", "top-left", "top-right", "bottom-left", "bottom-right"];
    for (const position of positions) {
      await expect(applySoldOverlay(input, { ...settings, position })).resolves.toBeInstanceOf(Buffer);
    }
  });

  it("respects a custom sticker text", async () => {
    const input = await samplePng(400, 300);
    const a = await applySoldOverlay(input, { ...settings, stickerText: "VERKOCHT" });
    const b = await applySoldOverlay(input, { ...settings, stickerText: "GERESERVEERD" });
    expect(a.equals(b)).toBe(false);
  });
});
