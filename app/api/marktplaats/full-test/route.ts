import { NextRequest, NextResponse } from "next/server";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { runFullApiTest, cleanupTestAdvertisement } from "@/lib/marktplaats/integrationTestService";

export async function POST(req: NextRequest) {
  const { shopifyProductId } = await req.json();
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }

  try {
    const preview = await buildProductPreview(shopifyProductId);
    const result = await runFullApiTest(shopifyProductId, preview);

    if (result.testAdvertisementId) {
      try {
        await cleanupTestAdvertisement(shopifyProductId, result.testAdvertisementId);
        result.steps.push({ label: "Cleanup", ok: true });
      } catch (cleanupErr) {
        result.steps.push({ label: "Cleanup", ok: false, detail: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) });
      }
    }

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
