import { NextRequest, NextResponse } from "next/server";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { publishToMarktplaats } from "@/lib/marktplaats/publishService";
import { humanizeError, logSync } from "@/lib/logging";

export async function POST(req: NextRequest) {
  const { shopifyProductId } = await req.json();
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }

  try {
    const preview = await buildProductPreview(shopifyProductId);
    if (!preview.validation.publishable) {
      return NextResponse.json({ error: "Validatie bevat errors — kan niet publiceren.", validation: preview.validation }, { status: 422 });
    }
    const result = await publishToMarktplaats(shopifyProductId, preview);
    return NextResponse.json({ result });
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    await logSync({ shopifyProductId, action: "publish_error", message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
