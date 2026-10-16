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
    const iphones = products.filter((p) => p.product_type === "iPhone");
    const changes: { id: number; before: string; after: string }[] = [];
    for (const p of iphones) {
      const after = normalizeTitle(p.title);
      if (after && after !== p.title) changes.push({ id: p.id, before: p.title, after });
    }

    // Duplicate-title safety net: even within iPhones, two products can land
    // on the same "Model Opslag Kleur" (e.g. two 86%-battery and 100%-battery
    // units of the same model/color) — never silently rename into a collision.
    const afterCounts = new Map<string, number>();
    for (const c of changes) afterCounts.set(c.after, (afterCounts.get(c.after) || 0) + 1);
    for (const p of iphones) {
      if (!changes.some((c) => c.id === p.id)) {
        afterCounts.set(p.title, (afterCounts.get(p.title) || 0) + 1);
      }
    }
    const skippedDuplicates = changes.filter((c) => (afterCounts.get(c.after) || 0) > 1);
    const finalChanges = changes.filter((c) => (afterCounts.get(c.after) || 0) <= 1);

    if (!dryRun) {
      for (const c of finalChanges) {
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
      iphonesScanned: iphones.length,
      toChange: finalChanges.length,
      changes: finalChanges.slice(0, 50),
      changesTruncated: finalChanges.length > 50,
      skippedDuplicates: skippedDuplicates.length,
      skippedDuplicatesSample: skippedDuplicates.slice(0, 20),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
