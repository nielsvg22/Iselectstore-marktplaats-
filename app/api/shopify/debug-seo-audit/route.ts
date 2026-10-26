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

    // Page has no `seo`/`onlineStoreUrl` field in the GraphQL Admin API at
    // this version — only products/collections do there. Pages' SEO fields
    // (metafields_global_title_tag/description_tag) are REST-only, checked
    // separately below.
    const query = `
      query SeoAudit {
        products(first: 100) {
          edges { node { title handle seo { title description } } }
        }
        collections(first: 50) {
          edges { node { title handle seo { title description } } }
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

    type Node = { title: string; handle: string; seo: { title: string | null; description: string | null } };
    const summarize = (edges: { node: Node }[]) => {
      const missing = edges
        .map((e) => e.node)
        .filter((n) => !n.seo?.title || !n.seo?.description)
        .map((n) => ({ title: n.title, handle: n.handle, missingTitle: !n.seo?.title, missingDescription: !n.seo?.description }));
      return { total: edges.length, missingCount: missing.length, missing };
    };

    const pagesRes = await fetch(`https://${domain}/admin/api/${version}/pages.json?limit=100&fields=title,handle,metafields_global_title_tag,metafields_global_description_tag`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const pagesJson = await pagesRes.json();
    const pageNodes = (pagesJson.pages || []) as {
      title: string;
      handle: string;
      metafields_global_title_tag: string | null;
      metafields_global_description_tag: string | null;
    }[];
    const pagesMissing = pageNodes
      .filter((p) => !p.metafields_global_title_tag || !p.metafields_global_description_tag)
      .map((p) => ({
        title: p.title,
        handle: p.handle,
        missingTitle: !p.metafields_global_title_tag,
        missingDescription: !p.metafields_global_description_tag,
      }));

    return NextResponse.json({
      products: summarize(json.data.products.edges),
      collections: summarize(json.data.collections.edges),
      pages: { total: pageNodes.length, missingCount: pagesMissing.length, missing: pagesMissing },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
