import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { applySoldOverlay } from "../lib/soldImage/overlay";
import { SoldImageSettings } from "../lib/soldImage/types";

const settings: SoldImageSettings = {
  mode: "auto",
  delayHours: 0,
  stickerText: "VERKOCHT",
  position: "center",
  style: "pill",
  sizePercent: 60,
  opacity: 0.85,
  bandColorHex: "#dc2626",
  textColorHex: "#ffffff",
};

function samplePng(width = 400, height = 300): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

describe("applySoldOverlay", () => {
  it("returns a valid JPEG with the original image's dimensions", async () => {
    const input = samplePng(400, 300);
    const output = await applySoldOverlay(input, settings);
    const decoded = await import("@napi-rs/canvas").then((m) => m.loadImage(output));

    expect(decoded.width).toBe(400);
    expect(decoded.height).toBe(300);
  });

  it("changes the pixels compared to the original (something was actually drawn)", async () => {
    const input = samplePng(400, 300);
    const output = await applySoldOverlay(input, settings);
    expect(output.equals(input)).toBe(false);
  });

  it("works for every supported position without throwing", async () => {
    const input = samplePng(400, 300);
    const positions: SoldImageSettings["position"][] = ["center", "top-left", "top-right", "bottom-left", "bottom-right"];
    for (const position of positions) {
      await expect(applySoldOverlay(input, { ...settings, position })).resolves.toBeInstanceOf(Buffer);
    }
  });

  it("works for both corner styles (pill and ribbon) without throwing", async () => {
    const input = samplePng(400, 300);
    for (const style of ["pill", "ribbon"] as const) {
      await expect(applySoldOverlay(input, { ...settings, position: "top-left", style })).resolves.toBeInstanceOf(Buffer);
    }
  });

  it("renders a visibly different result for the pill style vs. the ribbon style", async () => {
    const input = samplePng(400, 300);
    const pill = await applySoldOverlay(input, { ...settings, position: "top-left", style: "pill" });
    const ribbon = await applySoldOverlay(input, { ...settings, position: "top-left", style: "ribbon" });
    expect(pill.equals(ribbon)).toBe(false);
  });

  it("respects a custom sticker text", async () => {
    const input = samplePng(400, 300);
    const a = await applySoldOverlay(input, { ...settings, stickerText: "VERKOCHT" });
    const b = await applySoldOverlay(input, { ...settings, stickerText: "GERESERVEERD" });
    expect(a.equals(b)).toBe(false);
  });
});
