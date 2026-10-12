import { NextRequest, NextResponse } from "next/server";
import { getLinkForShopifyProduct } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";

/** Read-only: looks up the stored Shopify product <-> GoedGeplaatst adId link (STAP 9), if any. */
export async function GET(req: NextRequest) {
  const shopifyProductId = req.nextUrl.searchParams.get("shopifyProductId");
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId query-parameter is verplicht." }, { status: 400 });
  }
  try {
    const link = await getLinkForShopifyProduct(shopifyProductId);
    return NextResponse.json({ link });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
