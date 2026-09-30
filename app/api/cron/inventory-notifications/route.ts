import { NextRequest, NextResponse } from "next/server";
import { scanAllProductsAndNotify } from "@/services/inventory/notificationService";
import { EmailConfigError } from "@/services/notifications/emailProviderFactory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron fallback: scans the catalogue for products that are back in stock and
 * notifies matching subscriptions.
 *
 * Auth is fail-closed in production — without CRON_SECRET the route refuses to
 * run rather than staying publicly callable.
 */
function isAuthorized(req: NextRequest): { ok: boolean; reason?: string } {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";

  if (!secret) {
    const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    if (production) return { ok: false, reason: "CRON_SECRET ontbreekt in de productie-omgeving." };
    return { ok: true };
  }

  if (auth !== `Bearer ${secret}`) {
    return { ok: false, reason: "Ongeldige autorisatie." };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    console.error(`[inventory-cron] Geweigerd: ${auth.reason}`);
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  try {
    const summary = await scanAllProductsAndNotify(1000);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[inventory-cron] ${message}`);
    return NextResponse.json(
      { error: message, code: err instanceof EmailConfigError ? "email_not_configured" : "error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
