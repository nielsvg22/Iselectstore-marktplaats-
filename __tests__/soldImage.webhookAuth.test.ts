import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyShopifyWebhookHmac } from "../lib/soldImage/webhookAuth";

describe("verifyShopifyWebhookHmac", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ id: 123, variants: [] });

  it("accepts a correctly signed body", () => {
    const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyShopifyWebhookHmac(body, hmac, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyShopifyWebhookHmac(body + "x", hmac, secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyShopifyWebhookHmac(body, null, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const hmac = crypto.createHmac("sha256", "other-secret").update(body, "utf8").digest("base64");
    expect(verifyShopifyWebhookHmac(body, hmac, secret)).toBe(false);
  });
});
