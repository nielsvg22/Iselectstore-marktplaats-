import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getMainTheme, getThemeAssetContent } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: reads a file straight from the live ("main") Shopify theme, to check whether a GitHub push actually landed there. Read-only. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key query-parameter is verplicht (bv. templates/index.json)." }, { status: 400 });
  }

  try {
    const theme = await getMainTheme();
    const content = await getThemeAssetContent(theme.id, key);
    return NextResponse.json({ theme: { id: theme.id, name: theme.name, role: theme.role }, key, content });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
