import { NextRequest, NextResponse } from "next/server";
import { runDueSoldImageJobs } from "@/lib/soldImage/soldImageService";
import { runCleanup } from "@/services/catalog/lifecycleService";
import { getInstagramAccessToken } from "@/lib/instagram/tokenService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  if (expected && auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [soldImageResult, cleanupResult] = await Promise.all([runDueSoldImageJobs(), runCleanup(28)]);

    // Safety net for lib/instagram/tokenService.ts's otherwise-lazy refresh:
    // without this, a quiet stretch of 20+ days with no product create/update
    // webhook would mean nothing ever calls getInstagramAccessToken to trigger
    // the refresh. Runs daily regardless, best-effort — the service itself
    // no-ops when the token isn't close to expiry yet.
    const instagramTokenResult = await Promise.allSettled([getInstagramAccessToken("test"), getInstagramAccessToken("production")]);

    return NextResponse.json({ ok: true, soldImage: soldImageResult, cleanup: cleanupResult, instagramTokenChecked: instagramTokenResult.map((r) => r.status) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
