import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken } from "@/lib/shopify/tokenService";

export const dynamic = "force-dynamic";

/** Temporary diagnostic: which products/collections/pages are missing a custom SEO title/description. */
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password") || req.nextUrl.searchParams.get("password");
  if (!process.env.ADMIN_PANEL_PASSWORD || password !== process.env.ADMIN_PANEL_PASSWORD) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const version = process.env.SHOPIFY_API_VERSION || "2024-10";
    const token = await getShopifyAccessToken();

    const query = `
      query SeoAudit {
        products(first: 100) {
          edges { node { title onlineStoreUrl seo { title description } } }
        }
        collections(first: 50) {
          edges { node { title onlineStoreUrl seo { title description } } }
        }
        pages(first: 50) {
          edges { node { title onlineStoreUrl seo { title description } } }
        }
      }
    `;

    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    const json = await res.json();
    if (json.errors) return NextResponse.json(json, { status: 500 });

    type Node = { title: string; onlineStoreUrl: string | null; seo: { title: string | null; description: string | null } };
    const summarize = (edges: { node: Node }[]) => {
      const missing = edges
        .map((e) => e.node)
        .filter((n) => !n.seo?.title || !n.seo?.description)
        .map((n) => ({ title: n.title, url: n.onlineStoreUrl, missingTitle: !n.seo?.title, missingDescription: !n.seo?.description }));
      return { total: edges.length, missingCount: missing.length, missing };
    };

    return NextResponse.json({
      products: summarize(json.data.products.edges),
      collections: summarize(json.data.collections.edges),
      pages: summarize(json.data.pages.edges),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
