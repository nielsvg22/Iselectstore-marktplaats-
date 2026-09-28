import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhookHmac } from "@/lib/soldImage/webhookAuth";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET;
  const rawBody = await req.text();

  if (!secret || !verifyShopifyWebhookHmac(rawBody, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "Ongeldige webhook-handtekening." }, { status: 401 });
  }

  let payload: { shop_domain?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ongeldige payload." }, { status: 400 });
  }

  // Best-effort cleanup logging. In a multi-tenant setup this is where sessions
  // would be invalidated and the shop marked inactive.
  await logSync({
    action: "app_uninstalled",
    message: `shop_domain=${payload.shop_domain || "unknown"}`,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
