// Validates Shopify ID tokens (formerly "session tokens") sent by the Admin
// UI extension: HS256 signature over the app's client secret + the claim
// checks Shopify documents (exp, nbf, aud, iss/dest host match). See
// https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens
import { createHmac, timingSafeEqual } from "node:crypto";

export interface IdTokenClaims {
  dest: string;
  iss: string;
  aud: string;
  sub?: string;
  sid?: string;
  exp: number;
  nbf?: number;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function safeHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export interface VerifyOptions {
  clientSecret: string;
  clientId: string;
  /** Only tokens minted for this store are accepted. */
  expectedDestHost?: string;
  nowSeconds?: number;
}

/** Returns the token's claims when valid, otherwise null. Never throws. */
export function verifyShopifyIdToken(
  token: string | null | undefined,
  opts: VerifyOptions
): IdTokenClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  // Compare raw HMAC bytes — never the base64url *strings* (their encoding
  // alphabet differs from standard base64, so string equality would randomly
  // fail depending on the signature contents).
  const expected = createHmac("sha256", opts.clientSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = base64UrlDecode(signatureB64);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now) return null;
  if (claims.aud !== opts.clientId) return null;

  const issHost = safeHost(claims.iss || "");
  const destHost = safeHost(claims.dest || "");
  if (!issHost || !destHost || issHost !== destHost) return null;
  if (opts.expectedDestHost && destHost !== opts.expectedDestHost) return null;

  return claims;
}
