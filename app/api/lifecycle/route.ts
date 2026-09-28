import { NextRequest, NextResponse } from "next/server";
import { getProductsDueForUnpublish, getLifecycleState } from "@/services/catalog/lifecycleService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const productId = req.nextUrl.searchParams.get("productId");
    if (productId) {
      const state = await getLifecycleState(productId);
      return NextResponse.json({ state });
    }

    const due = await getProductsDueForUnpublish(28);
    return NextResponse.json({ dueForUnpublish: due });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
