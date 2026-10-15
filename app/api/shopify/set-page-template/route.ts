import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getPageByHandle, setPageTemplate } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

interface SetPageTemplateBody {
  handle: string;
  templateSuffix: string;
}

/** One-off admin action: assigns a theme template to a Shopify page, looked up by its handle. */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: SetPageTemplateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.handle || !body.templateSuffix) {
    return NextResponse.json({ error: "handle en templateSuffix zijn verplicht." }, { status: 400 });
  }

  try {
    const page = await getPageByHandle(body.handle);
    if (!page) {
      return NextResponse.json({ error: `Geen pagina gevonden met handle "${body.handle}".` }, { status: 404 });
    }
    const updated = await setPageTemplate(page.id, body.templateSuffix);
    return NextResponse.json({ ok: true, page: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
