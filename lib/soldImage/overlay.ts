// Pure image transform: takes an image buffer + sticker settings, returns a
// new buffer with a "SOLD" band composited on top. No Shopify/DB knowledge
// here — makes this independently testable and swappable.
import sharp from "sharp";
import { SoldImageSettings } from "./types";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bandOrigin(
  position: SoldImageSettings["position"],
  imageWidth: number,
  imageHeight: number,
  bandWidth: number,
  bandHeight: number,
  margin: number
): { x: number; y: number } {
  switch (position) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: imageWidth - bandWidth - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: imageHeight - bandHeight - margin };
    case "bottom-right":
      return { x: imageWidth - bandWidth - margin, y: imageHeight - bandHeight - margin };
    case "center":
    default:
      return { x: (imageWidth - bandWidth) / 2, y: (imageHeight - bandHeight) / 2 };
  }
}

export async function applySoldOverlay(imageBuffer: Buffer, settings: SoldImageSettings): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 1000;
  const height = metadata.height ?? 1000;

  const bandWidth = Math.round((width * settings.sizePercent) / 100);
  const bandHeight = Math.round(bandWidth * 0.28);
  const margin = Math.round(width * 0.04);
  const { x, y } = bandOrigin(settings.position, width, height, bandWidth, bandHeight, margin);
  const fontSize = Math.round(bandHeight * 0.5);

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${bandWidth}" height="${bandHeight}" rx="${Math.round(bandHeight * 0.15)}"
            fill="${settings.bandColorHex}" fill-opacity="${settings.opacity}" />
      <text x="${x + bandWidth / 2}" y="${y + bandHeight / 2}" dominant-baseline="central" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold"
            fill="${settings.textColorHex}" letter-spacing="2">${escapeXml(settings.stickerText)}</text>
    </svg>
  `;

  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
