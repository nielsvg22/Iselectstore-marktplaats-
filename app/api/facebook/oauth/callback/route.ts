import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * One-off manual setup helper, mirroring app/api/instagram/oauth/callback —
 * catches the redirect from Facebook Login's consent screen, exchanges the
 * `code` for a user access token, then calls /me/accounts to list the
 * pages that user manages. Each entry in that list already carries its own
 * Page access token (long-lived automatically when the user token is
 * long-lived, which Facebook Login's default token already is for this
 * flow) — no separate long-lived-token exchange step needed, unlike the
 * Instagram Login flow. A human copies the right page's id + access_token
 * into FACEBOOK_TEST_PAGE_ID / FACEBOOK_TEST_PAGE_ACCESS_TOKEN in Coolify.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
  if (error) {
    return new NextResponse(`Facebook gaf een fout terug: ${error}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Geen 'code' parameter gevonden in de redirect.", { status: 400 });
  }

  // Deliberately separate from INSTAGRAM_APP_ID/SECRET: those are the
  // Instagram-login product's own app id within the same Meta app
  // container, which Facebook rejected here with "ongeldige app-id" —
  // confirmed live that Facebook Login needs the app's main App ID
  // instead (App settings → Algemeen in the Meta dashboard).
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    return new NextResponse("FACEBOOK_APP_ID / FACEBOOK_APP_SECRET ontbreken in de omgeving.", { status: 500 });
  }

  // Must exactly match what was sent to the Facebook Login authorize
  // dialog — same hardcoding reasoning as the Instagram callback (Coolify's
  // reverse proxy doesn't reliably reflect the public URL in req.nextUrl.origin).
  const redirectUri = "https://marktplaats-vnc.85.190.105.138.sslip.io/api/facebook/oauth/callback";

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`
    );
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      return new NextResponse(`Token-uitwisseling mislukt: ${JSON.stringify(tokenJson)}`, { status: 502 });
    }

    const accountsRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(tokenJson.access_token)}`);
    const accountsJson = await accountsRes.json();
    if (!accountsRes.ok || !accountsJson.data) {
      return new NextResponse(`Pagina's ophalen mislukt: ${JSON.stringify(accountsJson)}`, { status: 502 });
    }

    if (accountsJson.data.length === 0) {
      return new NextResponse("Geen Facebook-pagina's gevonden voor dit account. Is dit account beheerder van de iSelectStore-pagina?", { status: 404 });
    }

    const lines = ["Gelukt! Kies de juiste pagina hieronder en kopieer de twee waarden naar Coolify:", ""];
    for (const page of accountsJson.data) {
      lines.push(`Pagina: ${page.name}`);
      lines.push(`FACEBOOK_TEST_PAGE_ID=${page.id}`);
      lines.push(`FACEBOOK_TEST_PAGE_ACCESS_TOKEN=${page.access_token}`);
      lines.push("");
    }

    return new NextResponse(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Onverwachte fout: ${message}`, { status: 500 });
  }
}
