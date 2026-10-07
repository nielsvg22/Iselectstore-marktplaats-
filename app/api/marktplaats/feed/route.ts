import { NextRequest, NextResponse } from "next/server";
import { buildFeedXml } from "@/lib/marktplaats/feedBuilder";
import { logSync, humanizeError } from "@/lib/logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/marktplaats/feed[?token=...]
 *
 * The XML feed Marktplaats Zakelijk/Admarkt polls once a day (paste this
 * URL into the "Feed" page shown in the Marktplaats Zakelijk dashboard).
 * Optionally gated by MARKTPLAATS_FEED_TOKEN so the catalog/pricing feed
 * isn't trivially scrapeable by anyone who finds the URL — omit the env var
 * to serve it openly.
 */
export async function GET(req: NextRequest) {
  const requiredToken = process.env.MARKTPLAATS_FEED_TOKEN;
  if (requiredToken && req.nextUrl.searchParams.get("token") !== requiredToken) {
    return NextResponse.json({ error: "Ongeldig of ontbrekend token." }, { status: 403 });
  }

  try {
    const { xml, included, skipped } = await buildFeedXml();
    await logSync({
      action: "feed_generated",
      apiOperation: "GET /api/marktplaats/feed",
      message: `${included} advertenties, ${skipped.length} overgeslagen`,
    });
    if (req.nextUrl.searchParams.get("debug") === "1") {
      return NextResponse.json({ included, skipped });
    }
    // Per https://ecg-icas.github.io/icas/doc/prod/feeds.html#file-format
    // ("Feeds are expected to be in UTF-8 encoding"): serve as text/xml with
    // charset=UTF-8, matching the XML prolog. Node's default string->bytes
    // encoding for a plain string response is already UTF-8, so no manual
    // Buffer conversion is needed here (unlike the ISO-8859-1 this replaces).
    return new NextResponse(xml, { headers: { "Content-Type": "text/xml; charset=UTF-8" } });
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    await logSync({ action: "feed_error", message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
