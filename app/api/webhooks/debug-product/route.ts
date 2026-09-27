// Temporary read-only diagnostic: shows exactly what the sold-image
// detector sees for a product, to debug why a webhook didn't trigger.
// Safe to remove once the sold-image feature is confirmed working.
import { NextRequest, NextResponse } from "next/server";
import { getProduct, listProducts } from "@/lib/shopify/client";
import { isSoldOut, isBackInStock } from "@/lib/soldImage/detectSoldOut";
import { getSoldImageState } from "@/lib/soldImage/stateService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) {
    const products = await listProducts(50);
    return NextResponse.json({
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        variants: p.variants.map((v) => ({ inventory_quantity: v.inventory_quantity, inventory_management: v.inventory_management })),
      })),
    });
  }

  const product = await getProduct(productId);
  const state = await getSoldImageState(productId);

  return NextResponse.json({
    variants: product.variants.map((v) => ({ id: v.id, inventory_quantity: v.inventory_quantity, inventory_management: v.inventory_management })),
    isSoldOut: isSoldOut(product),
    isBackInStock: isBackInStock(product),
    state,
  });
}
