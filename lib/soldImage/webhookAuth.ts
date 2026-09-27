import crypto from "crypto";

/** Verifies Shopify's X-Shopify-Hmac-Sha256 header against the raw request body. */
export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}
