// Temporary read-only diagnostic: shows exactly what the sold-image
// detector sees for a product, to debug why a webhook didn't trigger.
// Safe to remove once the sold-image feature is confirmed working.
import { NextRequest, NextResponse } from "next/server";
import { getProduct } from "@/lib/shopify/client";
import { isSoldOut, isBackInStock } from "@/lib/soldImage/detectSoldOut";
import { getSoldImageState } from "@/lib/soldImage/stateService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "productId is verplicht" }, { status: 400 });

  const product = await getProduct(productId);
  const state = await getSoldImageState(productId);

  return NextResponse.json({
    variants: product.variants.map((v) => ({ id: v.id, inventory_quantity: v.inventory_quantity, inventory_management: v.inventory_management })),
    isSoldOut: isSoldOut(product),
    isBackInStock: isBackInStock(product),
    state,
  });
}
