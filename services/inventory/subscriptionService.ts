import { query } from "@/lib/db";
import { normalizeIdentity } from "@/services/shopify/productIdentity";

/**
 * active      — waiting for a restock
 * notifying   — a webhook/cron run currently owns this subscription and is
 *               sending the e-mail (short-lived lease, see claimForNotification)
 * notified    — the e-mail went out; terminal until the user re-subscribes
 * cancelled   — user opted out
 */
export type SubscriptionStatus = "active" | "notifying" | "notified" | "cancelled";

/** How long a `notifying` lease is held before another run may take over. */
const CLAIM_LEASE = "interval '10 minutes'";

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

export interface CreateSubscriptionResult {
  subscription: InventorySubscription;
  /** false when an identical (email, type, model, storage) row already existed. */
  created: boolean;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
  const normalized = normalizeIdentity(input);
  const email = input.email.trim().toLowerCase();

  const rows = await query<SubscriptionRow & { inserted: boolean }>(
    `INSERT INTO inventory_notification_subscriptions (email, product_type, model, storage, signup_at, status)
     VALUES ($1,$2,$3,$4, now(), 'active')
     ON CONFLICT (email, product_type, model, storage) DO UPDATE SET
       status = 'active',
       notified_at = NULL,
       matched_product_id = NULL,
       updated_at = now()
     RETURNING *, (xmax = 0)::boolean AS inserted`,
    [email, normalized.productType, normalized.model, normalized.storage]
  );

  const row = rows[0];
  const { inserted, ...rest } = row;
  return { subscription: fromRow(rest as SubscriptionRow), created: Boolean(inserted) };
}

export async function findActiveSubscriptions(productType: string, model: string, storage: string): Promise<InventorySubscription[]> {
  const identity = normalizeIdentity({ productType, model, storage });
  const rows = await query<SubscriptionRow>(
    `SELECT * FROM inventory_notification_subscriptions
     WHERE product_type = $1 AND model = $2 AND storage = $3 AND status = 'active'`,
    [identity.productType, identity.model, identity.storage]
  );
  return rows.map(fromRow);
}

/**
 * Atomically takes ownership of a subscription for one notification attempt.
 *
 * Two runners (webhook + cron) can both read the same active row, but only
 * one UPDATE will see `status = 'active'` and flip it to `notifying`; the
 * other gets zero rows back and skips. Combined with the unique history index
 * this guarantees at most one e-mail per (subscription, product).
 *
 * A crashed run is recovered automatically once the lease expires.
 */
export async function claimForNotification(subscriptionId: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE inventory_notification_subscriptions
     SET status = 'notifying', updated_at = now()
     WHERE id = $1
       AND (
         status = 'active'
         OR (status = 'notifying' AND updated_at < now() - ${CLAIM_LEASE})
       )
     RETURNING id`,
    [subscriptionId]
  );
  return rows.length > 0;
}

/** Releases a lease after a failed send so the next run can retry. */
export async function releaseNotificationClaim(subscriptionId: number): Promise<void> {
  await query(
    `UPDATE inventory_notification_subscriptions
     SET status = 'active', updated_at = now()
     WHERE id = $1 AND status = 'notifying'`,
    [subscriptionId]
  );
}

export async function markNotified(subscriptionId: number, productId: string): Promise<void> {
  await query(
    `UPDATE inventory_notification_subscriptions
     SET status = 'notified', notified_at = now(), matched_product_id = $2, updated_at = now()
     WHERE id = $1 AND status IN ('notifying', 'active', 'notified')`,
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
    params.push(normalizeIdentity({ productType: filters.productType }).productType);
  }
  if (filters.model) {
    conditions.push(`model = $${idx++}`);
    params.push(normalizeIdentity({ model: filters.model }).model);
  }
  if (filters.storage) {
    conditions.push(`storage = $${idx++}`);
    params.push(normalizeIdentity({ storage: filters.storage }).storage);
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

export async function getSubscriptionCounts(): Promise<{
  productType: string;
  model: string;
  storage: string;
  total: number;
  active: number;
  notified: number;
  lastSignup: string | null;
}[]> {
  const rows = await query<{
    product_type: string;
    model: string;
    storage: string;
    total: string;
    active: string;
    notified: string;
    last_signup_at: string | null;
  }>(
    `SELECT
       product_type,
       model,
       storage,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('active', 'notifying'))::int AS active,
       COUNT(*) FILTER (WHERE status = 'notified')::int AS notified,
       MAX(signup_at) AS last_signup_at
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
    lastSignup: r.last_signup_at,
  }));
}
