import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getPageByHandle, createPage, updatePage } from "@/lib/shopify/client";

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
 * data — see the noteBox at the top of each page) as two standalone Pages:
 *  - Algemene voorwaarden (handle: algemene-voorwaarden)
 *  - Klachtenprocedure (handle: klachtenprocedure)
 *
 * Both use Pages rather than Shopify's built-in policy fields: the app's
 * current OAuth scopes don't include read_legal_policies/write_legal_policies
 * (confirmed live — GraphQL shopPolicies/shopPolicyUpdate both come back
 * ACCESS_DENIED), and granting that needs a merchant re-authorization this
 * route can't trigger on its own. A Page works with the scopes already
 * granted (write_content, used by the existing ensure-battery-page route).
 *
 * Never overwrites existing content longer than MIN_EXISTING_LENGTH —
 * reports what it found instead, per "overschrijf geen bestaande pagina's
 * die al goed functioneren".
 */
async function ensurePage(handle: string, title: string, contentFile: string) {
  const existingPage = await getPageByHandle(handle);
  const pageLen = (existingPage?.body_html || "").replace(/<[^>]+>/g, "").trim().length;
  if (existingPage && pageLen >= MIN_EXISTING_LENGTH) {
    return {
      action: "skipped",
      reason: `Bestaande pagina heeft al ${pageLen} tekens inhoud — niet overschreven.`,
      id: existingPage.id,
      handle,
    };
  }
  const bodyHtml = readContent(contentFile);
  if (existingPage) {
    const updated = await updatePage(existingPage.id, { bodyHtml, title });
    return { action: "updated (was leeg/kort)", id: updated.id, handle: updated.handle };
  }
  const created = await createPage(title, handle, undefined, bodyHtml);
  return { action: "created", id: created.id, handle: created.handle };
}

// Read-only diagnostic (?check=1): returns the live body_html as actually
// stored by Shopify, so encoding issues (mangled é/–/€, double-escaped
// entities) can be verified against the real bytes, not just this route's
// own optimistic response.
async function checkPages() {
  const handles = ["algemene-voorwaarden", "klachtenprocedure"];
  const pages = await Promise.all(handles.map((h) => getPageByHandle(h)));
  return handles.reduce<Record<string, unknown>>((acc, handle, i) => {
    const page = pages[i];
    if (!page) {
      acc[handle] = { found: false };
      return acc;
    }
    const html = page.body_html || "";
    acc[handle] = {
      found: true,
      length: html.length,
      hasReplacementChar: html.includes("�"),
      hasDoubleEncodedEntities: /Ã[\x80-\xBF]|â€/.test(html),
      first300: html.slice(0, 300),
    };
    return acc;
  }, {});
}

export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  if (req.nextUrl.searchParams.get("check")) {
    try {
      return NextResponse.json({ ok: true, pages: await checkPages() });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
    }
  }

  try {
    const algemeneVoorwaarden = await ensurePage(
      "algemene-voorwaarden",
      "Algemene voorwaarden",
      "algemene-voorwaarden.html"
    );
    const klachtenprocedure = await ensurePage(
      "klachtenprocedure",
      "Klachtenprocedure",
      "klachtenprocedure.html"
    );
    return NextResponse.json({ ok: true, result: { algemeneVoorwaarden, klachtenprocedure } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
