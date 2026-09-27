// Writes merchant-confirmed AI recognition values to Shopify structured
// fields. Never called automatically — only after an explicit "Toepassen" /
// "Alles toepassen" click in the UI. Only fields on the AI allow-list for the
// product's type can be written here, regardless of what a caller sends.
import { NextRequest, NextResponse } from "next/server";
import { setStructuredField } from "@/lib/shopify/client";
import { isAiFillableField, AI_FIELD_METAFIELD_TYPE } from "@/lib/ai/allowedFields";
import { listProductTypes } from "@/lib/templates/registry";
import { ShopifyProductType } from "@/lib/templates/types";
import { logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";

interface ApplyBody {
  productId: string;
  productType: string;
  fields: { key: string; value: string | number }[];
}

export async function POST(req: NextRequest) {
  let body: ApplyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige request body." }, { status: 400 });
  }

  const { productId, productType, fields } = body;
  if (!productId) return NextResponse.json({ error: "productId is verplicht." }, { status: 400 });
  if (!productType || !listProductTypes().includes(productType as ShopifyProductType)) {
    return NextResponse.json({ error: "Onbekend of ontbrekend producttype." }, { status: 400 });
  }
  const validatedProductType = productType as ShopifyProductType;
  if (!Array.isArray(fields) || fields.length === 0) {
    return NextResponse.json({ error: "Geen velden om toe te passen." }, { status: 400 });
  }

  const applied: string[] = [];
  const rejected: string[] = [];

  for (const { key, value } of fields) {
    if (!isAiFillableField(validatedProductType, key)) {
      rejected.push(key);
      continue;
    }
    const mfType = AI_FIELD_METAFIELD_TYPE[key] ?? "single_line_text_field";
    await setStructuredField(productId, key, String(value), mfType);
    applied.push(key);
  }

  await logSync({
    shopifyProductId: productId,
    action: "ai_apply_fields",
    message: `applied=${applied.join(",")}${rejected.length ? ` rejected=${rejected.join(",")}` : ""}`,
  });

  return NextResponse.json({ applied, rejected });
}
