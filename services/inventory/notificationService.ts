import { ShopifyProduct, getProduct, listProducts } from "@/lib/shopify/client";
import { extractProductIdentity, ProductIdentity } from "@/services/shopify/productIdentity";
import { findActiveSubscriptions, markNotified } from "./subscriptionService";
import { recordNotificationHistory, hasNotificationBeenSent } from "./notificationHistoryService";
import { createEmailProvider } from "@/services/notifications/emailProviderFactory";

export interface MatchResult {
  subscriptionId: number;
  email: string;
  productId: string;
  sent: boolean;
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

function buildProductUrl(domain: string, handle: string): string {
  return `https://${domain}/products/${handle}`;
}

function buildEmailHtml(params: {
  product: ShopifyProduct;
  identity: ProductIdentity;
  productUrl: string;
  imageUrl?: string;
}): { subject: string; html: string; text: string } {
  const { product, identity, productUrl, imageUrl } = params;
  const price = product.variants[0]?.price;
  const priceText = price ? `€ ${price}` : "Bekijk prijs in de shop";

  const subject = `${product.title} ${identity.storage} is weer beschikbaar`;

  const imageBlock = imageUrl
    ? `<img src="${imageUrl}" alt="${product.title}" style="max-width:320px;border-radius:12px;margin:16px 0;" />`
    : "";

  const html = `
    <div style="font-family:'Poppins',Arial,sans-serif;color:#1f3049;max-width:480px;">
      <h2 style="color:#1f3049;">Goed nieuws — dit toestel is weer op voorraad!</h2>
      <p>Je hebt je aangemeld voor een voorraadmelding voor:</p>
      <p style="font-size:18px;font-weight:700;">${product.title} ${identity.storage}</p>
      ${imageBlock}
      <p><strong>Prijs:</strong> ${priceText}</p>
      <p style="margin-top:24px;">
        <a href="${productUrl}" style="background:#f9858b;color:#fff;padding:14px 24px;border-radius:980px;text-decoration:none;font-weight:600;display:inline-block;">
          Bekijk product →
        </a>
      </p>
      <hr style="border:0;border-top:1px solid #e7e9ec;margin:32px 0;" />
      <p style="font-size:12px;color:#6b7280;">
        Je ontvangt deze melding omdat je je hebt aangemeld op iSelectStore.nl.
        <a href="${productUrl}">Bekijk het product</a>.
      </p>
    </div>
  `;

  const text = `Goed nieuws — ${product.title} ${identity.storage} is weer op voorraad. Prijs: ${priceText}. Bekijk: ${productUrl}`;

  return { subject, html, text };
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
  const identity = extractProductIdentity(product);

  if (!identity.productType || !identity.model || !identity.storage) {
    return results;
  }

  if (!isAvailable(product)) {
    return results;
  }

  const subscriptions = await findActiveSubscriptions(identity.productType, identity.model, identity.storage);
  if (subscriptions.length === 0) {
    return results;
  }

  const provider = createEmailProvider();
  const domain = process.env.SHOPIFY_STORE_DOMAIN || "";
  const productUrl = buildProductUrl(domain, product.title.toLowerCase().replace(/\s+/g, "-"));
  const imageUrl = getPrimaryImageUrl(product);
  const price = product.variants[0]?.price ? parseFloat(product.variants[0].price) : undefined;

  for (const subscription of subscriptions) {
    if (await hasNotificationBeenSent(subscription.id, String(product.id))) {
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId: String(product.id), sent: false });
      continue;
    }

    const { subject, html, text } = buildEmailHtml({ product, identity, productUrl, imageUrl });
    const sendResult = await provider.send({ to: subscription.email, subject, html, text });

    if (sendResult.ok) {
      await markNotified(subscription.id, String(product.id));
      await recordNotificationHistory({
        subscriptionId: subscription.id,
        productId: String(product.id),
        productTitle: product.title,
        productHandle: product.title.toLowerCase().replace(/\s+/g, "-"),
        productImageUrl: imageUrl,
        productPrice: price,
        provider: sendResult.provider,
        status: "sent",
      });
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId: String(product.id), sent: true });
    } else {
      await recordNotificationHistory({
        subscriptionId: subscription.id,
        productId: String(product.id),
        productTitle: product.title,
        provider: sendResult.provider,
        status: "failed",
        errorMessage: sendResult.error,
      });
      results.push({ subscriptionId: subscription.id, email: subscription.email, productId: String(product.id), sent: false, error: sendResult.error });
    }
  }

  return results;
}

/**
 * Scans all products (useful for cron / backfill) and notifies matching subscriptions.
 * Returns a summary per product identity.
 */
export async function scanAllProductsAndNotify(limit = 250): Promise<{
  scanned: number;
  matchedProducts: number;
  notificationsSent: number;
  errors: number;
}> {
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
    } catch {
      errors++;
    }
  }

  return { scanned: products.length, matchedProducts, notificationsSent, errors };
}
