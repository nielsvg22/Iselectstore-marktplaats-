import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getPageByHandle, createPage, setPageTemplate } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/**
 * One-off: creates the "Batterijconditie" page (handle: batterijconditie) if it
 * doesn't exist yet, and points it at the battery-info theme template, so the
 * "Bekijk de volledige uitleg" link in the product-page popup has somewhere to go.
 */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  try {
    let page = await getPageByHandle("batterijconditie");
    if (!page) {
      page = await createPage("Batterijconditie", "batterijconditie", "batterijconditie");
    } else if (page.template_suffix !== "batterijconditie") {
      page = await setPageTemplate(page.id, "batterijconditie");
    }
    return NextResponse.json({ page });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
