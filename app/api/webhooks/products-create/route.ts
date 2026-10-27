import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/soldImage/webhookAuth";
import { getProduct, hasPositiveInventory, getCustomFields, setProductSeo } from "@/lib/shopify/client";
import { buildSeoTitle, buildSeoDescription } from "@/lib/shopify/seo";
import { watermarkProductImages } from "@/lib/watermark/watermarkService";
import { logSync } from "@/lib/logging";
import { updateLifecycleState } from "@/services/catalog/lifecycleService";
import { checkProductObjectAndNotify } from "@/services/inventory/notificationService";
import { autoCreateGoedgeplaatstConceptAd } from "@/lib/goedgeplaatst/autoSync";
import { autoPostProductToInstagram } from "@/lib/instagram/autoSync";
import { autoPostProductToTiktok } from "@/lib/tiktok/autoSync";

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
  const product = await getProduct(productId);

  if (!product.metafields_global_title_tag || !product.metafields_global_description_tag) {
    const price = product.variants?.[0]?.price;
    if (price) {
      await getCustomFields(productId)
        .then((fields) => setProductSeo(productId, buildSeoTitle(product.title), buildSeoDescription(product.title, fields, price)))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logSync({ shopifyProductId: productId, action: "seo_generate_error", message }).catch(() => {});
        });
    }
  }

  await updateLifecycleState(product).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logSync({ shopifyProductId: productId, action: "lifecycle_update_error", message }).catch(() => {});
  });

  // Covers the (uncommon) case a product is created with photos already
  // attached. The usual create-then-add-photos flow is handled by the same
  // call in products-update. Idempotent, never fails the webhook.
  await watermarkProductImages(productId, product).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logSync({ shopifyProductId: productId, action: "watermark_error", message }).catch(() => {});
  });

  if (hasPositiveInventory(product)) {
    await checkProductObjectAndNotify(product).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logSync({ shopifyProductId: productId, action: "inventory_notification_error", message }).catch(() => {});
    });

    // Second, independent placement route (lib/goedgeplaatst/) — saves a
    // GoedGeplaatst concept ad automatically the moment a new, in-stock
    // product is added, instead of requiring a manual click in the admin
    // panel. Status is always "concept" (hard-guarded in
    // lib/goedgeplaatst/config.ts), so this never publishes anything or
    // creates a cost — same safety boundary as the manual button. Gated on
    // inventory for the same reason the inventory notification above is:
    // no point creating a concept for a product that isn't sellable yet.
    await autoCreateGoedgeplaatstConceptAd(productId).catch(() => {
      /* autoCreateGoedgeplaatstConceptAd already logs its own failures */
    });

    // Third, independent channel — auto-posts the product to Instagram.
    // Currently points at a separate TEST Instagram account (see
    // lib/instagram/config.ts's INSTAGRAM_ENVIRONMENT) until that's
    // deliberately switched to the real iSelectStore account; a missing
    // token forces mock mode either way, so this is a safe no-op until
    // credentials are configured. Deliberately NOT awaited — the function
    // itself waits out a grace period (INSTAGRAM_POST_DELAY_SECONDS) before
    // actually posting, to let a merchant's in-progress multi-photo upload
    // finish landing, and that wait must not hold up this webhook response.
    autoPostProductToInstagram(productId).catch(() => {
      /* autoPostProductToInstagram already logs its own failures */
    });

    // Fourth, independent channel — auto-posts the product to TikTok as a
    // photo carousel. Currently points at a separate TEST TikTok Sandbox
    // app (see lib/tiktok/config.ts's TIKTOK_ENVIRONMENT) until that's
    // deliberately switched to the real iSelectStore account; a missing
    // token forces mock mode either way, so this is a safe no-op until
    // credentials are configured. Also deliberately not awaited — same
    // grace-period reasoning as autoPostProductToInstagram above.
    autoPostProductToTiktok(productId).catch(() => {
      /* autoPostProductToTiktok already logs its own failures */
    });
  }

  return NextResponse.json({ ok: true });
}
