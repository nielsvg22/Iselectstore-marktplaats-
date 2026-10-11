import { NextRequest, NextResponse } from "next/server";
import { getBrowserTestConfig, isBrowserTestEnabled } from "@/lib/marktplaats/browserTest/config";
import { hasRemoteBrowserTest, proxyToRemoteBrowserTest } from "@/lib/marktplaats/browserTest/remoteProxy";
import { createVncSessionToken, VNC_SESSION_TTL_MS } from "@/lib/marktplaats/browserTest/vncSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marktplaats/browser-test/vnc-session
 *
 * Issues a short-lived (60s), one-time-use opaque token bound server-side to
 * the real VNC_PASSWORD (see lib/marktplaats/browserTest/vncSession.ts). The
 * token itself is returned here — that is fine, it authorizes nothing by
 * itself and carries no password — but the real password never is.
 *
 * The admin panel exchanges this token for the live viewer page at
 *   GET /api/marktplaats/browser-test/vnc-proxy/vnc.html?session=<token>
 * which is the only place the real password ever appears, and only in that
 * response's HTML body (see that route) — never in a URL, never logged,
 * never cached.
 */
export async function POST(req: NextRequest) {
  if (!isBrowserTestEnabled() && hasRemoteBrowserTest()) {
    return proxyToRemoteBrowserTest(req, "/api/marktplaats/browser-test/vnc-session");
  }

  const config = getBrowserTestConfig();
  if (!config.novncPassword) {
    return NextResponse.json(
      { error: "Live weergave is hier niet geconfigureerd (geen VNC_PASSWORD)." },
      { status: 503 }
    );
  }

  const token = createVncSessionToken(config.novncPassword);
  return NextResponse.json(
    { token, expiresInMs: VNC_SESSION_TTL_MS },
    { headers: { "Cache-Control": "no-store" } }
  );
}
