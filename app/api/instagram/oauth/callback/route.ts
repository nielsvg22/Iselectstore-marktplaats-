import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * One-off manual setup helper: catches the redirect from Instagram's OAuth
 * consent screen (business login product on developers.facebook.com),
 * exchanges the `code` for a short-lived token, upgrades it to a 60-day
 * long-lived token, and looks up the account's own Instagram user id — all
 * three values a human then copies into INSTAGRAM_TEST_ACCESS_TOKEN /
 * INSTAGRAM_TEST_BUSINESS_ACCOUNT_ID (or the production equivalents) in
 * Coolify. Not used by any automated flow — lib/instagram/config.ts reads
 * those env vars directly, this route only exists to produce them.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
  if (error) {
    return new NextResponse(`Instagram gaf een fout terug: ${error}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Geen 'code' parameter gevonden in de redirect.", { status: 400 });
  }

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) {
    return new NextResponse("INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET ontbreken in de omgeving.", { status: 500 });
  }

  const redirectUri = `${req.nextUrl.origin}/api/instagram/oauth/callback`;

  try {
    const shortLivedForm = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortLivedRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: shortLivedForm,
    });
    const shortLivedJson = await shortLivedRes.json();
    if (!shortLivedRes.ok || !shortLivedJson.access_token) {
      return new NextResponse(`Short-lived token ophalen mislukt: ${JSON.stringify(shortLivedJson)}`, { status: 502 });
    }

    const longLivedRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortLivedJson.access_token)}`
    );
    const longLivedJson = await longLivedRes.json();
    if (!longLivedRes.ok || !longLivedJson.access_token) {
      return new NextResponse(`Long-lived token ophalen mislukt: ${JSON.stringify(longLivedJson)}`, { status: 502 });
    }

    const meRes = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(longLivedJson.access_token)}`);
    const meJson = await meRes.json();

    return new NextResponse(
      [
        "Gelukt! Kopieer onderstaande twee waarden naar Coolify:",
        "",
        `INSTAGRAM_TEST_ACCESS_TOKEN=${longLivedJson.access_token}`,
        `INSTAGRAM_TEST_BUSINESS_ACCOUNT_ID=${meJson.user_id || "(user_id ontbreekt, zie ruwe respons hieronder)"}`,
        "",
        `Instagram-gebruikersnaam: ${meJson.username || "onbekend"}`,
        `Token geldig voor ongeveer ${Math.round((longLivedJson.expires_in || 0) / 86400)} dagen.`,
        "",
        `Ruwe /me respons: ${JSON.stringify(meJson)}`,
      ].join("\n"),
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Onverwachte fout: ${message}`, { status: 500 });
  }
}
