import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getDeliveryProfiles } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: lists delivery profiles/zones/rates, to see what shipping setup already exists before changing anything. Read-only. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  try {
    const profiles = await getDeliveryProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
