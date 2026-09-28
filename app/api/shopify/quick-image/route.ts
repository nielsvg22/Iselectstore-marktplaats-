// Admin UI extension endpoint: uploads one product image (base64) for a
// product created/edited through the extension.
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

  let body: {
    productId?: unknown;
    filename?: unknown;
    data?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Ongeldige request body." },
      { status: 400, headers }
    );
  }

  try {
    const result = await addQuickProductImage(
      String(body.productId || ""),
      String(body.filename || ""),
      String(body.data || "")
    );
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
