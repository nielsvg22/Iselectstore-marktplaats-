import { NextRequest, NextResponse } from "next/server";
import { checkProductAndNotify, scanAllProductsAndNotify } from "@/services/inventory/notificationService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body.productId) {
      const results = await checkProductAndNotify(String(body.productId));
      return NextResponse.json({ ok: true, results });
    }

    const summary = await scanAllProductsAndNotify(body.limit ? Number(body.limit) : 250);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
