// One-off admin action: watermarks existing products' photos (the
// automatic pipeline only ever reacts to a NEW products/create or
// products/update webhook delivery — it has no reason to ever look at a
// product nothing has touched since before the watermark feature existed),
// and pushes the result to GoedGeplaatst for any product already linked
// there. Paged by array offset over one listProducts() snapshot so repeated
// calls deterministically continue where the last one left off; call again
// with the returned nextOffset until done=true.
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { listProducts, hasPositiveInventory } from "@/lib/shopify/client";
import { watermarkProductImages } from "@/lib/watermark/watermarkService";
import { getLinkForShopifyProduct } from "@/lib/goedgeplaatst/service";
import { autoCreateGoedgeplaatstConceptAd } from "@/lib/goedgeplaatst/autoSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface BackfillBody {
  offset?: number;
  count?: number;
  /** Products with more images than this are skipped by default and reported
   * separately — an unusually large count is almost always leftover upload
   * duplicates (see /api/shopify/dedupe-product-images) that should be
   * cleaned up first, not individually watermarked one-by-one. */
  maxImagesPerProduct?: number;
  /** Process oversized products anyway instead of skipping them. */
  includeOversized?: boolean;
}

export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: BackfillBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const offset = Math.max(0, body.offset ?? 0);
  const count = Math.min(Math.max(body.count ?? 10, 1), 50);
  const maxImagesPerProduct = body.maxImagesPerProduct ?? 20;

  const allProducts = await listProducts(1000);
  const batch = allProducts.slice(offset, offset + count);

  const results: {
    productId: number;
    title: string;
    imagesWatermarked: number;
    imagesSkipped: number;
    imagesErrored: number;
    goedgeplaatstResynced: boolean;
  }[] = [];
  const needsDedupeFirst: { productId: number; title: string; imageCount: number }[] = [];

  for (const product of batch) {
    if (!body.includeOversized && product.images.length > maxImagesPerProduct) {
      needsDedupeFirst.push({ productId: product.id, title: product.title, imageCount: product.images.length });
      continue;
    }

    const wmResult = await watermarkProductImages(String(product.id), product);

    let goedgeplaatstResynced = false;
    if (wmResult.processed > 0 && hasPositiveInventory(product)) {
      const link = await getLinkForShopifyProduct(String(product.id)).catch(() => null);
      const hasSucceededBefore = link?.concept_status === "concept" && Number(link.goedgeplaatst_ad_id) > 0;
      if (hasSucceededBefore) {
        await autoCreateGoedgeplaatstConceptAd(String(product.id), { forceImageResync: true }).catch(() => {});
        goedgeplaatstResynced = true;
      }
    }

    results.push({
      productId: product.id,
      title: product.title,
      imagesWatermarked: wmResult.processed,
      imagesSkipped: wmResult.skipped,
      imagesErrored: wmResult.errors,
      goedgeplaatstResynced,
    });
  }

  const nextOffset = offset + count;
  return NextResponse.json({
    ok: true,
    totalProducts: allProducts.length,
    offset,
    count: batch.length,
    nextOffset,
    done: nextOffset >= allProducts.length,
    results,
    needsDedupeFirst,
  });
}
