import { NextRequest, NextResponse } from "next/server";
import { requestStop } from "@/lib/marktplaats/browserTest/status";
import { isBrowserTestEnabled } from "@/lib/marktplaats/browserTest/config";
import { hasRemoteBrowserTest, proxyToRemoteBrowserTest } from "@/lib/marktplaats/browserTest/remoteProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marktplaats/browser-test/stop  { runId }
 *
 * Kills a stuck or unwanted run (stuck on manual login, a 2FA wait, or any
 * other step) and closes its browser, so a new test can start right away —
 * without redeploying the Coolify app just to reset the in-memory run state.
 */
export async function POST(req: NextRequest) {
  if (!isBrowserTestEnabled() && hasRemoteBrowserTest()) {
    return proxyToRemoteBrowserTest(req, "/api/marktplaats/browser-test/stop");
  }

  const { runId } = await req.json().catch(() => ({}) as { runId?: string });
  if (!runId) {
    return NextResponse.json({ error: "runId is verplicht" }, { status: 400 });
  }

  const stopped = requestStop(runId);
  if (!stopped) {
    return NextResponse.json({ error: "Deze run draait niet (meer)." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
