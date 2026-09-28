// Admin UI extension endpoint: creates a Shopify product from an iSelect
// template. Authenticated with the Shopify id-token the extension sends.
import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import {
  createQuickProduct,
  QuickProductError,
  ProductStatus,
} from "@/services/shopify/quickProductService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleExtensionOptions(req);
}

export async function POST(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  const headers = auth.headers;

  let body: {
    productType?: unknown;
    values?: unknown;
    status?: unknown;
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
    const result = await createQuickProduct({
      productType: String(body.productType || ""),
      values:
        body.values && typeof body.values === "object"
          ? (body.values as Record<string, unknown>)
          : {},
      status: (body.status ?? "draft") as ProductStatus,
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
    console.error("quick-create failed:", message);
    return NextResponse.json(
      { error: "Het aanmaken van het product is mislukt. Probeer het opnieuw." },
      { status: 502, headers }
    );
  }
}
