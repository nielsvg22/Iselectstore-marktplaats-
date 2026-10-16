import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getShopDomainInfo } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: the shop's connected domain(s), to know which domain to verify for outgoing email. Read-only. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  try {
    const info = await getShopDomainInfo();
    return NextResponse.json(info);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
