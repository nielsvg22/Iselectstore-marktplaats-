// Completes the Shopify app-install OAuth handshake for the separate
// "Inkoopverklaringen" app (its own client_id/secret — a distinct Shopify
// app from "Beheer" so it gets its own entry in the Admin sidebar, per the
// client's request for a dedicated, clearly-named app). Mirrors
// app/api/auth/callback/route.ts, which does the same for "Beheer" — kept
// separate because each app's redirect_uri must use its own credentials for
// the HMAC check and token exchange.
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
  const clientId = process.env.INKOOPVERKLARINGEN_APP_CLIENT_ID;
  const clientSecret = process.env.INKOOPVERKLARINGEN_APP_CLIENT_SECRET;

  if (!shop || !code) {
    return NextResponse.json({ error: "Ontbrekende shop of code parameter." }, { status: 400 });
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "INKOOPVERKLARINGEN_APP_CLIENT_ID / _CLIENT_SECRET niet geconfigureerd." }, { status: 500 });
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
    // No separate access token needed: this app only embeds the existing
    // /admin/inkoopverklaringen screen, which already authenticates via
    // ADMIN_PANEL_PASSWORD — not via this app's own Shopify grant.
    await logSync({ action: "inkoopverklaringen_app_installed", message: `shop=${shop}` });

    const res = NextResponse.redirect(`https://${shop}/admin/apps/${clientId}`);
    res.cookies.delete("shopify_app_oauth_state");
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ action: "inkoopverklaringen_app_install_error", message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
