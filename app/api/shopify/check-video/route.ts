import { NextRequest, NextResponse } from "next/server";
import { checkAdminPassword } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/** Diagnostic: checks the processing status of a previously-created Shopify Video file by its GID, without re-uploading. */
export async function GET(req: NextRequest) {
  const authError = checkAdminPassword(req);
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id=<gid> is verplicht." }, { status: 400 });

  const { getShopifyAccessToken } = await import("@/lib/shopify/tokenService");
  const token = await getShopifyAccessToken();
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";

  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query checkVideo($id: ID!) { node(id: $id) { ... on Video { id fileStatus sources { url mimeType } } } }`,
      variables: { id },
    }),
  });
  const data = await res.json();
  return NextResponse.json(data);
}
