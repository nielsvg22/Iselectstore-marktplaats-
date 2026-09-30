/**
 * End-to-end voorraadmelding-tests against the real database.
 *
 * Run with:  RUN_E2E=1 npx vitest run __tests__/inventory.e2e.test.ts
 *
 * Uses a real Shopify product for the subscribe flow and synthetic
 * `E2E Test` products for the notification flow, so no real customer ever
 * receives mail and no real product is modified. All rows are cleaned up.
 */
import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// .env.local laden vóór er iets is dat DATABASE_URL/uitleest.
(function loadEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
})();

process.env.EMAIL_PROVIDER = process.env.E2E_EMAIL_PROVIDER || "mock";

import { query } from "@/lib/db";
import { POST as subscribePost } from "@/app/api/inventory/subscribe/route";
import { checkProductObjectAndNotify } from "@/services/inventory/notificationService";
import { MockEmailProvider } from "@/services/notifications/providers/mockProvider";
import { ResendEmailProvider } from "@/services/notifications/providers/resendProvider";
import { resetRateLimits } from "@/lib/rateLimit";
import type { ShopifyProduct } from "@/lib/shopify/client";
import { NextRequest } from "next/server";

const RUN = process.env.RUN_E2E === "1";
const EMAIL = "e2e-inventory-34@example.com";
const EMAIL_RACE = "e2e-inventory-5@example.com";
const EMAIL_FAIL = "e2e-inventory-6@example.com";
const TEST_TYPE = "E2E Test";
const SOLD_OUT_PRODUCT_ID = "16591922069895"; // iPad mini 256GB space grey (voorraad 0)

function synthProduct(id: string, title: string, handle: string, quantity = 1): ShopifyProduct {
  return {
    id: Number(id),
    title,
    product_type: TEST_TYPE,
    vendor: "iSelectStore",
    body_html: null,
    handle,
    images: [],
    variants: [{ id: Number(id) + 1, price: "10.00", compare_at_price: null, inventory_quantity: quantity, inventory_management: "shopify" }],
  } as ShopifyProduct;
}

function subscribeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/inventory/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://iselectstore.nl" },
    body: JSON.stringify(body),
  });
}

async function cleanup() {
  await query(
    `DELETE FROM inventory_notification_history
     WHERE subscription_id IN (SELECT id FROM inventory_notification_subscriptions WHERE product_type = $1 OR email LIKE 'e2e-inventory-%')`,
    [TEST_TYPE]
  );
  await query(`DELETE FROM inventory_notification_subscriptions WHERE product_type = $1 OR email LIKE 'e2e-inventory-%'`, [TEST_TYPE]);
}

async function subscriptionFor(email: string, storage: string) {
  const rows = await query<{ id: number; status: string }>(
    `SELECT id, status FROM inventory_notification_subscriptions
     WHERE email = $1 AND product_type = $2 AND storage = $3`,
    [email, TEST_TYPE, storage]
  );
  return rows[0];
}

async function historyCount(subscriptionId: number) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM inventory_notification_history WHERE subscription_id = $1`,
    [subscriptionId]
  );
  return Number(rows[0]?.count || 0);
}

describe.skipIf(!RUN)("Voorraadmelding E2E", () => {
  const mockSend = vi.spyOn(MockEmailProvider.prototype, "send");
  const resendSend = vi.spyOn(ResendEmailProvider.prototype, "send");

  beforeAll(async () => {
    await cleanup();
    resetRateLimits();
  });

  afterAll(async () => {
    await cleanup();
    mockSend.mockRestore();
    resendSend.mockRestore();
  });

  afterEach(() => {
    resetRateLimits();
    process.env.EMAIL_PROVIDER = "mock";
    vi.clearAllMocks();
  });

  it("scenario 1 — een geldige inschrijving wordt opgeslagen met de juiste identiteit", async () => {
    const res = await subscribePost(subscribeReq({ email: EMAIL, productId: SOLD_OUT_PRODUCT_ID }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toBe("ok");

    const rows = await query<{ product_type: string; model: string; storage: string; status: string }>(
      `SELECT product_type, model, storage, status FROM inventory_notification_subscriptions WHERE email = $1`,
      [EMAIL]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].product_type).toBe("iPad");
    expect(rows[0].storage).toBe("256GB");
    expect(rows[0].model.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe("active");
  });

  it("scenario 2 — dezelfde inschrijving tweemaal geeft already_subscribed en geen tweede record", async () => {
    const res = await subscribePost(subscribeReq({ email: EMAIL, productId: SOLD_OUT_PRODUCT_ID }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.code).toBe("already_subscribed");

    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM inventory_notification_subscriptions WHERE email = $1`,
      [EMAIL]
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("scenario 2b — een ongeldig e-mailadres wordt server-side geweigerd", async () => {
    const res = await subscribePost(subscribeReq({ email: "geen-e-mail", productId: SOLD_OUT_PRODUCT_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
  });

  it("scenario 3 — een product met ANDERE opslag stuurt geen mail naar het 256GB-abonnement", async () => {
    await query(
      `INSERT INTO inventory_notification_subscriptions (email, product_type, model, storage, signup_at, status)
       VALUES ($1,$2,$3,$4, now(), 'active')
       ON CONFLICT (email, product_type, model, storage) DO UPDATE SET status = 'active', notified_at = NULL, updated_at = now()`,
      [EMAIL, TEST_TYPE, "E2E iPhone 15 Pro", "256GB"]
    );

    const results = await checkProductObjectAndNotify(synthProduct("990000000002", "E2E iPhone 15 Pro 512GB", "e2e-iphone-15-pro-512gb"));
    const toOurMail = results.filter((r) => r.email === EMAIL);
    expect(toOurMail).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL }));
  });

  it("scenario 4 — restock van exact het juiste model + opslag stuurt exact één mail", async () => {
    mockSend.mockClear();
    const results = await checkProductObjectAndNotify(synthProduct("990000000001", "E2E iPhone 15 Pro 256GB", "e2e-iphone-15-pro-256gb"));

    const ours = results.filter((r) => r.email === EMAIL);
    expect(ours).toHaveLength(1);
    expect(ours[0].sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL, subject: "Je E2E iPhone 15 Pro 256GB is weer op voorraad" }));

    const sub = await subscriptionFor(EMAIL, "256GB");
    expect(sub?.status).toBe("notified");
    expect(await historyCount(sub!.id)).toBe(1);

    const history = await query<{ product_handle: string; status: string; product_title: string }>(
      `SELECT product_handle, status, product_title FROM inventory_notification_history WHERE subscription_id = $1`,
      [sub!.id]
    );
    expect(history[0].status).toBe("sent");
    expect(history[0].product_handle).toBe("e2e-iphone-15-pro-256gb");
    expect(history[0].product_title).toBe("E2E iPhone 15 Pro 256GB");
  });

  it("scenario 4b — een abonnement dat al gemeld is krijgt geen tweede mail", async () => {
    mockSend.mockClear();
    const results = await checkProductObjectAndNotify(synthProduct("990000000001", "E2E iPhone 15 Pro 256GB", "e2e-iphone-15-pro-256gb"));
    expect(results.filter((r) => r.email === EMAIL)).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("scenario 5 — webhook en cron tegelijk geven nog steeds exact één mail", async () => {
    await query(
      `INSERT INTO inventory_notification_subscriptions (email, product_type, model, storage, signup_at, status)
       VALUES ($1,$2,$3,$4, now(), 'active')
       ON CONFLICT (email, product_type, model, storage) DO UPDATE SET status = 'active', notified_at = NULL, updated_at = now()`,
      [EMAIL_RACE, TEST_TYPE, "E2E Race", "256GB"]
    );
    mockSend.mockClear();

    const product = synthProduct("990000000003", "E2E Race 256GB", "e2e-race-256gb");
    const [a, b, c] = await Promise.all([
      checkProductObjectAndNotify(product),
      checkProductObjectAndNotify(product),
      checkProductObjectAndNotify(product),
    ]);

    const all = [...a, ...b, ...c].filter((r) => r.email === EMAIL_RACE);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(all.filter((r) => r.sent)).toHaveLength(1);

    const sub = await subscriptionFor(EMAIL_RACE, "256GB");
    expect(sub?.status).toBe("notified");
    expect(await historyCount(sub!.id)).toBe(1);
  });

  it("scenario 6 — een falende provider laat het abonnement retrybaar en schrijft geen history", async () => {
    await query(
      `INSERT INTO inventory_notification_subscriptions (email, product_type, model, storage, signup_at, status)
       VALUES ($1,$2,$3,$4, now(), 'active')
       ON CONFLICT (email, product_type, model, storage) DO UPDATE SET status = 'active', notified_at = NULL, updated_at = now()`,
      [EMAIL_FAIL, TEST_TYPE, "E2E Falend", "256GB"]
    );
    resendSend.mockResolvedValue({ ok: false, provider: "resend", error: "429 rate limited" });
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@iselectstore.nl";

    const results = await checkProductObjectAndNotify(synthProduct("990000000004", "E2E Falend 256GB", "e2e-falend-256gb"));
    const ours = results.filter((r) => r.email === EMAIL_FAIL);
    expect(ours).toHaveLength(1);
    expect(ours[0].sent).toBe(false);
    expect(ours[0].error).toContain("rate limited");

    const sub = await subscriptionFor(EMAIL_FAIL, "256GB");
    expect(sub?.status).toBe("active");
    expect(await historyCount(sub!.id)).toBe(0);

    // Zodra de provider weer werkt, gaat de melding gewoon uit.
    process.env.EMAIL_PROVIDER = "mock";
    mockSend.mockClear();
    const retry = await checkProductObjectAndNotify(synthProduct("990000000004", "E2E Falend 256GB", "e2e-falend-256gb"));
    expect(retry.filter((r) => r.email === EMAIL_FAIL && r.sent)).toHaveLength(1);
    const after = await subscriptionFor(EMAIL_FAIL, "256GB");
    expect(after?.status).toBe("notified");
    expect(await historyCount(after!.id)).toBe(1);
  });
});
