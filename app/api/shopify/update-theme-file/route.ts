import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getMainTheme, setThemeAssetContent } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

interface UpdateThemeFileBody {
  key: string;
  content: string;
}

/**
 * One-off fix: writes a file straight onto the live ("main") Shopify theme.
 * Used when the GitHub→Shopify theme sync lags behind for a specific file —
 * confirmed live-case: templates/index.json doesn't auto-sync (Shopify is
 * cautious about overwriting JSON templates that may have been edited
 * through the theme customizer), while plain .liquid/.css files do.
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: UpdateThemeFileBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.key || body.content == null) {
    return NextResponse.json({ error: "key en content zijn verplicht." }, { status: 400 });
  }

  try {
    const theme = await getMainTheme();
    await setThemeAssetContent(theme.id, body.key, body.content);
    return NextResponse.json({ ok: true, theme: { id: theme.id, name: theme.name } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
