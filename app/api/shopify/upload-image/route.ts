import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { uploadShopImage } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

interface UploadImageBody {
  filename: string;
  mimeType: string;
  /** Base64-encoded image bytes. */
  dataBase64: string;
}

/** One-off admin action: uploads an image into the shop's Files library (Content → Files), for use in image_picker theme settings. */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: UploadImageBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.filename || !body.mimeType || !body.dataBase64) {
    return NextResponse.json({ error: "filename, mimeType en dataBase64 zijn verplicht." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(body.dataBase64, "base64");
    const result = await uploadShopImage(buffer, body.filename, body.mimeType);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
