import { NextRequest, NextResponse } from "next/server";
import { listPurchaseDeclarations } from "@/services/purchaseDeclarations/purchaseDeclarationService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const declarations = await listPurchaseDeclarations();
    return NextResponse.json({ declarations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
