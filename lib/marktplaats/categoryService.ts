import { query } from "../db";

export interface CategoryMapping {
  shopifyProductType: string;
  l1CategoryId: string;
  l1CategoryName: string;
  l2CategoryId: string;
  l2CategoryName: string;
}

/**
 * Centralized, DB-backed mapping between our internal (storefront) product
 * types and Marktplaats leaf categories. Never hardcode this inline in
 * business logic — always go through this service so mappings stay
 * centrally manageable (rule #4).
 */
export async function getCategoryMapping(shopifyProductType: string): Promise<CategoryMapping | null> {
  const rows = await query<{
    shopify_product_type: string;
    marktplaats_l1_category_id: string;
    marktplaats_l1_category_name: string;
    marktplaats_l2_category_id: string;
    marktplaats_l2_category_name: string;
  }>("SELECT * FROM marktplaats_category_mapping WHERE shopify_product_type = $1", [shopifyProductType]);

  const row = rows[0];
  if (!row) return null;

  return {
    shopifyProductType: row.shopify_product_type,
    l1CategoryId: row.marktplaats_l1_category_id,
    l1CategoryName: row.marktplaats_l1_category_name,
    l2CategoryId: row.marktplaats_l2_category_id,
    l2CategoryName: row.marktplaats_l2_category_name,
  };
}

export async function listCategoryMappings(): Promise<CategoryMapping[]> {
  const rows = await query<{
    shopify_product_type: string;
    marktplaats_l1_category_id: string;
    marktplaats_l1_category_name: string;
    marktplaats_l2_category_id: string;
    marktplaats_l2_category_name: string;
  }>("SELECT * FROM marktplaats_category_mapping ORDER BY shopify_product_type");

  return rows.map((row) => ({
    shopifyProductType: row.shopify_product_type,
    l1CategoryId: row.marktplaats_l1_category_id,
    l1CategoryName: row.marktplaats_l1_category_name,
    l2CategoryId: row.marktplaats_l2_category_id,
    l2CategoryName: row.marktplaats_l2_category_name,
  }));
}

export async function upsertCategoryMapping(mapping: CategoryMapping): Promise<void> {
  await query(
    `INSERT INTO marktplaats_category_mapping
       (shopify_product_type, marktplaats_l1_category_id, marktplaats_l1_category_name, marktplaats_l2_category_id, marktplaats_l2_category_name, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (shopify_product_type) DO UPDATE SET
       marktplaats_l1_category_id = EXCLUDED.marktplaats_l1_category_id,
       marktplaats_l1_category_name = EXCLUDED.marktplaats_l1_category_name,
       marktplaats_l2_category_id = EXCLUDED.marktplaats_l2_category_id,
       marktplaats_l2_category_name = EXCLUDED.marktplaats_l2_category_name,
       updated_at = now()`,
    [mapping.shopifyProductType, mapping.l1CategoryId, mapping.l1CategoryName, mapping.l2CategoryId, mapping.l2CategoryName]
  );
}

/** True once every seeded mapping has a real (non-"UNVERIFIED") Marktplaats category ID. */
export function isMappingVerified(mapping: CategoryMapping): boolean {
  return mapping.l1CategoryId !== "UNVERIFIED" && mapping.l2CategoryId !== "UNVERIFIED";
}
