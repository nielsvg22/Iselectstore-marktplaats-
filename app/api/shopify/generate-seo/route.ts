import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";
import { listProducts, getCustomFields, setProductSeo } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SITE_NAME = "iSelectStore";
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function buildSeoTitle(productTitle: string): string {
  return truncate(`${productTitle} kopen | ${SITE_NAME}`, TITLE_MAX);
}

function buildSeoDescription(productTitle: string, fields: Record<string, string>, price: string | undefined): string {
  const parts: string[] = [];
  if (fields.condition) parts.push(`${productTitle} in ${fields.condition.toLowerCase()}`);
  else parts.push(productTitle);
  if (fields.battery_percentage) parts.push(`${fields.battery_percentage}% batterijconditie`);
  if (price) parts.push(`vanaf €${price}`);
  if (fields.warranty_months) parts.push(`incl. ${fields.warranty_months} mnd garantie`);
  let description = parts.join(", ") + ".";
  description = description.charAt(0).toUpperCase() + description.slice(1);
  description += ` Origineel, gecontroleerd en snel geleverd door ${SITE_NAME}.`;
  return truncate(description, DESCRIPTION_MAX);
}

interface GenerateSeoBody {
  /** Default true — only fills blank SEO title/description, never overwrites existing text. */
  onlyBlank?: boolean;
  /** Cap how many products to touch in one call, to stay within the function's time limit. */
  limit?: number;
}

/**
 * One-off admin action: generates and sets a Page title / Meta description for
 * every product that doesn't already have one, from its own title + condition/
 * battery/warranty/price — the "SEO-basis" line item from the offerte. Generic
 * by nature (not hand-written per product), but better than Shopify's bare
 * fallback. Never touches a product that already has custom SEO text set,
 * unless onlyBlank is explicitly turned off.
 */
export async function POST(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  let body: GenerateSeoBody = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine, defaults apply
  }
  const onlyBlank = body.onlyBlank !== false;
  const limit = body.limit ?? 250;

  try {
    const products = await listProducts(limit);
    const results: { id: number; title: string; action: "updated" | "skipped_has_seo" | "skipped_no_price" }[] = [];

    for (const product of products) {
      if (onlyBlank && product.metafields_global_title_tag && product.metafields_global_description_tag) {
        results.push({ id: product.id, title: product.title, action: "skipped_has_seo" });
        continue;
      }
      const price = product.variants?.[0]?.price;
      if (!price) {
        results.push({ id: product.id, title: product.title, action: "skipped_no_price" });
        continue;
      }
      const fields = await getCustomFields(String(product.id));
      const seoTitle = buildSeoTitle(product.title);
      const seoDescription = buildSeoDescription(product.title, fields, price);
      await setProductSeo(String(product.id), seoTitle, seoDescription);
      results.push({ id: product.id, title: product.title, action: "updated" });
      // Shopify Admin API allows ~2 req/s; getCustomFields + setProductSeo is 2 calls per product.
      await new Promise((r) => setTimeout(r, 1100));
    }

    const summary = {
      total: results.length,
      updated: results.filter((r) => r.action === "updated").length,
      skipped_has_seo: results.filter((r) => r.action === "skipped_has_seo").length,
      skipped_no_price: results.filter((r) => r.action === "skipped_no_price").length,
    };
    return NextResponse.json({ ok: true, summary, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onbekende fout." }, { status: 500 });
  }
}
