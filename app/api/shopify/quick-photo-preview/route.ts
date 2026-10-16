import { NextRequest, NextResponse } from "next/server";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function OPTIONS(req: NextRequest) { return handleExtensionOptions(req); }

// The extension cannot reliably read File bytes in its sandbox. Receive one
// file using the same multipart transport as quick-image, but never store it
// or create Shopify media. Return a small, metadata-free preview only.
export async function POST(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  const headers = { ...auth.headers, "Cache-Control": "no-store" };
  if (Number(req.headers.get("content-length")) > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Maximaal 3 MB per foto." }, { status: 413, headers });
  }
  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || !/\.(jpe?g|png|webp|gif)$/i.test(file.name) || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      return NextResponse.json({ error: "Kies een JPG, PNG, WebP of GIF-afbeelding." }, { status: 400, headers });
    }
    if (!file.size || file.size > 3 * 1024 * 1024) {
      return NextResponse.json({ error: "Maximaal 3 MB per foto; lege bestanden zijn niet toegestaan." }, { status: 400, headers });
    }
    const image = await loadImage(Buffer.from(await file.arrayBuffer()));
    if (!image.width || !image.height || image.width * image.height > 40_000_000) {
      return NextResponse.json({ error: "Deze foto is te groot om te verwerken. Verklein de afmetingen." }, { status: 400, headers });
    }
    const ratio = Math.min(1, 320 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return NextResponse.json({ preview: `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg").toString("base64")}` }, { headers });
  } catch {
    return NextResponse.json({ error: "De foto kon niet worden gelezen. Kies een andere foto of probeer opnieuw." }, { status: 400, headers });
  }
}
