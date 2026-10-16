import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getMainTheme, listThemeAssets } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: lists every file key in the live ("main") Shopify theme, to find what diverged from the GitHub-synced copy. Read-only. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  try {
    const theme = await getMainTheme();
    const assets = await listThemeAssets(theme.id);
    return NextResponse.json({ theme: { id: theme.id, name: theme.name, role: theme.role }, assets });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
