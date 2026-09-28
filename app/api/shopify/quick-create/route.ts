// Admin UI extension endpoint: creates a Shopify product from an iSelect
// template. Authenticated with the Shopify id-token the extension sends.
// De body-verwerking/creatie zelf leeft in lib/http/quickCreateHandler.ts en
// wordt gedeeld met de interne beheerapp-route.
import { NextRequest } from "next/server";
import { authenticateExtensionRequest } from "@/lib/auth/extensionRequest";
import { handleExtensionOptions } from "@/lib/http/extensionCors";
import { handleQuickCreatePost } from "@/lib/http/quickCreateHandler";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleExtensionOptions(req);
}

export async function POST(req: NextRequest) {
  const auth = authenticateExtensionRequest(req);
  if (!auth.ok) return auth.response;
  return handleQuickCreatePost(req, auth.headers);
}
