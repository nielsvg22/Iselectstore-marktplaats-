// Start Customer Account API-login (PKCE). Een bestaande geldige sessie
// gaat rechtstreeks door naar /portaal (of de diepe link die de bezoeker
// opvroeg).
import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, getSession, safeFwd } from "@/lib/customerAccount";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const fwd = safeFwd(req.nextUrl.searchParams.get("fwd"));
  const origin = req.nextUrl.origin;

  const session = getSession();
  if (session) return NextResponse.redirect(`${origin}${fwd || "/portaal"}`);

  try {
    const { url, setCookies } = await buildAuthorizeUrl(origin, fwd);
    const res = NextResponse.redirect(url);
    for (const c of setCookies) res.cookies.set(c.name, c.value, { maxAge: c.maxAge, path: "/", httpOnly: true, sameSite: "lax", secure: true });
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/portaal/inloggen/fout?m=discover`);
  }
}
