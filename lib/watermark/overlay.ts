// Pure image transform: composites the iSelectStore watermark (variant K —
// a large outline asterisk, bottom-left corner, cropped by the image edges —
// plus "www.iselectstore.nl" centered at the bottom) onto a product photo.
// Uses @napi-rs/canvas, same as lib/soldImage/overlay.ts, and for the same
// reason: Vercel's serverless runtime has no system fonts, so a bundled
// woff2 (the site's own Poppins SemiBold) is registered explicitly instead
// of relying on a font family name resolving to anything. Pure function, no
// Shopify/DB knowledge — independently testable.
import fs from "fs";
import path from "path";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

const FONT_FAMILY = "iSelectStoreWatermark";
let fontRegistered = false;

function ensureFontRegistered() {
  if (fontRegistered) return;
  // Resolve from process.cwd(), not __dirname — see lib/soldImage/overlay.ts
  // for why (Next.js bundles route handlers into chunks that change
  // __dirname at runtime on Vercel).
  const fontBuffer = fs.readFileSync(path.join(process.cwd(), "lib", "watermark", "assets", "brand-poppins-600-latin.woff2"));
  GlobalFonts.register(fontBuffer, FONT_FAMILY);
  fontRegistered = true;
}

const ASTERISK_PATH = path.join(process.cwd(), "lib", "watermark", "assets", "mark-navy.svg");

// Proportions, all relative to image size so the watermark scales and stays
// in the same visual position on square, landscape and portrait photos alike.
const MARK_SIZE_FRACTION = 0.3; // of min(width, height)
const MARK_EDGE_OFFSET_FRACTION = 0.22; // of the mark's own size — how far it hangs off the left/bottom edges
const MARK_OPACITY = 0.12;
const TEXT_COLOR = "rgba(250, 133, 140, 0.68)"; // brand coral, subdued
const TEXT_SIZE_FRACTION = 0.026; // of image width
const TEXT_MIN_SIZE = 14;
const TEXT_MAX_SIZE = 44;
const TEXT_BOTTOM_MARGIN_FRACTION = 0.045; // of image height, from baseline to bottom edge
const TEXT_MIN_BOTTOM_MARGIN = 16;
const TEXT_MAX_BOTTOM_MARGIN = 56;
const WATERMARK_TEXT = "www.iselectstore.nl";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function applyWatermark(imageBuffer: Buffer): Promise<Buffer> {
  ensureFontRegistered();

  const [image, asterisk] = await Promise.all([loadImage(imageBuffer), loadImage(ASTERISK_PATH)]);
  const width = image.width;
  const height = image.height;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);

  // Asterisk: anchored to the bottom-left corner, partly hanging off the
  // left and bottom edges so it reads as "cropped" at any aspect ratio.
  const markSize = Math.min(width, height) * MARK_SIZE_FRACTION;
  const markOffset = markSize * MARK_EDGE_OFFSET_FRACTION;
  const markX = -markOffset;
  const markY = height - markSize + markOffset;

  ctx.save();
  ctx.globalAlpha = MARK_OPACITY;
  ctx.drawImage(asterisk, markX, markY, markSize, markSize);
  ctx.restore();

  // Website text: horizontally centered, bottom of the image. Sized and
  // margined relative to the image so it stays legible — and fully on
  // canvas — at any resolution.
  const fontSize = clamp(width * TEXT_SIZE_FRACTION, TEXT_MIN_SIZE, TEXT_MAX_SIZE);
  const bottomMargin = clamp(height * TEXT_BOTTOM_MARGIN_FRACTION, TEXT_MIN_BOTTOM_MARGIN, TEXT_MAX_BOTTOM_MARGIN);

  ctx.font = `600 ${fontSize}px "${FONT_FAMILY}"`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(WATERMARK_TEXT, width / 2, height - bottomMargin);

  return canvas.encode("jpeg", 95);
}
