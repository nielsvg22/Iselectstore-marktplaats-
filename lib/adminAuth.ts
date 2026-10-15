import { NextRequest, NextResponse } from "next/server";

/**
 * Shared-secret guard matching the existing pattern used by
 * app/api/inventory/**, app/api/lifecycle/**, app/api/webhooks/register and
 * app/diagnostics — a header `x-admin-password` or `?password=` compared to
 * ADMIN_PANEL_PASSWORD. This is the SAME mechanism, reused rather than
 * reinvented, and is applied here to new GoedGeplaatst WRITE actions
 * (creating a concept advertisement) so they are at least as protected as
 * the rest of the admin surface currently is.
 *
 * NOTE (documented open risk, same as the rest of /app/admin/**): the main
 * Marktplaats admin panel and its existing API routes
 * (app/api/marktplaats/**) have NO access control at all today — this guard
 * does not retrofit that. See MARKTPLAATS_INTEGRATION.md / the task report
 * for this being called out explicitly rather than silently left unaddressed.
 */
export function checkAdminPassword(req: NextRequest): NextResponse | null {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist of ontbrekend admin-wachtwoord." }, { status: 401 });
  }
  return null;
}
