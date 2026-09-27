import { NextRequest, NextResponse } from "next/server";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { logSync, humanizeError } from "@/lib/logging";

export async function POST(req: NextRequest) {
  const { shopifyProductId } = await req.json();
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }

  try {
    const preview = await buildProductPreview(shopifyProductId);
    await logSync({ shopifyProductId, action: "test_mapping" });
    return NextResponse.json({ preview });
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    await logSync({ shopifyProductId, action: "test_mapping_error", message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
