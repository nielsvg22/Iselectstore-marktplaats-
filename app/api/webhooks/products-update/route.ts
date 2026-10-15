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
import { getProduct, hasPositiveInventory } from "@/lib/shopify/client";
import { logSync } from "@/lib/logging";
import { updateLifecycleState } from "@/services/catalog/lifecycleService";
import { checkProductObjectAndNotify } from "@/services/inventory/notificationService";
import { autoCreateGoedgeplaatstConceptAd } from "@/lib/goedgeplaatst/autoSync";
import { getLinkForShopifyProduct } from "@/lib/goedgeplaatst/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET;
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

  // Update sold_at / lifecycle state. Errors are logged but never fail the webhook.
  await updateLifecycleState(product).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logSync({ shopifyProductId: productId, action: "lifecycle_update_error", message }).catch(() => {});
  });

  // If the product is back in stock, notify matching subscriptions inline.
  if (isBackInStock(product)) {
    await checkProductObjectAndNotify(product).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSync({ shopifyProductId: productId, action: "inventory_notification_error", message }).catch(() => {});
    });
  }

  // Retries the GoedGeplaatst auto-concept for a product that was skipped
  // on products/create (e.g. no photos yet at that point — a common
  // Shopify flow is create-then-add-photos). createConceptAd() is
  // idempotent on the shopify:<id> link key, so this only ever does
  // something when there is NOT already a successful concept — an update
  // on an already-linked product is a cheap no-op DB read, nothing more.
  if (hasPositiveInventory(product)) {
    const existingLink = await getLinkForShopifyProduct(productId).catch(() => null);
    // concept_status="error" rows store goedgeplaatst_ad_id="0" as a
    // placeholder (truthy string!) — only a genuinely succeeded concept
    // should skip the retry, otherwise a past failure (e.g. missing photos,
    // an invalid model name) would block every future retry forever.
    const hasSucceededBefore = existingLink?.concept_status === "concept" && Number(existingLink.goedgeplaatst_ad_id) > 0;
    if (!hasSucceededBefore) {
      await autoCreateGoedgeplaatstConceptAd(productId).catch(() => {
        /* autoCreateGoedgeplaatstConceptAd already logs its own failures */
      });
    }
  }

  return NextResponse.json({ ok: true });
}
