// Shopify webhook: products/update. Detects the "sold out" / "back in
// stock" transition, schedules the sold-image job, and — for the "direct"
// (0-hour delay) and restore cases — processes it right away rather than
// waiting for the once-a-day cron fallback (Vercel Hobby plan only allows
// daily cron schedules, so cron alone can't do "direct").
//
// Deliberately ignores the webhook body's own variant data beyond the
// product id: webhook subscriptions created via the REST Admin API inherit
// whatever API version that admin token's app currently defaults to (in
// practice, whatever Shopify's newest stable version is at delivery time),
// which can differ from SHOPIFY_API_VERSION and shape the payload
// differently. Re-fetching the product through our own known-good REST
// client sidesteps that entirely.
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/soldImage/webhookAuth";
import { isSoldOut, isBackInStock } from "@/lib/soldImage/detectSoldOut";
import { getSoldImageState, markPending, markRestoring } from "@/lib/soldImage/stateService";
import { getSoldImageSettings } from "@/lib/soldImage/settingsService";
import { processProductNow } from "@/lib/soldImage/soldImageService";
import { getProduct } from "@/lib/shopify/client";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_APP_CLIENT_SECRET;
  const rawBody = await req.text();

  if (!secret || !verifyShopifyWebhookHmac(rawBody, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "Ongeldige webhook-handtekening." }, { status: 401 });
  }

  let payload: { id: number };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ongeldige payload." }, { status: 400 });
  }

  const productId = String(payload.id);
  const [product, existing] = await Promise.all([getProduct(productId), getSoldImageState(productId)]);

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

  // Best-effort inline processing (delay=0 / restore). Never let this fail
  // the webhook response — the daily cron picks up anything left pending.
  // Errors are already logged inside processProductNow/soldImageService.
  await processProductNow(productId).catch(() => {});

  return NextResponse.json({ ok: true });
}
