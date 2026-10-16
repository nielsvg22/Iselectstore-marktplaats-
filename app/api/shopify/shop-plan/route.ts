import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getShopPlan } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off diagnostic: the shop's plan name, to know exactly what Shopify features are/aren't available. Read-only. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;
  try {
    const plan = await getShopPlan();
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
