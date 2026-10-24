import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getPageByHandle, createPage, setPageTemplate } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

const HANDLE = "verkoop-aanmelden";
const TITLE = "Verkoop aanmelden";
const TEMPLATE_SUFFIX = "verkoop-aanmelden"; // templates/page.verkoop-aanmelden.json

/**
 * One-off: ensures the "Verkoop aanmelden" Page exists and renders with
 * templates/page.verkoop-aanmelden.json (the sell-declaration section).
 * Idempotent — safe to call again; only fixes the template assignment if it
 * drifted, never touches body_html (the page's content lives entirely in the
 * section, same pattern as the FAQ page).
 */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  try {
    const existing = await getPageByHandle(HANDLE);
    if (existing) {
      if (existing.template_suffix !== TEMPLATE_SUFFIX) {
        const updated = await setPageTemplate(existing.id, TEMPLATE_SUFFIX);
        return NextResponse.json({ ok: true, action: "template_fixed", id: updated.id, handle: updated.handle });
      }
      return NextResponse.json({ ok: true, action: "already_exists", id: existing.id, handle: existing.handle });
    }

    const created = await createPage(TITLE, HANDLE, TEMPLATE_SUFFIX);
    return NextResponse.json({ ok: true, action: "created", id: created.id, handle: created.handle });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
