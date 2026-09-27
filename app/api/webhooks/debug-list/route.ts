// Temporary diagnostic: lists all webhook subscriptions currently
// registered on the shop, to confirm products/update actually exists and
// points at the right URL.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";

  const res = await fetch(`https://${domain}/admin/api/${version}/webhooks.json`, {
    headers: { "X-Shopify-Access-Token": token! },
  });
  const data = await res.json();
  return NextResponse.json({ status: res.status, data });
}
