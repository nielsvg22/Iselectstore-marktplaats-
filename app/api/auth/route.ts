// Shopify app-install OAuth entry point. Shopify redirects merchants here
// (via the "Autoriseren" prompt on an app block, or a fresh app install)
// whenever the app's declared access scopes (shopify.app.toml) don't match
// what's currently granted on the shop. This has nothing to do with the
// Marktplaats OAuth flow under /api/marktplaats/oauth — that authorizes
// against Marktplaats, this authorizes our app against Shopify itself.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const SCOPES = "read_content,read_products,write_content,write_products,read_inventory,read_themes,write_themes";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID;
  if (!shop || !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
    return NextResponse.json({ error: "Ongeldige of ontbrekende shop parameter." }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "SHOPIFY_CLIENT_ID / SHOPIFY_APP_CLIENT_ID niet geconfigureerd." }, { status: 500 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;
  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("shopify_app_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  });
  return res;
}
