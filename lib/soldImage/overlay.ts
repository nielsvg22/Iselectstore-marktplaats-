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
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  const textWidth = ctx.measureText(settings.stickerText).width;

  const isTop = corner.startsWith("top");
  const isLeft = corner.endsWith("left");
  const angle = isTop === isLeft ? -Math.PI / 4 : Math.PI / 4;

  // Pivot placed along the corner's 45° bisector so the band sits as close
  // to the true image corner as possible — ideally flush (0 gap), which
  // happens at an inset of exactly ribbonHeight/2 * cos(45°). But the band
  // is only as tall as ribbonHeight while the text is much wider, so at
  // that exact distance the far end of the text would be clipped by the
  // adjacent edge (rotating a wide string that close to a corner swings one
  // end off-canvas). Use whichever inset is larger: the minimum needed for
  // the text to fully clear both edges, or the exact-corner-touch distance.
  // A small residual gap only appears for very long custom sticker text.
  const cornerTouchInset = (ribbonHeight / 2) * Math.SQRT1_2;
  const textClearanceInset = (textWidth / 2 / Math.SQRT2) * 1.15;
  const inset = Math.max(cornerTouchInset, textClearanceInset);

  const cornerX = isLeft ? 0 : width;
  const cornerY = isTop ? 0 : height;
  const signX = isLeft ? 1 : -1;
  const signY = isTop ? 1 : -1;
  const pivotX = cornerX + signX * inset;
  const pivotY = cornerY + signY * inset;

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

/** Draws a compact badge sized to the text, flush against the image's actual corner (zero
 * margin) so it fills the corner with no background gap — only the two outer corners are
 * rounded, the corner touching the image edge stays sharp. Matches the site's other product
 * badges (solid fill, bold white text, no rotation) instead of a diagonal ribbon. */
function drawCornerPill(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  width: number,
  height: number,
  settings: SoldImageSettings,
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"
) {
  const fontSize = Math.max(12, width * 0.032 * (settings.sizePercent / 60));
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  const textWidth = ctx.measureText(settings.stickerText).width;

  const paddingX = fontSize * 0.9;
  const paddingY = fontSize * 0.55;
  const pillWidth = textWidth + paddingX * 2;
  const pillHeight = fontSize + paddingY * 2;
  const radius = pillHeight / 2;

  const isTop = corner.startsWith("top");
  const isLeft = corner.endsWith("left");
  // Flush against the image edges — no margin — so the badge fills the corner itself.
  const x = isLeft ? 0 : width - pillWidth;
  const y = isTop ? 0 : height - pillHeight;

  ctx.fillStyle = hexToRgba(settings.bandColorHex, settings.opacity);
  roundedRectCorners(ctx, x, y, pillWidth, pillHeight, {
    tl: isTop && isLeft ? 0 : radius,
    tr: isTop && !isLeft ? 0 : radius,
    br: !isTop && !isLeft ? 0 : radius,
    bl: !isTop && isLeft ? 0 : radius,
  });
  ctx.fill();

  ctx.fillStyle = settings.textColorHex;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(settings.stickerText, x + pillWidth / 2, y + pillHeight / 2 + fontSize * 0.05);
}

function roundedRect(ctx: import("@napi-rs/canvas").SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundedRectCorners(ctx, x, y, w, h, { tl: r, tr: r, br: r, bl: r });
}

/** Like roundedRect, but each corner's radius can differ — 0 gives a sharp corner. */
function roundedRectCorners(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: { tl: number; tr: number; br: number; bl: number }
) {
  const { tl, tr, br, bl } = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
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
  } else if (settings.style === "pill") {
    drawCornerPill(ctx, width, height, settings, settings.position);
  } else {
    drawCornerRibbon(ctx, width, height, settings, settings.position);
  }

  return canvas.encode("jpeg", 90);
}
