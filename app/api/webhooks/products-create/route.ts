import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/soldImage/webhookAuth";
import { getProduct } from "@/lib/shopify/client";
import { logSync } from "@/lib/logging";
import { updateLifecycleState } from "@/services/catalog/lifecycleService";
import { checkProductObjectAndNotify } from "@/services/inventory/notificationService";
import { autoCreateGoedgeplaatstConceptAd } from "@/lib/goedgeplaatst/autoSync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function hasPositiveInventory(product: { variants: { inventory_management: string | null; inventory_quantity: number }[] }): boolean {
  return product.variants.some((v) => v.inventory_management && v.inventory_quantity > 0);
}

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

  await updateLifecycleState(product).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    logSync({ shopifyProductId: productId, action: "lifecycle_update_error", message }).catch(() => {});
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
  }

  return NextResponse.json({ ok: true });
}
