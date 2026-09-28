import { query } from "@/lib/db";

export type SubscriptionStatus = "active" | "notified" | "cancelled";

export interface InventorySubscription {
  id: number;
  email: string;
  productType: string;
  model: string;
  storage: string;
  signupAt: string;
  status: SubscriptionStatus;
  notifiedAt: string | null;
  matchedProductId: string | null;
}

interface SubscriptionRow {
  id: number;
  email: string;
  product_type: string;
  model: string;
  storage: string;
  signup_at: string;
  status: string;
  notified_at: string | null;
  matched_product_id: string | null;
}

function fromRow(row: SubscriptionRow): InventorySubscription {
  return {
    id: row.id,
    email: row.email,
    productType: row.product_type,
    model: row.model,
    storage: row.storage,
    signupAt: row.signup_at,
    status: row.status as SubscriptionStatus,
    notifiedAt: row.notified_at,
    matchedProductId: row.matched_product_id,
  };
}

export interface CreateSubscriptionInput {
  email: string;
  productType: string;
  model: string;
  storage: string;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<InventorySubscription> {
  const normalized = {
    email: input.email.trim().toLowerCase(),
    productType: input.productType.trim(),
    model: input.model.trim(),
    storage: input.storage.trim(),
  };

  const rows = await query<SubscriptionRow>(
    `INSERT INTO inventory_notification_subscriptions (email, product_type, model, storage, signup_at, status)
     VALUES ($1,$2,$3,$4, now(), 'active')
     ON CONFLICT (email, product_type, model, storage) DO UPDATE SET
       status = 'active',
       notified_at = NULL,
       matched_product_id = NULL,
       updated_at = now()
     RETURNING *`,
    [normalized.email, normalized.productType, normalized.model, normalized.storage]
  );

  return fromRow(rows[0]);
}

export async function findActiveSubscriptions(productType: string, model: string, storage: string): Promise<InventorySubscription[]> {
  const rows = await query<SubscriptionRow>(
    `SELECT * FROM inventory_notification_subscriptions
     WHERE product_type = $1 AND model = $2 AND storage = $3 AND status = 'active'`,
    [productType.trim(), model.trim(), storage.trim()]
  );
  return rows.map(fromRow);
}

export async function markNotified(subscriptionId: number, productId: string): Promise<void> {
  await query(
    `UPDATE inventory_notification_subscriptions
     SET status = 'notified', notified_at = now(), matched_product_id = $2, updated_at = now()
     WHERE id = $1`,
    [subscriptionId, productId]
  );
}

export interface SubscriptionFilters {
  productType?: string;
  model?: string;
  storage?: string;
  status?: SubscriptionStatus;
}

export async function listSubscriptions(filters: SubscriptionFilters = {}): Promise<InventorySubscription[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.productType) {
    conditions.push(`product_type = $${idx++}`);
    params.push(filters.productType.trim());
  }
  if (filters.model) {
    conditions.push(`model = $${idx++}`);
    params.push(filters.model.trim());
  }
  if (filters.storage) {
    conditions.push(`storage = $${idx++}`);
    params.push(filters.storage.trim());
  }
  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<SubscriptionRow>(
    `SELECT * FROM inventory_notification_subscriptions ${where} ORDER BY signup_at DESC`,
    params
  );
  return rows.map(fromRow);
}

export async function getSubscriptionCounts(): Promise<{ productType: string; model: string; storage: string; total: number; active: number; notified: number }[]> {
  const rows = await query<{
    product_type: string;
    model: string;
    storage: string;
    total: string;
    active: string;
    notified: string;
  }>(
    `SELECT
       product_type,
       model,
       storage,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active,
       COUNT(*) FILTER (WHERE status = 'notified')::int AS notified
     FROM inventory_notification_subscriptions
     GROUP BY product_type, model, storage
     ORDER BY active DESC, product_type, model, storage`
  );
  return rows.map((r) => ({
    productType: r.product_type,
    model: r.model,
    storage: r.storage,
    total: Number(r.total),
    active: Number(r.active),
    notified: Number(r.notified),
  }));
}
