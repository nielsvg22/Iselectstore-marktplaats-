// OAuth-callback van Shopify: staat/verifier valideren, code omruilen voor
// een Customer Account API-token, sessie-cookie zetten en doorverwijzen.
import { NextRequest, NextResponse } from "next/server";
import {
  CaAuthError,
  consumePending,
  exchangeCode,
  safeFwd,
  sessionSetCookies,
} from "@/lib/customerAccount";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

function fout(origin: string, m: string) {
  return NextResponse.redirect(`${origin}/portaal/inloggen/fout?m=${encodeURIComponent(m)}`);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  const pending = consumePending();

  if (oauthError) {
    await logSync({ action: "portaal_login_error", message: `error=${oauthError} desc=${req.nextUrl.searchParams.get("error_description") || ""}` });
    return fout(origin, "geweigerd");
  }
  if (!pending || !code || !state || state !== pending.st) {
    await logSync({ action: "portaal_login_error", message: `state-mismatch pending=${Boolean(pending)} code=${Boolean(code)}` });
    return fout(origin, "state");
  }

  try {
    const session = await exchangeCode(origin, code, pending.v);
    const res = NextResponse.redirect(`${origin}${safeFwd(pending.f) || "/portaal"}`);
    for (const c of sessionSetCookies(session)) {
      res.cookies.set(c.name, c.value, { maxAge: c.maxAge, path: "/", httpOnly: true, sameSite: "lax", secure: true });
    }
    await logSync({ action: "portaal_login_ok" });
    return res;
  } catch (err) {
    const message = err instanceof CaAuthError ? err.message : err instanceof Error ? err.message : String(err);
    await logSync({ action: "portaal_login_error", message });
    return fout(origin, "token");
  }
}
