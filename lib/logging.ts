import { query } from "./db";

export interface LogEntry {
  shopifyProductId?: string;
  marktplaatsAdvertisementId?: string;
  testAdvertisementId?: string;
  action: string;
  apiOperation?: string;
  httpStatus?: number;
  errorCode?: string;
  message?: string;
}

/**
 * Central sync log. NEVER pass tokens/secrets in `message` — callers are
 * responsible for redacting before logging (rule #45).
 */
export async function logSync(entry: LogEntry): Promise<void> {
  await query(
    `INSERT INTO marktplaats_sync_log
       (shopify_product_id, marktplaats_advertisement_id, test_advertisement_id, action, api_operation, http_status, error_code, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.shopifyProductId ?? null,
      entry.marktplaatsAdvertisementId ?? null,
      entry.testAdvertisementId ?? null,
      entry.action,
      entry.apiOperation ?? null,
      entry.httpStatus ?? null,
      entry.errorCode ?? null,
      entry.message ?? null,
    ]
  );
}

export async function getRecentLogs(shopifyProductId?: string, limit = 50) {
  if (shopifyProductId) {
    return query("SELECT * FROM marktplaats_sync_log WHERE shopify_product_id = $1 ORDER BY created_at DESC LIMIT $2", [shopifyProductId, limit]);
  }
  return query("SELECT * FROM marktplaats_sync_log ORDER BY created_at DESC LIMIT $1", [limit]);
}

/** Human-readable translation for common Marktplaats/Shopify API errors (rule #46). */
export function humanizeError(rawMessage: string): string {
  if (rawMessage.includes("invalid_attribute")) {
    return "Marktplaats weigert dit product omdat een van de kenmerken een ongeldige waarde heeft voor de gekozen categorie.";
  }
  if (rawMessage.includes("mandatory")) {
    return "Marktplaats weigert dit product omdat een verplicht kenmerk ontbreekt.";
  }
  if (rawMessage.includes("401") || rawMessage.toLowerCase().includes("unauthorized")) {
    return "De verbinding met Marktplaats is verlopen of ongeldig — koppel opnieuw via het paneel.";
  }
  if (rawMessage.includes("429")) {
    return "Marktplaats geeft aan dat we te veel verzoeken doen (rate limit) — probeer het over enkele minuten opnieuw.";
  }
  return rawMessage;
}
