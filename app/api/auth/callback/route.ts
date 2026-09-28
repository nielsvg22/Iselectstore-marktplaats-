// Completes the Shopify app-install OAuth handshake. Shopify redirects here
// directly (per the redirect_uri registered in shopify.app.toml) after a
// merchant approves the "Autoriseren" / re-authorize prompt shown on the
// Marktplaats-kenmerken admin block, whenever the app's declared access
// scopes changed since it was last granted. Without this route, that
// redirect 404'd and the block stayed permanently locked.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

function verifyHmac(searchParams: URLSearchParams, secret: string): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(hmac, "hex"));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET;

  if (!shop || !code) {
    return NextResponse.json({ error: "Ontbrekende shop of code parameter." }, { status: 400 });
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET niet geconfigureerd." }, { status: 500 });
  }
  if (!verifyHmac(searchParams, clientSecret)) {
    return NextResponse.json({ error: "HMAC-validatie mislukt — mogelijke CSRF." }, { status: 400 });
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange mislukt (${tokenRes.status}): ${body}`);
    }
    // We don't persist this token: the app already uses a separate static
    // SHOPIFY_ADMIN_ACCESS_TOKEN for its own REST calls. This exchange only
    // needs to happen so Shopify marks the app as authorized for its
    // declared scopes, unlocking the admin block extension.
    await logSync({ action: "shopify_app_reauthorized", message: `shop=${shop}` });

    const res = NextResponse.redirect(`https://${shop}/admin/apps/${clientId}`);
    res.cookies.delete("shopify_app_oauth_state");
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ action: "shopify_app_reauthorize_error", message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
