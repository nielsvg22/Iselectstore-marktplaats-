// Relay between the Shopify Admin Action extension's open "nieuw product"
// form and the full-page AI-photo recognition on /admin/quick-create — see
// services/shopify/quickCreateDraftService.ts for why this exists.
//
// POST: called from the Vercel page itself (same-origin, no extension
// id-token) every time AI-recognized fields get applied there.
// GET: called from the extension (id-token authenticated, like the other
// /api/shopify/* endpoints) to pull the draft back into the open form.
import { NextRequest, NextResponse } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { getQuickCreateDraft, saveQuickCreateDraft, DraftImage } from "@/services/shopify/quickCreateDraftService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleExtensionOptions(req);
}

export async function POST(req: NextRequest) {
  let body: { draftId?: string; productType?: string; values?: Record<string, string>; images?: DraftImage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige request body." }, { status: 400 });
  }

  const { draftId, productType, values, images } = body;
  if (!draftId || !productType || !values) {
    return NextResponse.json({ error: "draftId, productType en values zijn verplicht." }, { status: 400 });
  }

  await saveQuickCreateDraft(draftId, productType, values, images ?? []);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;

  const draftId = req.nextUrl.searchParams.get("draftId");
  if (!draftId) {
    return NextResponse.json({ error: "draftId is verplicht." }, { status: 400, headers: auth.headers });
  }

  const draft = await getQuickCreateDraft(draftId);
  return NextResponse.json({ draft }, { headers: auth.headers });
}
