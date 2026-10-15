import { NextRequest, NextResponse } from "next/server";
import { submitVerificationCode } from "@/lib/marktplaats/browserTest/status";
import { isBrowserTestEnabled } from "@/lib/marktplaats/browserTest/config";
import { hasRemoteBrowserTest, proxyToRemoteBrowserTest } from "@/lib/marktplaats/browserTest/remoteProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marktplaats/browser-test/code  { runId, code }
 *
 * Hands a Marktplaats verification code (SMS/e-mail 2FA) typed into the
 * admin UI to the waiting Playwright run, which fills it into the real
 * browser itself — so a phone user never has to switch into the embedded
 * noVNC view to type it.
 */
export async function POST(req: NextRequest) {
  if (!isBrowserTestEnabled() && hasRemoteBrowserTest()) {
    return proxyToRemoteBrowserTest(req, "/api/marktplaats/browser-test/code");
  }

  const { runId, code } = await req.json().catch(() => ({}) as { runId?: string; code?: string });
  if (!runId || !code || !code.trim()) {
    return NextResponse.json({ error: "runId en code zijn verplicht" }, { status: 400 });
  }

  const delivered = submitVerificationCode(runId, code);
  if (!delivered) {
    return NextResponse.json(
      { error: "Deze run wacht niet (meer) op een verificatiecode." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
