import { NextRequest, NextResponse } from "next/server";
import { buildProductPreview } from "@/lib/marktplaats/orchestrator";
import { buildBrowserTestPlan } from "@/lib/marktplaats/browserTest/fieldPlan";
import { runBrowserTest } from "@/lib/marktplaats/browserTest/browserTestPublisher";
import { logSync, humanizeError } from "@/lib/logging";

export const dynamic = "force-dynamic";

/**
 * Local/dev-only mapping-verification test: opens a real, visible Marktplaats
 * browser session filled in with this product's data, then stops before
 * publishing. NOT the production publish path — see
 * lib/marktplaats/publishService.ts for that. Guarded by
 * MARKTPLAATS_BROWSER_TEST and never submits unless
 * MARKTPLAATS_BROWSER_ALLOW_SUBMIT=true (and even then, this build never
 * implements the actual submit click — see browserTestPublisher.ts).
 */
export async function POST(req: NextRequest) {
  const { shopifyProductId } = await req.json();
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }

  if ((process.env.MARKTPLAATS_BROWSER_TEST || "").trim().toLowerCase() !== "true") {
    return NextResponse.json({ error: "Zet MARKTPLAATS_BROWSER_TEST=true in je lokale .env.local om deze testfunctie te gebruiken." }, { status: 403 });
  }

  try {
    const preview = await buildProductPreview(shopifyProductId);
    if (preview.validation.checks.some((c) => c.status === "error" && c.label === "Verplichte velden")) {
      return NextResponse.json({ error: "Niet alle verplichte velden zijn ingevuld in Shopify — vul deze eerst aan.", validation: preview.validation }, { status: 422 });
    }

    const plan = buildBrowserTestPlan(preview);
    const result = await runBrowserTest(plan);

    await logSync({ shopifyProductId, action: "browser_test", message: `${result.fieldResults.filter((r) => r.status === "filled" || r.status === "selected").length}/${result.fieldResults.length} velden verwerkt` });

    return NextResponse.json({ result });
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    await logSync({ shopifyProductId, action: "browser_test_error", message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
