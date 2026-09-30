import { NextRequest, NextResponse } from "next/server";
import { createSubscription } from "@/services/inventory/subscriptionService";
import { getProduct } from "@/lib/shopify/client";
import { resolveProductIdentity } from "@/services/shopify/productIdentity";
import { consumeRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Rejects oversized bodies before we even try to parse them. */
const MAX_BODY_BYTES = 8 * 1024;

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_IP = Number(process.env.INVENTORY_SUBSCRIBE_RATE_IP || 20);
const RATE_LIMIT_PER_EMAIL = Number(process.env.INVENTORY_SUBSCRIBE_RATE_EMAIL || 10);

/** Pragmatic RFC-5322 subset: local@domain.tld, no spaces, no consecutive dots. */
function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  if (email.includes("..")) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

/** Collects the hostnames the storefront may call us from. `www.` is ignored. */
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
  // Live storefront domain (custom domain) — ook bron van de product-URL in de mail.
  add(process.env.SHOPIFY_STOREFRONT_URL);
  add(process.env.SHOPIFY_STORE_DOMAIN);
  for (const extra of (process.env.CORS_ORIGINS || "").split(",")) add(extra);
  return hosts;
}

function isAllowedOrigin(origin: string | null): boolean {
  // No Origin header = same-origin request or server-to-server call.
  if (!origin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;

  const host = url.hostname.replace(/^www\./, "");
  // Theme previews and any future shop on the platform all live on *.myshopify.com.
  if (/^[a-z0-9-]+\.myshopify\.com$/.test(host)) return true;

  return allowedHostnames().has(host);
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

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function fail(origin: string | null, status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return fail(origin, 413, "error", "Verzoek is te groot.");
  }

  const ip = clientIp(req);
  const ipLimit = consumeRateLimit(`subscribe:ip:${ip}`, RATE_LIMIT_PER_IP, RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    const headers = { ...corsHeaders(origin), "Retry-After": String(ipLimit.retryAfterSeconds) };
    return NextResponse.json(
      { error: "Te veel aanmeldingen. Probeer het later opnieuw.", code: "rate_limited" },
      { status: 429, headers }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(origin, 400, "error", "Ongeldige aanvraag.");
  }
  if (!body || typeof body !== "object") {
    return fail(origin, 400, "error", "Ongeldige aanvraag.");
  }

  try {
    const email = String(body.email || "").trim().toLowerCase();
    const productId = String(body.productId || "").trim();

    if (!email || !isValidEmail(email)) {
      return fail(origin, 400, "invalid_email", "Voer een geldig e-mailadres in.");
    }

    const emailLimit = consumeRateLimit(`subscribe:email:${email}`, RATE_LIMIT_PER_EMAIL, RATE_WINDOW_MS);
    if (!emailLimit.allowed) {
      const headers = { ...corsHeaders(origin), "Retry-After": String(emailLimit.retryAfterSeconds) };
      return NextResponse.json(
        { error: "Te veel aanmeldingen voor dit e-mailadres. Probeer het later opnieuw.", code: "rate_limited" },
        { status: 429, headers }
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
        return fail(origin, 400, "invalid_product", "Ongeldig product.");
      }
      let product;
      try {
        product = await getProduct(productId);
      } catch {
        return fail(origin, 400, "invalid_product", "Ongeldig product.");
      }
      if (!product) {
        return fail(origin, 400, "invalid_product", "Ongeldig product.");
      }
      const identity = await resolveProductIdentity(product);
      productType = identity.productType;
      model = identity.model;
      storage = identity.storage;
    }

    if (!productType || !model) {
      return fail(origin, 400, "unrecognized_product", "Dit product kon niet worden herkend. Probeer het later opnieuw.");
    }

    const { created } = await createSubscription({ email, productType, model, storage });

    if (!created) {
      return NextResponse.json(
        {
          ok: true,
          code: "already_subscribed",
          message: "Je staat al op de lijst voor dit model.",
        },
        { headers: corsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { ok: true, code: "ok", message: "Je ontvangt een melding zodra dit product weer beschikbaar is." },
      { headers: corsHeaders(origin) }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inventory-subscribe]", message);
    return NextResponse.json({ error: "Er ging iets mis. Probeer het later opnieuw.", code: "error" }, { status: 500, headers: corsHeaders(origin) });
  }
}
