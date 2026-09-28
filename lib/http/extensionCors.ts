// CORS for the Admin UI extension endpoints. The extension runs inside
// Shopify admin iframes, so requests are cross-origin and preflighted
// (Authorization: Bearer <id-token> triggers OPTIONS). Origins are matched
// against the app/store plus the Shopify domains admin extensions render on;
// everything else gets no CORS header and is blocked by the browser.
import { NextRequest, NextResponse } from "next/server";

const SHOPIFY_ORIGIN_RE =
  /^https:\/\/([a-z0-9-]+\.)(myshopify\.com|shopify\.com|shopifycloud\.com|shopifydev\.com)$/i;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function isAllowedExtensionOrigin(origin: string | null): boolean {
  // No Origin = same-origin or server-to-server call.
  if (!origin) return true;

  const allowed = new Set<string>();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) allowed.add(normalizeOrigin(appUrl));
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  if (storeDomain) allowed.add(`https://${storeDomain}`);
  for (const extra of (process.env.CORS_ORIGINS || "").split(",")) {
    if (extra.trim()) allowed.add(normalizeOrigin(extra));
  }
  if (allowed.has(normalizeOrigin(origin))) return true;

  return SHOPIFY_ORIGIN_RE.test(origin);
}

export function extensionCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedExtensionOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

export function handleExtensionOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders(req.headers.get("origin")),
  });
}
