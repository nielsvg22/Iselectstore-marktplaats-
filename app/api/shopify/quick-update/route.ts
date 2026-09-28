// Admin UI extension endpoint: saves edited iSelect product fields back to an
// existing Shopify product (title, price, product type + metafields).
import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { updateQuickProduct, QuickProductError } from "@/services/shopify/quickProductService";

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
    productType?: unknown;
    values?: unknown;
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
    const result = await updateQuickProduct({
      productId: String(body.productId || ""),
      productType: String(body.productType || ""),
      values:
        body.values && typeof body.values === "object"
          ? (body.values as Record<string, unknown>)
          : {},
    });
    return NextResponse.json(result, { headers });
  } catch (err) {
    if (err instanceof QuickProductError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues ?? [] },
        { status: err.status, headers }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("quick-update failed:", message);
    return NextResponse.json(
      { error: "Het opslaan van het product is mislukt. Probeer het opnieuw." },
      { status: 502, headers }
    );
  }
}
