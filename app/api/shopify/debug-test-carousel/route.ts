import { NextRequest, NextResponse } from "next/server";
import { postToInstagram } from "@/lib/instagram/service";

export const dynamic = "force-dynamic";

/** Temporary diagnostic: posts a real multi-image carousel using generic stock photos (not customer/inventory data), to test the carousel mechanics in isolation. */
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const result = await postToInstagram(
      [
        "https://fastly.picsum.photos/id/866/1080/1080.jpg?hmac=-odINC3zxT6LEkwBCvtQu3ZGiihMHEJal0Lh4RjkvGU",
        "https://fastly.picsum.photos/id/933/1080/1080.jpg?hmac=ab_r7f8sSRxTt4lOqwv5imxj4Wf8QpT3YMxg2jwkTxM",
      ],
      "Testcarrousel — losse technische test van meerdere-foto's-functie, geen echt product."
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
