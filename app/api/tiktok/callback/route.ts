import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Completes the TikTok OAuth handshake for the sandbox test account. Shows
 * the resulting access token/open_id directly in the browser response so it
 * can be copied into the TIKTOK_TEST_* env vars — this is a one-time setup
 * step (same pattern as the Instagram integration's manual token paste),
 * not meant to be a permanent storage mechanism.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    return NextResponse.json({ error, error_description: errorDescription }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Ontbrekende code-parameter." }, { status: 400 });
  }

  const clientKey = process.env.TIKTOK_SANDBOX_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    return NextResponse.json({ error: "TIKTOK_SANDBOX_CLIENT_KEY / TIKTOK_SANDBOX_CLIENT_SECRET niet geconfigureerd." }, { status: 500 });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/tiktok/callback`;

  try {
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || tokenJson.error) {
      return NextResponse.json({ error: "Token-uitwisseling mislukt", details: tokenJson }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      open_id: tokenJson.open_id,
      expires_in: tokenJson.expires_in,
      scope: tokenJson.scope,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
