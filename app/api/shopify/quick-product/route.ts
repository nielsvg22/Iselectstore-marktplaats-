// Admin UI extension endpoint: loads the current iSelect fields, titles and
// status for an existing product (used by the product-details block).
import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { readQuickProduct, QuickProductError } from "@/services/shopify/quickProductService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleExtensionOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  const headers = auth.headers;

  const productId = req.nextUrl.searchParams.get("id") || "";
  try {
    const result = await readQuickProduct(productId);
    return NextResponse.json(result, { headers });
  } catch (err) {
    if (err instanceof QuickProductError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues ?? [] },
        { status: err.status, headers }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("quick-product read failed:", message);
    return NextResponse.json(
      { error: "Het product kon niet worden geladen." },
      { status: 502, headers }
    );
  }
}
