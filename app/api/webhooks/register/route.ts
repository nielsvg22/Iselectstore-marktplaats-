// One-time setup helper: registers the products/update webhook subscription
// that drives the sold-image feature. Run this once after deploying (see
// SOLD_IMAGE_FEATURE.md) — Shopify webhook subscriptions aren't created
// automatically just by having the route exist.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: undefined }));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;

  if (!domain || !token) {
    return NextResponse.json({ error: "Shopify niet geconfigureerd." }, { status: 500 });
  }

  const res = await fetch(`https://${domain}/admin/api/${version}/webhooks.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        topic: "products/update",
        address: `${appUrl}/api/webhooks/products-update`,
        format: "json",
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data }, { status: res.status });
  }
  return NextResponse.json({ webhook: data.webhook });
}
