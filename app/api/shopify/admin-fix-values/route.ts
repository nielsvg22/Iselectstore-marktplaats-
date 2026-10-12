import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { readQuickProduct, updateQuickProduct, QuickProductError } from "@/services/shopify/quickProductService";

export const dynamic = "force-dynamic";

interface FixValuesBody {
  productId: string;
  /** Partial — merged onto the product's current values (read via readQuickProduct), never replaces the full set. */
  values: Record<string, string>;
}

/**
 * One-off admin action: corrects specific field values on an existing
 * product without needing the Shopify-extension idToken (updateQuickProduct
 * normally requires the FULL values set — this reads the current ones first
 * and merges the given corrections on top). Used to fix data entered before
 * a field became a dropdown (e.g. an invalid iPhone model/color typed as
 * free text) so the GoedGeplaatst concept creation can succeed.
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: FixValuesBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.productId || !body.values || typeof body.values !== "object") {
    return NextResponse.json({ error: "productId en values zijn verplicht." }, { status: 400 });
  }

  try {
    const current = await readQuickProduct(body.productId);
    const mergedValues = { ...current.values, ...body.values };
    const result = await updateQuickProduct({
      productId: body.productId,
      productType: current.productType,
      values: mergedValues,
    });
    return NextResponse.json({ result, before: current.values, after: mergedValues });
  } catch (err) {
    if (err instanceof QuickProductError) {
      return NextResponse.json({ error: err.message, issues: err.issues ?? [] }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
