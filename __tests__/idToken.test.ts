import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyShopifyIdToken } from "@/lib/auth/idToken";

const SECRET = "test-client-secret";
const CLIENT_ID = "db247c0b3b7c65f9b5d8d798ae30b925";
const DEST = "https://ggh8q9-v1.myshopify.com";

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>, secret = SECRET, alg = "HS256"): string {
  const header = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const NOW = 1_800_000_000;
const baseClaims = {
  iss: `${DEST}/admin`,
  dest: DEST,
  aud: CLIENT_ID,
  sub: "42",
  sid: "session-1",
  exp: NOW + 60,
  nbf: NOW - 60,
  iat: NOW - 60,
};

const opts = { clientSecret: SECRET, clientId: CLIENT_ID, expectedDestHost: "ggh8q9-v1.myshopify.com", nowSeconds: NOW };

describe("verifyShopifyIdToken — extension endpoint auth", () => {
  it("accepts a valid token", () => {
    const claims = verifyShopifyIdToken(sign(baseClaims), opts);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("42");
    expect(claims?.dest).toBe(DEST);
  });

  it("rejects a missing/garbage token", () => {
    expect(verifyShopifyIdToken(null, opts)).toBeNull();
    expect(verifyShopifyIdToken("", opts)).toBeNull();
    expect(verifyShopifyIdToken("not-a-jwt", opts)).toBeNull();
    expect(verifyShopifyIdToken("a.b", opts)).toBeNull();
  });

  it("rejects a wrong signature (other client secret)", () => {
    expect(verifyShopifyIdToken(sign(baseClaims, "other-secret"), opts)).toBeNull();
  });

  it("rejects an expired token or one from the future", () => {
    expect(verifyShopifyIdToken(sign({ ...baseClaims, exp: NOW - 1 }), opts)).toBeNull();
    expect(verifyShopifyIdToken(sign({ ...baseClaims, nbf: NOW + 30 }), opts)).toBeNull();
  });

  it("rejects a token issued for another app (aud)", () => {
    expect(verifyShopifyIdToken(sign({ ...baseClaims, aud: "someone-else" }), opts)).toBeNull();
  });

  it("rejects iss/dest host mismatch and foreign stores", () => {
    expect(
      verifyShopifyIdToken(sign({ ...baseClaims, iss: "https://evil.myshopify.com/admin" }), opts)
    ).toBeNull();
    expect(
      verifyShopifyIdToken(sign({ ...baseClaims, dest: "https://other.myshopify.com" }), opts)
    ).toBeNull();
    expect(verifyShopifyIdToken(sign({ ...baseClaims, dest: "not-a-url" }), opts)).toBeNull();
  });

  it("rejects non-HS256 algorithms", () => {
    expect(verifyShopifyIdToken(sign(baseClaims, SECRET, "none"), opts)).toBeNull();
  });

  it("accepts signatures that use base64url-specific characters (- and _)", () => {
    // Guards against comparing encoded strings instead of raw HMAC bytes:
    // with a naive string compare these tokens fail depending on chance.
    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const token = sign({ ...baseClaims, sub: String(i) });
      const signature = token.split(".")[2];
      if (/-|_/.test(signature)) {
        expect(verifyShopifyIdToken(token, opts)).not.toBeNull();
        checked++;
        if (checked === 3) break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
