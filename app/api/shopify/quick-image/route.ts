// Admin UI extension endpoint: uploads one product image for a product
// created/edited through the extension. Accepts two bodies: JSON with a
// base64 "data" field (used by the AI-foto web page's draft-image sync,
// where the browser already produced a dataURL normally) and
// multipart/form-data with a "file" field (used by the extension's own
// drop-zones, where the sandboxed context can't read File bytes itself).
import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { addQuickProductImage, QuickProductError } from "@/services/shopify/quickProductService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleExtensionOptions(req);
}

export async function POST(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  const headers = auth.headers;

  let productId: string;
  let filename: string;
  let base64Data: string;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    // Rechtstreeks gekozen bestand uit de admin-extensie (s-drop-zone): die
    // sandbox kan het File-object niet zelf betrouwbaar als bytes lezen
    // (file.arrayBuffer() faalt daar — live bevestigd, "Kon ... niet
    // lezen"), exact zoals Shopify's eigen DropZone-voorbeeld dit ook nooit
    // zelf doet en in plaats daarvan altijd FormData + fetch gebruikt. De
    // bytes lezen we hier gewoon server-side, waar dat probleem niet bestaat.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Ongeldige multipart-body." }, { status: 400, headers });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file-veld ontbreekt of is geen bestand." }, { status: 400, headers });
    }
    productId = String(form.get("productId") || "");
    filename = file.name || "image.jpg";
    const buffer = Buffer.from(await file.arrayBuffer());
    base64Data = buffer.toString("base64");
  } else {
    let body: { productId?: unknown; filename?: unknown; data?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige request body." }, { status: 400, headers });
    }
    productId = String(body.productId || "");
    filename = String(body.filename || "");
    base64Data = String(body.data || "");
  }

  try {
    const result = await addQuickProductImage(productId, filename, base64Data);
    return NextResponse.json(result, { headers });
  } catch (err) {
    if (err instanceof QuickProductError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues ?? [] },
        { status: err.status, headers }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("quick-image failed:", message);
    return NextResponse.json(
      { error: "De afbeelding kon niet worden toegevoegd." },
      { status: 502, headers }
    );
  }
}
