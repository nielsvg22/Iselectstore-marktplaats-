// One-time setup helper: registers the webhook subscriptions used by this app.
// Run this once after deploying — Shopify webhook subscriptions aren't created
// automatically just by having the route exist.
import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken } from "@/lib/shopify/tokenService";

export const dynamic = "force-dynamic";

const WEBHOOKS = [
  { topic: "products/update", path: "/api/webhooks/products-update" },
  { topic: "products/create", path: "/api/webhooks/products-create" },
  { topic: "app/uninstalled", path: "/api/webhooks/app-uninstalled" },
];

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: undefined }));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;

  if (!domain) {
    return NextResponse.json({ error: "Shopify niet geconfigureerd." }, { status: 500 });
  }
  const token = await getShopifyAccessToken();

  const results: { topic: string; ok: boolean; error?: string; id?: number }[] = [];

  for (const hook of WEBHOOKS) {
    try {
      const res = await fetch(`https://${domain}/admin/api/${version}/webhooks.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook: {
            topic: hook.topic,
            address: `${appUrl}${hook.path}`,
            format: "json",
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ topic: hook.topic, ok: false, error: data?.errors || `HTTP ${res.status}` });
      } else {
        results.push({ topic: hook.topic, ok: true, id: data.webhook?.id });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ topic: hook.topic, ok: false, error: message });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 });
}
