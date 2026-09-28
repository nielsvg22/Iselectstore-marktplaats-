import { query } from "@/lib/db";
import { getShopifyAccessToken } from "@/lib/shopify/tokenService";

interface PublicationRow {
  id: string;
  name: string;
}

async function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  if (!domain) {
    throw new Error("SHOPIFY_STORE_DOMAIN not configured");
  }
  const token = await getShopifyAccessToken();
  return { domain, token, version };
}

async function shopifyFetch(path: string, init?: RequestInit) {
  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Fetches the Online Store publication ID via GraphQL (REST has no publication list endpoint). */
async function getOnlineStorePublicationId(): Promise<string | null> {
  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `{
        publications(first: 50) {
          edges {
            node {
              id
              name
            }
          }
        }
      }`,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL ${res.status}: ${body}`);
  }

  const data = await res.json();
  const publications: PublicationRow[] = data?.data?.publications?.edges?.map((e: { node: PublicationRow }) => e.node) || [];
  const onlineStore = publications.find((p) => p.name.toLowerCase().includes("online store"));
  return onlineStore?.id || null;
}

/**
 * Unpublishes a product from the Online Store publication only.
 * Does NOT delete the product. Idempotent: safe to call multiple times.
 */
export async function unpublishFromOnlineStore(productId: string): Promise<void> {
  const numericId = productId.replace(/^gid:\/\/shopify\/Product\//, "").replace(/\.json$/, "");
  const publicationId = await getOnlineStorePublicationId();
  if (!publicationId) {
    throw new Error("Online Store publication niet gevonden");
  }

  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
          publishableUnpublish(id: $id, input: $input) {
            publishable {
              publishedOnPublication(publicationId: $id)
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        id: `gid://shopify/Product/${numericId}`,
        input: [{ publicationId }],
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify unpublish ${res.status}: ${body}`);
  }

  const data = await res.json();
  const errors = data?.data?.publishableUnpublish?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
  }

  await query("UPDATE product_lifecycle SET status = 'unpublished', unpublished_at = now(), updated_at = now() WHERE shopify_product_id = $1", [numericId]);
}

export async function publishToOnlineStore(productId: string): Promise<void> {
  const numericId = productId.replace(/^gid:\/\/shopify\/Product\//, "").replace(/\.json$/, "");
  const publicationId = await getOnlineStorePublicationId();
  if (!publicationId) {
    throw new Error("Online Store publication niet gevonden");
  }

  const { domain, token, version } = await config();
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            publishable {
              publishedOnPublication(publicationId: $id)
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        id: `gid://shopify/Product/${numericId}`,
        input: [{ publicationId }],
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify publish ${res.status}: ${body}`);
  }

  const data = await res.json();
  const errors = data?.data?.publishablePublish?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
  }

  await query("UPDATE product_lifecycle SET status = 'active', updated_at = now() WHERE shopify_product_id = $1", [numericId]);
}
