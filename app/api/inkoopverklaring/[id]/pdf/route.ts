import { NextRequest, NextResponse } from "next/server";
import { getPurchaseDeclarationById } from "@/services/purchaseDeclarations/purchaseDeclarationService";
import { generateInkoopverklaringPdf } from "@/lib/pdf/inkoopverklaringPdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ongeldig id." }, { status: 400 });
  }

  try {
    const declaration = await getPurchaseDeclarationById(id);
    if (!declaration) {
      return NextResponse.json({ error: "Niet gevonden." }, { status: 404 });
    }
    const pdfBytes = await generateInkoopverklaringPdf(declaration);
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="inkoopverklaring-${declaration.id}-${declaration.achternaam.replace(/[^a-z0-9]/gi, "")}.pdf"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[inkoopverklaring-pdf]", message);
    return NextResponse.json({ error: "Kon PDF niet genereren." }, { status: 500 });
  }
}
