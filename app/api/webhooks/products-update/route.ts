// Shopify webhook: products/update. Detects the "sold out" / "back in
// stock" transition and schedules the sold-image job accordingly — never
// does the (slower, image-processing) work inline, so a slow or failing
// Shopify Admin API call here can never make Shopify itself see a failure.
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/soldImage/webhookAuth";
import { isSoldOut, isBackInStock } from "@/lib/soldImage/detectSoldOut";
import { getSoldImageState, markPending, markRestoring } from "@/lib/soldImage/stateService";
import { getSoldImageSettings } from "@/lib/soldImage/settingsService";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  const rawBody = await req.text();

  if (!secret || !verifyShopifyWebhookHmac(rawBody, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "Ongeldige webhook-handtekening." }, { status: 401 });
  }

  let product: { id: number; variants: { inventory_quantity: number; inventory_management: string | null }[] };
  try {
    product = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ongeldige payload." }, { status: 400 });
  }

  const productId = String(product.id);
  const existing = await getSoldImageState(productId);

  if (isSoldOut(product)) {
    // Only schedule if this product isn't already pending/applied — markPending
    // itself is a no-op in that case too, this just avoids a redundant log line.
    if (!existing || existing.status === "none" || existing.status === "restored" || existing.status === "error") {
      const settings = await getSoldImageSettings();
      const applyAfter = new Date(Date.now() + settings.delayHours * 60 * 60 * 1000);
      await markPending(productId, applyAfter);
      await logSync({ shopifyProductId: productId, action: "sold_image_scheduled", message: `applyAfter=${applyAfter.toISOString()}` });
    }
  } else if (isBackInStock(product) && existing?.status === "applied") {
    await markRestoring(productId);
    await logSync({ shopifyProductId: productId, action: "sold_image_restore_scheduled" });
  }

  return NextResponse.json({ ok: true });
}
