import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * TikTok's PULL_FROM_URL media source requires the URL's domain to be a
 * verified property of the TikTok app — confirmed live (403
 * url_ownership_unverified) when passing a raw Shopify CDN image URL
 * (cdn.shopify.com) straight to the Content Posting API, even though we
 * only verified OUR OWN backend domain (see public/tiktok*.txt), not
 * Shopify's CDN, which we don't control.
 *
 * This proxy re-serves a Shopify CDN image from our own (verified) domain
 * so TikTok's pull_by_url check passes. Restricted to cdn.shopify.com /
 * *.myshopify.com hosts only — never an open proxy for arbitrary URLs.
 */
const ALLOWED_HOST_SUFFIXES = [".myshopify.com", "cdn.shopify.com"];

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.replace(/^\./, "") || host.endsWith(suffix));
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Ontbrekende url-parameter." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Ongeldige url." }, { status: 400 });
  }

  if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) {
    return NextResponse.json({ error: "Host niet toegestaan." }, { status: 400 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream-fout (${upstream.status}).` }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
