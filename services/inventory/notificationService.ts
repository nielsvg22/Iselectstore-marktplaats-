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

  const navy = "#1f3049";
  const coral = "#f9858b";
  const coralInk = "#ef6570";
  const muted = "#6b7280";
  const line = "#e7e9ec";
  const soft = "#f7f7f7";

  const imageCell = imageUrl
    ? `<td width="96" valign="top" style="padding:0 18px 0 0;">
         <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" width="96" height="96" style="width:96px;height:96px;object-fit:cover;border-radius:14px;border:1px solid ${line};display:block;" />
       </td>`
    : "";

  const priceBadge = priceText
    ? `<span style="display:inline-block;background:${soft};color:${navy};font-weight:700;font-size:14px;padding:5px 12px;border-radius:980px;margin-top:10px;">${escapeHtml(priceText)}</span>`
    : "";

  const ctaBlock = productUrl
    ? `<tr><td style="padding:28px 32px 4px;">
         <a href="${escapeHtml(productUrl)}" style="background:${coral};color:#ffffff;padding:14px 28px;border-radius:980px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
           Bekijk het product →
         </a>
       </td></tr>`
    : "";

  const html = `
  <div style="background:${soft};padding:32px 16px;font-family:'Poppins',Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${line};">
      <tr>
        <td style="background:${navy};padding:22px 32px;">
          <span style="font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${coral};">iSelectStore</span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 8px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${coralInk};">Weer op voorraad</p>
          <h1 style="margin:0 0 20px;font-size:21px;line-height:1.35;color:${navy};">${escapeHtml(heading)}</h1>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              ${imageCell}
              <td valign="top">
                <p style="margin:0;font-size:16px;font-weight:700;color:${navy};">${escapeHtml(name)}</p>
                ${identity.storage ? `<p style="margin:4px 0 0;font-size:13px;color:${muted};">Opslag: ${escapeHtml(identity.storage)}</p>` : ""}
                ${priceBadge}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${ctaBlock}
      <tr>
        <td style="padding:24px 32px 28px;">
          <hr style="border:0;border-top:1px solid ${line};margin:0 0 18px;" />
          <p style="font-size:12px;color:${muted};line-height:1.6;margin:0;">
            Je ontvangt deze melding omdat je je hebt aangemeld voor een voorraadmelding op iSelectStore.
            We sturen je maar één bericht per product.
          </p>
        </td>
      </tr>
    </table>
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
