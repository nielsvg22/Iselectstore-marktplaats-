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
    // Per Marktplaats' feed docs: serve as text/xml, not as a download.
    // The XML prolog and this header both declare ISO-8859-1 — Node's default
    // string->bytes encoding is UTF-8, so without this the declared charset
    // and the actual bytes would silently diverge the moment a title or
    // description contains a Dutch diacritic (ë, ï, ö, …), producing bytes
    // Marktplaats' parser can't decode. feedBuilder.sanitizeText() already
    // strips anything outside Latin-1, so this conversion is always safe.
    const body = Buffer.from(xml, "latin1");
    return new NextResponse(body, { headers: { "Content-Type": "text/xml; charset=ISO-8859-1" } });
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    await logSync({ action: "feed_error", message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
