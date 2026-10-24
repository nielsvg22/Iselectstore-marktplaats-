import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createPurchaseDeclaration } from "@/services/purchaseDeclarations/purchaseDeclarationService";
import { buildPurchaseDeclarationEmailHtml } from "@/services/purchaseDeclarations/purchaseDeclarationEmail";
import { generateInkoopverklaringPdf } from "@/lib/pdf/inkoopverklaringPdf";
import { createEmailProvider } from "@/services/notifications/emailProviderFactory";
import { consumeRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 400 * 1024; // signature data URL makes this bigger than other forms
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_IP = Number(process.env.INVENTORY_SUBSCRIBE_RATE_IP || 20);

function isValidEmail(email: string): boolean {
  if (!email) return true; // optional field
  if (email.length > 254) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  return true;
}

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
    return fail(origin, 413, "too_large", "Aanvraag te groot.");
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimit = consumeRateLimit(`inkoopverklaring:ip:${ip}`, RATE_LIMIT_PER_IP, RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    const headers = { ...corsHeaders(origin), "Retry-After": String(ipLimit.retryAfterSeconds) };
    return NextResponse.json({ error: "Te veel aanmeldingen. Probeer het later opnieuw.", code: "rate_limited" }, { status: 429, headers });
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

  const voornaam = String(body.voornaam || "").trim();
  const achternaam = String(body.achternaam || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const adres = String(body.adres || "").trim();
  const postcode = String(body.postcode || "").trim();
  const woonplaats = String(body.woonplaats || "").trim();
  const datumVerkoop = String(body.datumVerkoop || "").trim();
  const product = String(body.product || "").trim();
  const bedrag = Number(body.bedrag);
  const verklaringEigenaar = Boolean(body.verklaringEigenaar);
  const verklaringAbonnement = Boolean(body.verklaringAbonnement);
  const verklaringThuiskopie = Boolean(body.verklaringThuiskopie);
  const handtekening = String(body.handtekening || "");

  if (!voornaam || !achternaam || !adres || !postcode || !woonplaats || !product) {
    return fail(origin, 400, "missing_fields", "Vul alle verplichte velden in.");
  }
  if (!isValidEmail(email)) {
    return fail(origin, 400, "invalid_email", "Voer een geldig e-mailadres in.");
  }
  if (!datumVerkoop || Number.isNaN(Date.parse(datumVerkoop))) {
    return fail(origin, 400, "invalid_date", "Voer een geldige datum in.");
  }
  if (!Number.isFinite(bedrag) || bedrag <= 0) {
    return fail(origin, 400, "invalid_amount", "Voer een geldig bedrag in.");
  }
  if (!verklaringEigenaar || !verklaringAbonnement || !verklaringThuiskopie) {
    return fail(origin, 400, "declarations_required", "Alle verklaringen moeten worden geaccepteerd.");
  }
  if (!handtekening || !handtekening.startsWith("data:image/")) {
    return fail(origin, 400, "signature_required", "Handtekening ontbreekt.");
  }

  try {
    const declaration = await createPurchaseDeclaration({
      voornaam,
      achternaam,
      email,
      adres,
      postcode,
      woonplaats,
      datumVerkoop,
      product,
      bedrag,
      verklaringEigenaar,
      verklaringAbonnement,
      verklaringThuiskopie,
      handtekening,
    });

    // Best-effort: the declaration is already saved, so a mail hiccup here
    // must never turn a successful submission into an error response.
    if (email) {
      try {
        const pdfBytes = await generateInkoopverklaringPdf(declaration);
        const { subject, html, text } = buildPurchaseDeclarationEmailHtml(declaration);
        const logoBytes = fs.readFileSync(path.join(process.cwd(), "lib/pdf/assets/iselectstore-logo-white.png"));
        const provider = createEmailProvider();
        const sendResult = await provider.send({
          to: email,
          subject,
          html,
          text,
          attachments: [
            {
              filename: `inkoopverklaring-${declaration.id}.pdf`,
              content: Buffer.from(pdfBytes),
              contentType: "application/pdf",
            },
            {
              filename: "iselectstore-logo.png",
              content: logoBytes,
              contentType: "image/png",
              contentId: "iselectstore-logo",
            },
          ],
        });
        if (!sendResult.ok) {
          console.error("[inkoopverklaring-submit] bevestigingsmail mislukt:", sendResult.error);
        }
      } catch (mailErr) {
        console.error("[inkoopverklaring-submit] bevestigingsmail mislukt:", mailErr instanceof Error ? mailErr.message : mailErr);
      }
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inkoopverklaring-submit]", message);
    return fail(origin, 500, "error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
