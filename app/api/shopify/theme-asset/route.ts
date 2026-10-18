import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getMainTheme, getThemeAssetContent } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: fetches a raw theme asset's live content, to compare against git. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key ontbreekt" }, { status: 400 });
  try {
    const theme = await getMainTheme();
    const content = await getThemeAssetContent(theme.id, key);
    return new NextResponse(content, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
