import { NextRequest, NextResponse } from "next/server";
import { autoPostProductToInstagram } from "@/lib/instagram/autoSync";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Temporary diagnostic: directly (re-)runs the Instagram auto-post for one product ID, bypassing the webhook. */
export async function POST(req: NextRequest) {
  const { password, shopifyProductId } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }
  if (!shopifyProductId) {
    return NextResponse.json({ error: "Ontbrekend shopifyProductId." }, { status: 400 });
  }

  await autoPostProductToInstagram(String(shopifyProductId));

  const rows = await query<{ instagram_media_id: string | null; environment: string; mock: boolean; created_at: string }>(
    "SELECT instagram_media_id, environment, mock, created_at FROM instagram_post WHERE shopify_product_id = $1",
    [String(shopifyProductId)]
  );
  const logs = await query<{ action: string; message: string | null; created_at: string }>(
    "SELECT action, message, created_at FROM marktplaats_sync_log WHERE shopify_product_id = $1 AND action LIKE 'instagram%' ORDER BY created_at DESC LIMIT 5",
    [String(shopifyProductId)]
  );

  return NextResponse.json({ posted: rows[0] ?? null, recentLogs: logs });
}
