import { NextRequest, NextResponse } from "next/server";
import { getProduct, updateProduct } from "@/lib/shopify/client";
import { checkAdminPassword } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

interface UpdateDescriptionBody {
  productId: string;
  bodyHtml: string;
}

/** Read-only: fetch the current body_html before deciding what to replace it with. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId query-parameter is verplicht." }, { status: 400 });
  }
  try {
    const product = await getProduct(productId);
    return NextResponse.json({ bodyHtml: product.body_html });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}

/**
 * One-off admin action: replace a Shopify product's description (body_html).
 * Needed to clean up the "Niet echt te koop" disclaimer on the test product
 * before its first real GoedGeplaatst publish — never used automatically,
 * always an explicit admin-password-protected call with the full new text.
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: UpdateDescriptionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }

  if (!body.productId || typeof body.bodyHtml !== "string") {
    return NextResponse.json({ error: "productId en bodyHtml zijn verplicht." }, { status: 400 });
  }

  try {
    const before = await getProduct(body.productId);
    const after = await updateProduct(body.productId, { body_html: body.bodyHtml });
    return NextResponse.json({ before: before.body_html, after: after.body_html });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
