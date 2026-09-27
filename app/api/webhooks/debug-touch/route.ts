// Temporary test helper: re-saves a product's title unchanged, purely to
// make Shopify emit a fresh products/update webhook so the sold-image flow
// can be exercised end-to-end on a product whose stock already sits at 0
// (Shopify doesn't refire the webhook just because time passes). Safe to
// remove once the feature is confirmed working; password-gated like
// /api/webhooks/register.
import { NextRequest, NextResponse } from "next/server";
import { getProduct } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { productId, password } = await req.json();
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  const product = await getProduct(productId);

  const res = await fetch(`https://${domain}/admin/api/${version}/products/${productId}.json`, {
    method: "PUT",
    headers: { "X-Shopify-Access-Token": token!, "Content-Type": "application/json" },
    body: JSON.stringify({ product: { id: Number(productId), title: product.title } }),
  });

  const data = await res.json();
  return NextResponse.json({ status: res.status, data });
}
