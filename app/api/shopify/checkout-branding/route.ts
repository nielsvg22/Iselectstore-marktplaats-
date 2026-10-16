import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getCheckoutProfiles, setCheckoutLogo } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** GET: lists checkout profiles (diagnostic). POST { logoUrl, imageId? }: sets the checkout header logo from an already-uploaded shop file. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  try {
    const profiles = await getCheckoutProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  let body: { mediaImageId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.mediaImageId) {
    return NextResponse.json({ error: "mediaImageId is verplicht." }, { status: 400 });
  }
  try {
    const result = await setCheckoutLogo(body.mediaImageId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
