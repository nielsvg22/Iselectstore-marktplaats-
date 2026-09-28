// AI product recognition endpoint. Server-side only tussenlaag: Shopify admin
// panel -> this route -> Vision provider -> structured response -> panel.
// Never writes to Shopify or Marktplaats — see /api/ai/apply for that,
// which only runs after the merchant explicitly confirms a value.
import { NextRequest, NextResponse } from "next/server";
import { ProductImageRecognitionService } from "@/lib/ai/productImageRecognitionService";
import { createVisionProviderFromEnv } from "@/lib/ai/visionProviderFactory";
import { getStructuredFields } from "@/lib/shopify/client";
import { listProductTypes } from "@/lib/templates/registry";
import { ShopifyProductType } from "@/lib/templates/types";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

interface RecognizeBody {
  productType: string;
  images: { dataUrl: string; filename?: string }[];
  productId?: string;
  testMode?: boolean;
  /** "create" = herkenning voor een nog niet bestaand product (beheerpagina
   * /admin/quick-create); standaard "edit" = bestaand product. */
  mode?: "create" | "edit";
}

export async function POST(req: NextRequest) {
  let body: RecognizeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige request body." }, { status: 400 });
  }

  const { productType, images, productId, testMode, mode } = body;
  const createMode = mode === "create";

  if (!productType || !listProductTypes().includes(productType as ShopifyProductType)) {
    return NextResponse.json({ error: "Onbekend of ontbrekend producttype." }, { status: 400 });
  }
  const validatedProductType = productType as ShopifyProductType;
  if (!Array.isArray(images) || images.length === 0) {
    return NextResponse.json({ error: "Geen afbeelding ontvangen." }, { status: 400 });
  }
  for (const img of images) {
    if (!img.dataUrl?.startsWith("data:image/")) {
      return NextResponse.json({ error: "Eén of meer bestanden zijn geen geldige afbeelding." }, { status: 400 });
    }
  }

  const provider = createVisionProviderFromEnv();
  if (!provider) {
    return NextResponse.json({ error: "AI-service is niet geconfigureerd (API-key voor de gekozen AI_PROVIDER ontbreekt)." }, { status: 500 });
  }

  let existingValues: Record<string, string> = {};
  if (!testMode && productId && !createMode) {
    try {
      existingValues = await getStructuredFields(productId);
    } catch {
      // Non-fatal: recognition can still run without a comparison baseline.
    }
  }

  try {
    const service = new ProductImageRecognitionService(provider);
    const result = await service.recognize({
      productType: validatedProductType,
      images,
      existingValues,
    });

    await logSync({
      shopifyProductId: testMode || createMode ? undefined : productId,
      action: testMode ? "ai_recognition_test" : "ai_recognition",
      message: `productType=${productType} images=${images.length} fields=${result.fields.length} mode=${createMode ? "create" : "edit"}`,
    });

    return NextResponse.json({ result, testMode: Boolean(testMode) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "De afbeelding kon niet goed worden gelezen.";
    await logSync({ shopifyProductId: testMode || createMode ? undefined : productId, action: "ai_recognition_error", message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
