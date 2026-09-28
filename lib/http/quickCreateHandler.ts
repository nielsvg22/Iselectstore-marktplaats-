// Gedeelde POST-afhandeling voor het quick-create productpad. Twee routes
// gebruiken exact dezelfde creatie-logica (createQuickProduct) met alleen een
// andere authenticatie-laag:
// - extension-route (/api/shopify/quick-create): Shopify idToken verplicht;
// - interne beheerapp-route (/api/admin/quick-create): geen auth (zelfde
//   posture als /api/ai/* en de marktplaats-routes), voor de server-side
//   beheerpagina die geen idToken kan meesturen.
import { NextRequest, NextResponse } from "next/server";
import {
  createQuickProduct,
  QuickProductError,
  ProductStatus,
} from "@/services/shopify/quickProductService";

export async function handleQuickCreatePost(
  req: NextRequest,
  headers: Record<string, string> = {}
): Promise<NextResponse> {
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
