import { query } from "../db";
import { MarktplaatsCategoryAttribute } from "./types";
import { fetchCategoryAttributes } from "./apiClient";
import { getMockCategoryAttributes } from "./mock";
import { getCategoryMapping, isMappingVerified } from "./categoryService";

function isMockMode(): boolean {
  return (process.env.MARKTPLAATS_ENVIRONMENT || "mock") === "mock";
}

/**
 * Returns the (cached, TTL-bound) category attributes for a leaf category,
 * refreshing from the live API when the cache is stale or missing. Never
 * hardcodes attributes permanently — see rule #5.
 */
export async function getCategoryAttributes(
  l1CategoryId: string,
  l2CategoryId: string,
  opts: { forceRefresh?: boolean; userAccessToken?: string } = {}
): Promise<{ attributes: MarktplaatsCategoryAttribute[]; source: "mock" | "cache" | "live"; fetchedAt: string }> {
  if (isMockMode() || l2CategoryId === "UNVERIFIED") {
    return { attributes: getMockCategoryAttributes(l2CategoryId), source: "mock", fetchedAt: new Date().toISOString() };
  }

  if (!opts.forceRefresh) {
    const rows = await query<{ attributes_json: MarktplaatsCategoryAttribute[]; fetched_at: string; ttl_seconds: number }>(
      "SELECT attributes_json, fetched_at, ttl_seconds FROM marktplaats_attribute_cache WHERE marktplaats_l2_category_id = $1",
      [l2CategoryId]
    );
    const row = rows[0];
    if (row) {
      const ageSeconds = (Date.now() - new Date(row.fetched_at).getTime()) / 1000;
      if (ageSeconds < row.ttl_seconds) {
        return { attributes: row.attributes_json, source: "cache", fetchedAt: row.fetched_at };
      }
    }
  }

  if (!opts.userAccessToken) {
    throw new Error("No access token available to refresh live category attributes");
  }

  const attributes = await fetchCategoryAttributes(l1CategoryId, l2CategoryId, opts.userAccessToken);
  await query(
    `INSERT INTO marktplaats_attribute_cache (marktplaats_l2_category_id, attributes_json, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (marktplaats_l2_category_id) DO UPDATE SET attributes_json = EXCLUDED.attributes_json, fetched_at = now()`,
    [l2CategoryId, JSON.stringify(attributes)]
  );

  return { attributes, source: "live", fetchedAt: new Date().toISOString() };
}

export async function getAttributesForProductType(productType: string) {
  const mapping = await getCategoryMapping(productType);
  if (!mapping) {
    throw new Error(`No Marktplaats category mapping configured for product type "${productType}"`);
  }
  const result = await getCategoryAttributes(mapping.l1CategoryId, mapping.l2CategoryId);
  return { mapping, mappingVerified: isMappingVerified(mapping), ...result };
}
