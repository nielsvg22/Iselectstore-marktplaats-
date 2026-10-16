// Uitloggen: sessie-cookie wissen en (als er een id_token is) Shopify's
// end_session_endpoint afronden zodat de SSO-sessie ook daar stopt.
import { NextRequest, NextResponse } from "next/server";
import { discoverOpenId, getSession, sessionClearCookies } from "@/lib/customerAccount";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const session = getSession();
  const sessionLived = Boolean(session);
  let endSession: string | undefined;
  let idToken: string | undefined;
  try {
    const cfg = await discoverOpenId();
    endSession = cfg.end_session_endpoint;
    idToken = session?.i;
  } catch {
    // discovery-fout: cookies wissen is de belangrijkste stap.
  }

  await logSync({ action: "portaal_logout", message: `session=${sessionLived}` });

  const target = endSession
    ? (() => {
        const u = new URL(endSession);
        u.searchParams.set("post_logout_redirect_uri", `${origin}/portaal`);
        if (idToken) u.searchParams.set("id_token_hint", idToken);
        return u.toString();
      })()
    : `${origin}/portaal`;

  const res = NextResponse.redirect(target);
  for (const c of sessionClearCookies()) {
    res.cookies.set(c.name, c.value, { maxAge: c.maxAge, path: "/", httpOnly: true, sameSite: "lax", secure: true });
  }
  return res;
}
