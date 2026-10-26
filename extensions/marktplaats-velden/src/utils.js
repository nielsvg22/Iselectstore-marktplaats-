// GraphQL access from inside the extension, per the officially documented
// pattern: https://shopify.dev/docs/apps/build/admin/actions-blocks/build-admin-block
async function makeGraphQLQuery(query, variables) {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    console.error("Marktplaats-velden: GraphQL network error", res.status);
  }
  return res.json();
}

export async function getProductInfo(productId) {
  return makeGraphQLQuery(
    `query ProductInfo($id: ID!) {
      product(id: $id) {
        id
        productType
        metafields(namespace: "$app:mkt", first: 40) {
          edges { node { key value type } }
        }
      }
    }`,
    { id: productId }
  );
}

export async function setProductType(productId, productType) {
  return makeGraphQLQuery(
    `mutation SetProductType($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id productType }
        userErrors { field message }
      }
    }`,
    { input: { id: productId, productType } }
  );
}

export async function setMetafields(productId, entries) {
  // entries: [{ key, type, value }]
  const metafields = entries.map((e) => ({
    ownerId: productId,
    namespace: "$app:mkt",
    key: e.key,
    type: e.type,
    value: e.value,
  }));
  return makeGraphQLQuery(
    `mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message code }
      }
    }`,
    { metafields }
  );
}
