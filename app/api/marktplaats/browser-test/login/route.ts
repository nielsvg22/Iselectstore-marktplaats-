import { NextRequest, NextResponse } from "next/server";
import { submitLoginCredentials } from "@/lib/marktplaats/browserTest/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marktplaats/browser-test/login  { runId, username, password }
 *
 * Lets the admin UI fill the real Marktplaats login form on behalf of the
 * user, the same way the verification-code field does — so logging in
 * doesn't require switching into the embedded noVNC view. Credentials are
 * never stored: they're read once by the waiting Playwright run and
 * discarded (see takeSubmittedLogin()).
 */
export async function POST(req: NextRequest) {
  const { runId, username, password } = await req
    .json()
    .catch(() => ({}) as { runId?: string; username?: string; password?: string });
  if (!runId || !username || !password) {
    return NextResponse.json({ error: "runId, username en password zijn verplicht" }, { status: 400 });
  }

  const delivered = submitLoginCredentials(runId, username, password);
  if (!delivered) {
    return NextResponse.json({ error: "Deze run wacht niet (meer) op inloggegevens." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
