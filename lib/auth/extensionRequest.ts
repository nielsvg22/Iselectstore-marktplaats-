// Shared request guard for the Admin UI extension endpoints: verifies the
// `Authorization: Bearer <shopify id-token>` header and applies CORS.
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyIdToken, IdTokenClaims } from "./idToken";
import { extensionCorsHeaders } from "../http/extensionCors";

function clientId(): string | undefined {
  return process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID;
}

function clientSecret(): string | undefined {
  return process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET;
}

function expectedDestHost(): string | undefined {
  return process.env.SHOPIFY_STORE_DOMAIN;
}

export type ExtensionAuthResult =
  | { ok: true; claims: IdTokenClaims; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

/** Verifies the extension's id-token and returns CORS headers for success
 * responses. On failure it returns a ready-to-send 401/500 response. */
export function authenticateExtensionRequest(req: NextRequest): ExtensionAuthResult {
  const headers = extensionCorsHeaders(req.headers.get("origin"));

  const secret = clientSecret();
  const id = clientId();
  if (!secret || !id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Shopify app-credentials zijn niet geconfigureerd." },
        { status: 500, headers }
      ),
    };
  }

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  const claims = verifyShopifyIdToken(token, {
    clientSecret: secret,
    clientId: id,
    expectedDestHost: expectedDestHost(),
  });
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Niet geauthenticeerd vanuit Shopify Admin." },
        { status: 401, headers }
      ),
    };
  }

  return { ok: true, claims, headers };
}
