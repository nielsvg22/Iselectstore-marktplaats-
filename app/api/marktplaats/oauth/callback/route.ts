import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { exchangeAuthorizationCode } from "@/lib/marktplaats/apiClient";
import { saveUserToken } from "@/lib/marktplaats/connectionService";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Ontbrekende code of state parameter." }, { status: 400 });
  }

  const rows = await query<{ oauth_state: string | null }>("SELECT oauth_state FROM marktplaats_connection ORDER BY id DESC LIMIT 1");
  if (rows[0]?.oauth_state !== state) {
    return NextResponse.json({ error: "State mismatch — mogelijke CSRF, opnieuw koppelen." }, { status: 400 });
  }

  const clientId = process.env.MARKTPLAATS_CLIENT_ID;
  const clientSecret = process.env.MARKTPLAATS_CLIENT_SECRET;
  const redirectUri = process.env.MARKTPLAATS_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Marktplaats credentials niet geconfigureerd." }, { status: 400 });
  }

  try {
    const token = await exchangeAuthorizationCode(clientId, clientSecret, code, redirectUri);
    await saveUserToken({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresInSeconds: token.expires_in,
      scope: token.scope,
    });
    await logSync({ action: "oauth_connected", apiOperation: "authorization_code" });
    return NextResponse.redirect(new URL("/admin?connected=1", req.url));
  } catch (err) {
    await logSync({ action: "oauth_error", message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
