import { query } from "../db";

export interface GoedgeplaatstLogEntry {
  linkKey?: string;
  shopifyProductId?: string;
  goedgeplaatstAdId?: string | number;
  action: string;
  apiOperation?: string;
  result?: "ok" | "error" | "mock";
  httpStatus?: number;
  message?: string;
}

/** NEVER pass the API key or request/response bodies in `message` (same rule as lib/logging.ts). */
export async function logGoedgeplaatstSync(entry: GoedgeplaatstLogEntry): Promise<void> {
  await query(
    `INSERT INTO goedgeplaatst_sync_log (link_key, shopify_product_id, goedgeplaatst_ad_id, action, api_operation, result, http_status, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.linkKey ?? null,
      entry.shopifyProductId ?? null,
      entry.goedgeplaatstAdId != null ? String(entry.goedgeplaatstAdId) : null,
      entry.action,
      entry.apiOperation ?? null,
      entry.result ?? null,
      entry.httpStatus ?? null,
      entry.message ?? null,
    ]
  );
}
