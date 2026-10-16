import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { listProducts, updateProduct } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface NormalizeBody {
  /** Default true — only reports what it would rename, doesn't touch anything. */
  dryRun?: boolean;
  /** Cap on how many products to scan/update in one call. */
  limit?: number;
}

/**
 * Strips the condition/battery/warranty suffix migrated products carry
 * (e.g. "/krasvrij /86% batt /garantie.") down to "Model Opslag Kleur", and
 * collapses an accidentally duplicated "128GB zwart 128GB zwart" segment
 * some migrated titles have.
 */
function normalizeTitle(title: string): string {
  const base = title.split(/\s+\//)[0].trim().replace(/[.,]+$/, "");
  const match = base.match(/^(.*?)(\d+(?:GB|TB)\s+\S+)\s+\2$/i);
  return match ? `${match[1]}${match[2]}`.trim() : base;
}

export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: NormalizeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body." }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;
  const limit = body.limit ? Math.min(Number(body.limit), 2000) : 2000;

  try {
    const products = await listProducts(limit);
    const changes: { id: number; before: string; after: string }[] = [];
    for (const p of products) {
      const after = normalizeTitle(p.title);
      if (after && after !== p.title) changes.push({ id: p.id, before: p.title, after });
    }

    if (!dryRun) {
      for (const c of changes) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await updateProduct(String(c.id), { title: c.after });
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("429") || attempt === 4) throw err;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      totalScanned: products.length,
      toChange: changes.length,
      changes: changes.slice(0, 50),
      changesTruncated: changes.length > 50,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
