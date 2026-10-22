import { NextRequest, NextResponse } from "next/server";
import { listProducts } from "@/lib/shopify/client";
import { resolveProductIdentity, genericizeModel } from "@/services/shopify/productIdentity";
import { ShopifyProductType } from "@/lib/templates/types";

// Only the device types iSelectStore actually tracks per-product (see
// FIELD_LIBRARY/ShopifyProductType) are notify-worthy — the catalog also
// has accessories (kabels, hoesjes, screenprotectors, adapters) with a
// free-text product_type that was never meant to anchor a restock signup.
const DEVICE_TYPES = new Set<ShopifyProductType>(["iPhone", "iPad", "MacBook", "iMac", "Mac mini", "Apple Watch"]);

export const dynamic = "force-dynamic";

/**
 * Powers the footer's "notify me when a model is back in stock" signup,
 * which (unlike snippets/inventory-notification-form.liquid on a product
 * page) has no product to resolve an identity from — the visitor has to
 * pick a product type + model themselves. Those picks must match the exact
 * strings resolveProductIdentity() would produce for a real product
 * (normalizeModel only collapses whitespace, it never fuzzy-matches), so
 * this returns the real, currently-known {productType, model} pairs from
 * the catalog instead of a free-text field or a hand-maintained list.
 *
 * Storage is NOT resolved here: the storefront offers the same fixed
 * storage list used everywhere else (lib/templates/types.ts FIELD_LIBRARY
 * .storage_gb on the admin side) — a subscription for a combination that
 * has never existed is harmless, it simply never matches a real product.
 */

interface CacheEntry {
  expiresAt: number;
  pairs: { productType: string; model: string }[];
}

let cache: CacheEntry | null = null;
const TTL_MS = 10 * 60 * 1000;

function allowedHostnames(): Set<string> {
  const hosts = new Set<string>();
  const add = (value?: string) => {
    if (!value) return;
    const raw = value.trim();
    if (!raw) return;
    try {
      const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
      const host = url.hostname.replace(/^www\./, "");
      if (host) hosts.add(host);
    } catch {
      /* ignore unparsable config */
    }
  };
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.SHOPIFY_STOREFRONT_URL);
  add(process.env.SHOPIFY_STORE_DOMAIN);
  for (const extra of (process.env.CORS_ORIGINS || "").split(",")) add(extra);
  return hosts;
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  const host = url.hostname.replace(/^www\./, "");
  if (/^[a-z0-9-]+\.myshopify\.com$/.test(host)) return true;
  return allowedHostnames().has(host);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    if (!cache || cache.expiresAt < Date.now()) {
      const products = await listProducts(250);
      const seen = new Set<string>();
      const pairs: { productType: string; model: string }[] = [];
      for (const product of products) {
        const identity = await resolveProductIdentity(product);
        if (!DEVICE_TYPES.has(identity.productType as ShopifyProductType)) continue;
        if (!identity.productType || !identity.model) continue;
        const genericModel = genericizeModel(identity.model);
        if (!genericModel) continue;
        const key = `${identity.productType}|${genericModel}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ productType: identity.productType, model: genericModel });
      }
      pairs.sort((a, b) => a.productType.localeCompare(b.productType) || a.model.localeCompare(b.model));
      cache = { expiresAt: Date.now() + TTL_MS, pairs };
    }
    return NextResponse.json({ ok: true, models: cache.pairs }, { headers: corsHeaders(origin) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inventory-models]", message);
    return NextResponse.json({ error: "Er ging iets mis.", code: "error" }, { status: 500, headers: corsHeaders(origin) });
  }
}
