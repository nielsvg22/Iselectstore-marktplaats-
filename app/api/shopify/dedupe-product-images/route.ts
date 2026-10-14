import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { getProduct, deleteProductImage } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface DedupeBody {
  productId: string;
  /** Default true — only reports what it would delete, doesn't touch anything. */
  dryRun?: boolean;
}

/**
 * Groups a product's images by filename with Shopify's automatic
 * "_<uuid>" dedup suffix stripped off (added whenever a file with a
 * name that's already taken gets re-uploaded) — repeated migration runs
 * left products with the same photo set uploaded dozens of times under
 * that pattern. Keeps the lowest-position (first) image per base name,
 * deletes the rest.
 */
function baseName(src: string): string {
  const file = src.split("/").pop()?.split("?")[0] || src;
  const noExt = file.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  const stripped = noExt.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
  return stripped;
}

export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: DedupeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  if (!body.productId) {
    return NextResponse.json({ error: "productId is verplicht." }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;

  try {
    const product = await getProduct(body.productId);
    const images = [...product.images].sort((a, b) => a.position - b.position);

    const groups = new Map<string, typeof images>();
    for (const img of images) {
      const key = baseName(img.src);
      const list = groups.get(key) || [];
      list.push(img);
      groups.set(key, list);
    }

    const keep: { id: number; src: string }[] = [];
    const remove: { id: number; src: string }[] = [];
    for (const list of groups.values()) {
      keep.push(list[0]);
      for (const extra of list.slice(1)) remove.push(extra);
    }

    if (!dryRun) {
      for (const img of remove) {
        await deleteProductImage(body.productId, img.id);
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      productId: body.productId,
      title: product.title,
      totalBefore: images.length,
      uniqueGroups: groups.size,
      kept: keep.length,
      removed: remove.length,
      removedIds: dryRun ? undefined : remove.map((r) => r.id),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
