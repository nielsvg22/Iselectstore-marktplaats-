import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken } from "@/lib/shopify/tokenService";

export const dynamic = "force-dynamic";

/** Temporary diagnostic: deletes one Shopify webhook subscription by its numeric ID. */
export async function POST(req: NextRequest) {
  const { password, id } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }
  if (!id) {
    return NextResponse.json({ error: "Ontbrekend webhook-id." }, { status: 400 });
  }

  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const version = process.env.SHOPIFY_API_VERSION || "2024-10";
    const token = await getShopifyAccessToken();

    const res = await fetch(`https://${domain}/admin/api/${version}/webhooks/${id}.json`, {
      method: "DELETE",
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `HTTP ${res.status}: ${body}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deletedId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
