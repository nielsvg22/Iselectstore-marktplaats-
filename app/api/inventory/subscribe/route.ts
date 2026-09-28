import { NextRequest, NextResponse } from "next/server";
import { createSubscription } from "@/services/inventory/subscriptionService";

export const dynamic = "force-dynamic";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const productType = String(body.productType || "").trim();
    const model = String(body.model || "").trim();
    const storage = String(body.storage || "").trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Voer een geldig e-mailadres in." }, { status: 400 });
    }
    if (!productType || !model || !storage) {
      return NextResponse.json({ error: "Producttype, model en opslag zijn verplicht." }, { status: 400 });
    }

    await createSubscription({ email, productType, model, storage });
    return NextResponse.json({ ok: true, message: "Je ontvangt een melding zodra dit product weer beschikbaar is." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
