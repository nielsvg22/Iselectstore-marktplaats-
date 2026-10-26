import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken } from "@/lib/shopify/tokenService";

export const dynamic = "force-dynamic";

/** Temporary diagnostic: returns the most recently created product's numeric Shopify ID + title. */
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const version = process.env.SHOPIFY_API_VERSION || "2024-10";
    const token = await getShopifyAccessToken();

    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query { products(first: 1, sortKey: CREATED_AT, reverse: true) { edges { node { legacyResourceId title createdAt images(first: 3) { edges { node { url width height } } } } } } }`,
      }),
      cache: "no-store",
    });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
