import { NextRequest, NextResponse } from "next/server";
import { createSubscription } from "@/services/inventory/subscriptionService";
import { getProduct } from "@/lib/shopify/client";
import { resolveProductIdentity } from "@/services/shopify/productIdentity";

export const dynamic = "force-dynamic";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function isAllowedOrigin(origin: string | null): boolean {
  // No Origin header = same-origin request or server-to-server call.
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

  // Theme previews and any future shop on the platform all live on *.myshopify.com.
  return /^https:\/\/[^/]+\.myshopify\.com$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const productId = String(body.productId || "").trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Voer een geldig e-mailadres in." },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    let productType = String(body.productType || "").trim();
    let model = String(body.model || "").trim();
    let storage = String(body.storage || "").trim();

    if (productId) {
      // Storefront sends the product id; the backend resolves the identity with
      // the exact same code path used when notifications are matched, so a
      // subscription can never drift from what the notifier looks up later.
      if (!/^\d+$/.test(productId)) {
        return NextResponse.json(
          { error: "Ongeldig product." },
          { status: 400, headers: corsHeaders(origin) }
        );
      }
      const product = await getProduct(productId);
      const identity = await resolveProductIdentity(product);
      productType = identity.productType;
      model = identity.model;
      storage = identity.storage;
    }

    if (!productType || !model) {
      return NextResponse.json(
        { error: "Dit product kon niet worden herkend. Probeer het later opnieuw." },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    await createSubscription({ email, productType, model, storage });
    return NextResponse.json(
      { ok: true, message: "Je ontvangt een melding zodra dit product weer beschikbaar is." },
      { headers: corsHeaders(origin) }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders(origin) });
  }
}
