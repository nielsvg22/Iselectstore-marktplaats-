// TEMPORARY diagnostic route — exercises the exact same code the fixed
// quick-create extension calls (addQuickProductImage -> uploadOneImage ->
// addProductImage) end-to-end against the live shop, to verify the photo
// upload path genuinely works post-fix. Creates one draft test product with
// a real photo attached, then deletes it again. Not meant to stay in the
// codebase — removed once verified.
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { createProduct, deleteProduct } from "@/lib/shopify/client";
import { addQuickProductImage } from "@/services/shopify/quickProductService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: { filename?: string; dataBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.filename || !body.dataBase64) {
    return NextResponse.json({ error: "filename en dataBase64 zijn verplicht." }, { status: 400 });
  }

  let productId: number | null = null;
  try {
    const product = await createProduct({
      title: "TEST - quick-photo-flow verificatie (wordt automatisch verwijderd)",
      product_type: "iPhone",
      vendor: "iSelectStore",
      status: "draft",
      tags: "test,verwijderen",
    });
    productId = product.id;

    const image = await addQuickProductImage(String(product.id), body.filename, body.dataBase64);

    await deleteProduct(String(product.id));

    return NextResponse.json({ ok: true, productId: product.id, imageId: image.imageId, imageSrc: image.src, cleanedUp: true });
  } catch (err) {
    if (productId) {
      await deleteProduct(String(productId)).catch(() => {});
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout.", cleanedUp: Boolean(productId) }, { status: 500 });
  }
}
