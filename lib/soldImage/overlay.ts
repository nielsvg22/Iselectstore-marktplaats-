// Pure image transform: takes an image buffer + sticker settings, returns a
// new buffer with a "VERKOCHT" ribbon composited on top. Uses @napi-rs/canvas
// (bundled font, no system fontconfig needed) instead of SVG+sharp — Vercel's
// serverless runtime has no system fonts, which made SVG <text> render as
// empty tofu boxes. No Shopify/DB knowledge here — independently testable.
import fs from "fs";
import path from "path";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import { SoldImageSettings } from "./types";

const FONT_FAMILY = "SoldSticker";
let fontRegistered = false;

function ensureFontRegistered() {
  if (fontRegistered) return;
  // Resolve from process.cwd(), not __dirname: Next.js bundles this route
  // handler into a single chunk under .next/server/chunks/, which changes
  // __dirname at runtime to somewhere that no longer has an "assets"
  // sibling. outputFileTracingIncludes (next.config.js) copies the asset
  // preserving its repo-relative path under the function root instead,
  // which process.cwd() reliably points at on Vercel.
  const fontBuffer = fs.readFileSync(path.join(process.cwd(), "lib", "soldImage", "assets", "sticker-font.ttf"));
  GlobalFonts.register(fontBuffer, FONT_FAMILY);
  fontRegistered = true;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draws a straight horizontal band across the middle of the image. */
function drawCenterBand(ctx: import("@napi-rs/canvas").SKRSContext2D, width: number, height: number, settings: SoldImageSettings) {
  const bandWidth = (width * settings.sizePercent) / 100;
  const bandHeight = bandWidth * 0.28;
  const x = (width - bandWidth) / 2;
  const y = (height - bandHeight) / 2;
  const fontSize = bandHeight * 0.55;

  ctx.fillStyle = hexToRgba(settings.bandColorHex, settings.opacity);
  roundedRect(ctx, x, y, bandWidth, bandHeight, bandHeight * 0.15);
  ctx.fill();

  ctx.fillStyle = settings.textColorHex;
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(settings.stickerText, x + bandWidth / 2, y + bandHeight / 2 + fontSize * 0.05);
}

/** Draws a diagonal ribbon across one corner, classic "sold" banner style. */
function drawCornerRibbon(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  width: number,
  height: number,
  settings: SoldImageSettings,
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"
) {
  const ribbonLength = Math.hypot(width, height) * (settings.sizePercent / 100) * 0.55;
  const ribbonHeight = ribbonLength * 0.19;
  const fontSize = ribbonHeight * 0.5;

  const isTop = corner.startsWith("top");
  const isLeft = corner.endsWith("left");
  // Pivot near the chosen corner; rotation direction mirrors for each corner
  // so the ribbon always reads left-to-right and slopes away from the edge.
  // Far enough inset that the full text clears the canvas edge once rotated.
  const pivotX = isLeft ? width * 0.16 : width * 0.84;
  const pivotY = isTop ? height * 0.16 : height * 0.84;
  const angle = isTop === isLeft ? -Math.PI / 4 : Math.PI / 4;

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);

  ctx.fillStyle = hexToRgba(settings.bandColorHex, settings.opacity);
  ctx.fillRect(-ribbonLength / 2, -ribbonHeight / 2, ribbonLength, ribbonHeight);

  ctx.fillStyle = settings.textColorHex;
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(settings.stickerText, 0, fontSize * 0.05);

  ctx.restore();
}

function roundedRect(ctx: import("@napi-rs/canvas").SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function applySoldOverlay(imageBuffer: Buffer, settings: SoldImageSettings): Promise<Buffer> {
  ensureFontRegistered();

  const image = await loadImage(imageBuffer);
  const width = image.width;
  const height = image.height;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);

  if (settings.position === "center") {
    drawCenterBand(ctx, width, height, settings);
  } else {
    drawCornerRibbon(ctx, width, height, settings, settings.position);
  }

  return canvas.encode("jpeg", 90);
}
