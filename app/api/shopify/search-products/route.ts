import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { listProducts } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

/** One-off admin lookup: find products by (partial, case-insensitive) title match, with their image URLs. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase();
  if (!q) {
    return NextResponse.json({ error: "q query-parameter is verplicht." }, { status: 400 });
  }

  try {
    const products = await listProducts(250);
    const matches = products
      .filter((p) => p.title.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        images: p.images.map((img) => ({ id: img.id, src: img.src, position: img.position })),
      }));
    return NextResponse.json({ matches });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
