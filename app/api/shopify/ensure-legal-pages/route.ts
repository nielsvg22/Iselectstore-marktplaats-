import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { checkAdminPassword } from "@/lib/adminAuth";
import {
  getPageByHandle,
  createPage,
  updatePage,
  getShopPolicies,
  updateShopPolicy,
} from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

// Body is read from disk (not a JS string literal) so the exact UTF-8 bytes
// (em-dashes, "é", curly quotes, "€") reach Shopify unchanged — no
// copy/paste or re-typing step that could mangle them.
function readContent(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "lib/legalPages", file), "utf8");
}

// A policy/page is only treated as "already has real content" past this
// length, so a blank or placeholder-only field still gets filled in.
const MIN_EXISTING_LENGTH = 200;

/**
 * One-off: publishes draft content (sourced from bestbuyphone.nl, adapted to
 * iSelectStore branding, with [TER CONTROLE] markers on unconfirmed company
 * data — see the noteBox at the top of each page) for:
 *  - Algemene voorwaarden -> Shopify's built-in Terms of service policy
 *    (so it appears automatically in the footer via shop.policies, no
 *    separate page needed).
 *  - Klachtenprocedure -> a standalone Page (handle: klachtenprocedure),
 *    since Shopify has no built-in policy type for this.
 * Never overwrites existing content longer than MIN_EXISTING_LENGTH —
 * reports what it found instead, per "overschrijf geen bestaande pagina's
 * die al goed functioneren".
 */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  const result: Record<string, unknown> = {};

  try {
    // --- Algemene voorwaarden -> Terms of service policy ---
    const policies = await getShopPolicies();
    const terms = policies.find((p) => p.type === "TERMS_OF_SERVICE");
    const termsLen = (terms?.body || "").replace(/<[^>]+>/g, "").trim().length;
    if (termsLen >= MIN_EXISTING_LENGTH) {
      result.algemeneVoorwaarden = {
        action: "skipped",
        reason: `Bestaande 'Verkoopvoorwaarden'-policy heeft al ${termsLen} tekens inhoud — niet overschreven.`,
        url: terms?.url,
      };
    } else {
      const bodyHtml = readContent("algemene-voorwaarden.html");
      const updated = await updateShopPolicy("TERMS_OF_SERVICE", bodyHtml);
      result.algemeneVoorwaarden = { action: "published", url: updated.url };
    }

    // --- Klachtenprocedure -> standalone page ---
    const existingPage = await getPageByHandle("klachtenprocedure");
    const pageLen = (existingPage?.body_html || "").replace(/<[^>]+>/g, "").trim().length;
    if (existingPage && pageLen >= MIN_EXISTING_LENGTH) {
      result.klachtenprocedure = {
        action: "skipped",
        reason: `Bestaande pagina heeft al ${pageLen} tekens inhoud — niet overschreven.`,
        id: existingPage.id,
      };
    } else {
      const bodyHtml = readContent("klachtenprocedure.html");
      if (existingPage) {
        const updated = await updatePage(existingPage.id, { bodyHtml, title: "Klachtenprocedure" });
        result.klachtenprocedure = { action: "updated (was leeg/kort)", id: updated.id };
      } else {
        const created = await createPage("Klachtenprocedure", "klachtenprocedure", undefined, bodyHtml);
        result.klachtenprocedure = { action: "created", id: created.id };
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
