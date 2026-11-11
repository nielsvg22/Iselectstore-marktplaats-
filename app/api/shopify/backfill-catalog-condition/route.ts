import { NextRequest, NextResponse } from "next/server";
import { listProducts } from "@/lib/shopify/client";
import { autoSyncCatalogCondition } from "@/lib/catalog/autoSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-off: sets the Google Shopping + Meta catalog condition attribute on every existing product (new installs get it automatically via the webhooks). */
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const products = await listProducts(250);
  let processed = 0;
  for (const product of products) {
    await autoSyncCatalogCondition(
      String(product.id),
      product.product_type,
      product.variants.map((v) => v.id)
    );
    processed++;
  }

  return NextResponse.json({ ok: true, processed, total: products.length });
}
