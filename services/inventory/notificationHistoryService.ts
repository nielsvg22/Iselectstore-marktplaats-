import { query } from "@/lib/db";

export type NotificationStatus = "pending" | "sent" | "failed";

export interface NotificationHistoryRow {
  id: number;
  subscription_id: number;
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  product_image_url: string;
  product_price: number;
  provider: string;
  status: string;
  error_message: string;
  sent_at: string;
}

/**
 * Writes the single history row for a successful notification.
 *
 * The unique index on (subscription_id, shopify_product_id) makes this a
 * database-level second line of defence: even if two runners somehow both got
 * past the subscription lease, only one row can exist — so only one mail is
 * ever considered "sent" for a given product.
 *
 * Returns false when a row already existed (another runner won the race).
 */
export async function recordSentNotification(params: {
  subscriptionId: number;
  productId: string;
  productTitle?: string;
  productHandle?: string;
  productImageUrl?: string;
  productPrice?: number;
  provider: string;
}): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `INSERT INTO inventory_notification_history
       (subscription_id, shopify_product_id, product_title, product_handle, product_image_url, product_price, provider, status, error_message, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'sent', NULL, now())
     ON CONFLICT (subscription_id, shopify_product_id) DO NOTHING
     RETURNING id`,
    [
      params.subscriptionId,
      params.productId,
      params.productTitle ?? null,
      params.productHandle ?? null,
      params.productImageUrl ?? null,
      params.productPrice ?? null,
      params.provider,
    ]
  );
  return rows.length > 0;
}

export async function recordNotificationHistory(params: {
  subscriptionId: number;
  productId: string;
  productTitle?: string;
  productHandle?: string;
  productImageUrl?: string;
  productPrice?: number;
  provider: string;
  status: NotificationStatus;
  errorMessage?: string;
}): Promise<void> {
  await query(
    `INSERT INTO inventory_notification_history
       (subscription_id, shopify_product_id, product_title, product_handle, product_image_url, product_price, provider, status, error_message, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (subscription_id, shopify_product_id) DO NOTHING`,
    [
      params.subscriptionId,
      params.productId,
      params.productTitle ?? null,
      params.productHandle ?? null,
      params.productImageUrl ?? null,
      params.productPrice ?? null,
      params.provider,
      params.status,
      params.errorMessage ?? null,
    ]
  );
}

export async function hasNotificationBeenSent(subscriptionId: number, productId: string): Promise<boolean> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM inventory_notification_history
     WHERE subscription_id = $1 AND shopify_product_id = $2 AND status = 'sent'`,
    [subscriptionId, productId]
  );
  return Number(rows[0]?.count) > 0;
}

export async function listNotificationHistory(limit = 100): Promise<NotificationHistoryRow[]> {
  const rows = await query<NotificationHistoryRow>(
    `SELECT * FROM inventory_notification_history ORDER BY sent_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
