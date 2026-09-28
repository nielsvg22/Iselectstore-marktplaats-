// Interne beheerapp-endpoint: zelfde creatie-logica als de extension-route,
// bedoeld voor de server-side beheerpagina /admin/quick-create die geen
// Shopify idToken kan meesturen (zoals /api/ai/* en de marktplaats-routes).
import { NextRequest } from "next/server";
import { handleQuickCreatePost } from "@/lib/http/quickCreateHandler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleQuickCreatePost(req);
}
