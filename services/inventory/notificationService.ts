import { ShopifyProduct, getProduct, listProducts } from "@/lib/shopify/client";
import { resolveProductIdentity, ProductIdentity } from "@/services/shopify/productIdentity";
import {
  claimForNotification,
  releaseNotificationClaim,
  markNotified,
  findActiveSubscriptions,
} from "./subscriptionService";
import { recordSentNotification, hasNotificationBeenSent } from "./notificationHistoryService";
import { createEmailProvider } from "@/services/notifications/emailProviderFactory";
import { logSync } from "@/lib/logging";

export interface MatchResult {
  subscriptionId: number;
  email: string;
  productId: string;
  sent: boolean;
  skipped?: "already_sent" | "claimed_elsewhere" | "no_link";
  error?: string;
}

function getPrimaryImageUrl(product: ShopifyProduct): string | undefined {
  return product.images?.[0]?.src;
}

function getInventoryQuantity(product: ShopifyProduct): number {
  const tracked = product.variants.filter((v) => v.inventory_management);
  if (tracked.length === 0) return 0;
  return tracked.reduce((sum, v) => sum + v.inventory_quantity, 0);
}

function isAvailable(product: ShopifyProduct): boolean {
  return getInventoryQuantity(product) > 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Public storefront origin used for the e-mail CTA.
 * Priority: SHOPIFY_STOREFRONT_URL (custom domain) -> https://SHOPIFY_STORE_DOMAIN.
 * Never a hardcoded test/Vercel URL.
 */
export function getStorefrontBase(): string {
  const explicit = (process.env.SHOPIFY_STOREFRONT_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit.replace(/^http:\/\//i, "https://");

  const domain = (process.env.SHOPIFY_STORE_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return domain ? `https://${domain}` : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Canonical product URL: Shopify handle when available, title slug only as a
 * last resort. Returns "" when no storefront origin is configured so we never
 * ship a broken link.
 */
export function getProductUrl(product: ShopifyProduct): string {
  const base = getStorefrontBase();
  if (!base) return "";
  const handle = (product.handle || "").trim() || slugify(product.title || "");
  if (!handle) return "";
  return `${base}/products/${handle}`;
}

function displayIdentity(identity: ProductIdentity, product: ShopifyProduct): string {
  const model = identity.model || product.title;
  return [model, identity.storage].filter(Boolean).join(" ");
}

export function buildEmailHtml(params: {
  product: ShopifyProduct;
  identity: ProductIdentity;
  productUrl: string;
  imageUrl?: string;
}): { subject: string; html: string; text: string } {
  const { product, identity, productUrl, imageUrl } = params;
  const name = displayIdentity(identity, product);
  const price = product.variants[0]?.price;
  const priceText = price ? `€ ${price}` : "";

  const subject = `Je ${name} is weer op voorraad`;
  const heading = `${name} is weer op voorraad`;

  const imageBlock = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" width="320" style="max-width:320px;height:auto;border-radius:12px;margin:16px 0;display:block;" />`
    : "";

  const ctaBlock = productUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${escapeHtml(productUrl)}" style="background:#f9858b;color:#fff;padding:14px 26px;border-radius:980px;text-decoration:none;font-weight:600;display:inline-block;">
           Bekijk het product
         </a>
       </p>`
    : "";

  const priceBlock = priceText ? `<p style="margin:12px 0 0;"><strong>Prijs:</strong> ${escapeHtml(priceText)}</p>` : "";

  const linkLine = productUrl
    ? `<p style="margin:6px 0 0;">Direct bekijken: <a href="${escapeHtml(productUrl)}" style="color:#1f3049;">${escapeHtml(productUrl)}</a></p>`
    : "";

  const html = `
  <div style="font-family:'Poppins',Arial,Helvetica,sans-serif;color:#1f3049;max-width:520px;margin:0 auto;line-height:1.6;">
    <div style="font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#f9858b;margin-bottom:14px;">
      iSelectStore
    </div>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;color:#1f3049;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 4px;">Hoi,</p>
    <p style="margin:0 0 4px;">goed nieuws: het toestel waarvoor je je hebt aangemeld is weer beschikbaar:</p>
    <p style="font-size:18px;font-weight:700;margin:14px 0 0;">${escapeHtml(name)}</p>
    ${identity.storage ? `<p style="margin:2px 0 0;font-size:14px;color:#6b7280;">Opslag: ${escapeHtml(identity.storage)}</p>` : ""}
    ${imageBlock}
    ${priceBlock}
    ${ctaBlock}
    <hr style="border:0;border-top:1px solid #e7e9ec;margin:32px 0 16px;" />
    <p style="font-size:12px;color:#6b7280;margin:0;">
      Je ontvangt deze melding omdat je je hebt aangemeld voor een voorraadmelding op iSelectStore.
      We sturen je maar één bericht per product.
    </p>
    ${linkLine}
  </div>`;

  const text = [
    "iSelectStore",
    "",
    heading,
    "",
    `Hoi,`,
    `goed nieuws: het toestel waarvoor je je hebt aangemeld is weer beschikbaar: ${name}`,
    identity.storage ? `Opslag: ${identity.storage}` : null,
    priceText ? `Prijs: ${priceText}` : null,
    productUrl ? "" : null,
    productUrl ? `Bekijk het product: ${productUrl}` : null,
    "",
    "Je ontvangt deze melding omdat je je hebt aangemeld voor een voorraadmelding op iSelectStore. We sturen je maar één bericht per product.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, html, text };
}

async function logNotificationError(productId: string, message: string): Promise<void> {
  console.error(`[inventory-notification] ${message}`);
  await logSync({ shopifyProductId: productId, action: "inventory_notification_error", message }).catch(() => {});
}

/**
 * Checks a single product for active subscriptions and sends notifications.
 * Idempotent: a subscription/product pair is only ever notified once.
 */
export async function checkProductAndNotify(productId: string): Promise<MatchResult[]> {
  const product = await getProduct(productId);
  return checkProductObjectAndNotify(product);
}

export async function checkProductObjectAndNotify(product: ShopifyProduct): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  const productId = String(product.id);
  const identity = await resolveProductIdentity(product);

  // Storage may legitimately be empty (products without a capacity), but a
  // subscription can never be matched without type + model.
  if (!identity.productType || !identity.model) {
    return results;
  }

  if (!isAvailable(product)) {
    return results;
  }

  const subscriptions = await findActiveSubscriptions(identity.productType, identity.model, identity.storage);
  if (subscriptions.length === 0) {
    return results;
  }

  // Throws when the production e-mail configuration is missing/invalid —
  // callers surface that instead of silently pretending mail went out.
  const provider = createEmailProvider();

  const productUrl = getProductUrl(product);
  if (!productUrl) {
    await logNotificationError(productId, "Geen storefront-URL geconfigureerd (SHOPIFY_STOREFRONT_URL / SHOPIFY_STORE_DOMAIN) — e-mail overgeslagen.");
    return subscriptions.map((s) => ({
      subscriptionId: s.id,
      email: s.email,
      productId,
      sent: false,
      skipped: "no_link" as const,
      error: "no_storefront_url",
    }));
  }

  const imageUrl = getPrimaryImageUrl(product);
  const price = product.variants[0]?.price ? parseFloat(product.variants[0].price) : undefined;
  const handle = (product.handle || "").trim() || slugify(product.title || "");
  const { subject, html, text } = buildEmailHtml({ product, identity, productUrl, imageUrl });

  for (const subscription of subscriptions) {
    if (await hasNotificationBeenSent(subscription.id, productId)) {
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId, sent: false, skipped: "already_sent" });
      continue;
    }

    // Atomic lease: only one webhook/cron run can win this row.
    if (!(await claimForNotification(subscription.id))) {
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId, sent: false, skipped: "claimed_elsewhere" });
      continue;
    }

    let sendResult;
    try {
      sendResult = await provider.send({ to: subscription.email, subject, html, text });
    } catch (err) {
      sendResult = { ok: false, provider: provider.name, error: err instanceof Error ? err.message : String(err) };
    }

    if (sendResult.ok) {
      // History insert is unique per (subscription, product) — the final guard.
      const recorded = await recordSentNotification({
        subscriptionId: subscription.id,
        productId,
        productTitle: product.title,
        productHandle: handle,
        productImageUrl: imageUrl,
        productPrice: price,
        provider: sendResult.provider,
      });
      if (recorded) {
        await markNotified(subscription.id, productId);
      }
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId, sent: recorded });
    } else {
      // Provider failed: release the lease so the next webhook/cron retries,
      // and write NO history row (only successful sends are recorded).
      await releaseNotificationClaim(subscription.id);
      await logNotificationError(productId, `E-mail mislukt voor subscription ${subscription.id}: ${sendResult.error || "onbekende fout"}`);
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId, sent: false, error: sendResult.error });
    }
  }

  return results;
}

/**
 * Scans all products (useful for cron / backfill) and notifies matching subscriptions.
 * Returns a summary per product identity.
 */
export async function scanAllProductsAndNotify(limit = 1000): Promise<{
  scanned: number;
  matchedProducts: number;
  notificationsSent: number;
  errors: number;
}> {
  // Fail fast on a broken provider config so the cron response says so
  // instead of returning a quiet all-zeros summary.
  createEmailProvider();

  const products = await listProducts(limit);
  let matchedProducts = 0;
  let notificationsSent = 0;
  let errors = 0;

  for (const product of products) {
    try {
      const results = await checkProductObjectAndNotify(product);
      if (results.length > 0) matchedProducts++;
      notificationsSent += results.filter((r) => r.sent).length;
      errors += results.filter((r) => !r.sent && r.error).length;
    } catch (err) {
      errors++;
      console.error(`[inventory-notification] scan-fout voor product ${product.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { scanned: products.length, matchedProducts, notificationsSent, errors };
}
