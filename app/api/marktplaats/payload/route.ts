import { NextRequest, NextResponse } from "next/server";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { redactForPreview } from "@/lib/marktplaats/payloadBuilder";

export async function POST(req: NextRequest) {
  const { shopifyProductId } = await req.json();
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }
  try {
    const preview = await buildProductPreview(shopifyProductId);
    return NextResponse.json({ payload: redactForPreview(preview.payloadPreview as unknown as Record<string, unknown>) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
