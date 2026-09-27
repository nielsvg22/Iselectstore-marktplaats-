import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/db";

// Authorization-code flow entry point. The exact authorize endpoint path
// (host + path) was not fully resolved from the public doc excerpt we could
// fetch — verify against https://api.marktplaats.nl/docs/v2/authentication.html
// before relying on this in production. Structure (state param, redirect)
// follows standard OAuth2 and the documented token endpoint pattern.
export const dynamic = "force-dynamic";

const AUTHORIZE_BASE = process.env.MARKTPLAATS_ENVIRONMENT === "sandbox" ? "https://auth.demo.qa-mp.so/accounts/oauth/authorize" : "https://auth.marktplaats.nl/accounts/oauth/authorize";

export async function GET() {
  const clientId = process.env.MARKTPLAATS_CLIENT_ID;
  const redirectUri = process.env.MARKTPLAATS_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "MARKTPLAATS_CLIENT_ID / MARKTPLAATS_REDIRECT_URI niet geconfigureerd." }, { status: 400 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  await query("UPDATE marktplaats_connection SET oauth_state = $1 WHERE id = (SELECT id FROM marktplaats_connection ORDER BY id DESC LIMIT 1)", [state]);

  const url = new URL(AUTHORIZE_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
