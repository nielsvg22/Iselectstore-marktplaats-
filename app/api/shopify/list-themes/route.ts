import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { listThemes } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: lists all themes (id, name, role) to check which one is actually live/published. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  try {
    const themes = await listThemes();
    return NextResponse.json({ themes });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
