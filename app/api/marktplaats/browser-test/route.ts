import { NextRequest, NextResponse } from "next/server";
import { marktplaatsService } from "@/lib/marktplaats/service";
import { marktplaatsApiPublisher } from "@/lib/marktplaats/apiPublisher";
import { MarktplaatsBrowserTestPublisher } from "@/lib/marktplaats/browserTest/browserTestPublisher";
import { getBrowserTestConfig, isBrowserTestEnabled } from "@/lib/marktplaats/browserTest/config";
import { hasRemoteBrowserTest, proxyToRemoteBrowserTest } from "@/lib/marktplaats/browserTest/remoteProxy";
import {
  createRun,
  findActiveRunForProduct,
  getRun,
  isRunActive,
  recordStatus,
  serializeRun,
  setState,
  compactMessage,
} from "@/lib/marktplaats/browserTest/status";
import { humanizeError, logSync } from "@/lib/logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function safeLog(action: string, shopifyProductId?: string, message?: string) {
  try {
    await logSync({ action, shopifyProductId, message });
  } catch {
    /* logging must never break the browser test */
  }
}

/**
 * GET /api/marktplaats/browser-test            → config (for the UI)
 * GET /api/marktplaats/browser-test?runId=…    → live status of one run
 */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  const config = getBrowserTestConfig();

  if (!config.enabled && hasRemoteBrowserTest()) {
    return proxyToRemoteBrowserTest(req, "/api/marktplaats/browser-test");
  }

  if (runId) {
    const run = getRun(runId);
    if (!run) return NextResponse.json({ error: "Onbekende testrun." }, { status: 404 });
    return NextResponse.json({ run: serializeRun(run), active: isRunActive(runId) });
  }

  return NextResponse.json({
    enabled: isBrowserTestEnabled(),
    allowSubmit: config.allowSubmit,
    apiConfigured: marktplaatsApiPublisher.isConfigured(),
    placementUrl: config.placementUrl,
    profileDir: config.profileDir,
    // Only present when deployed with a separate noVNC service (e.g.
    // Coolify) — lets the admin UI embed the live browser view directly.
    // Sent to whoever can already load this admin page; there is no extra
    // auth boundary here beyond that today (see MARKTPLAATS_INTEGRATION.md).
    novncUrl: config.novncUrl,
    novncPassword: config.novncPassword,
  });
}

/**
 * POST /api/marktplaats/browser-test  { shopifyProductId }
 *
 * Validates first, then starts the LOCAL Playwright test in the background
 * and returns a runId the admin panel polls. The browser is never closed and
 * the advertisement is never published while ALLOW_SUBMIT is false.
 */
export async function POST(req: NextRequest) {
  if (!isBrowserTestEnabled() && hasRemoteBrowserTest()) {
    return proxyToRemoteBrowserTest(req, "/api/marktplaats/browser-test");
  }

  const { shopifyProductId } = await req.json().catch(() => ({}) as { shopifyProductId?: string });
  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is verplicht" }, { status: 400 });
  }

  if (!isBrowserTestEnabled()) {
    return NextResponse.json(
      {
        error:
          "De Marktplaats-browsertest staat uit. Zet MARKTPLAATS_BROWSER_TEST=true in .env.local en start de dev-server opnieuw.",
      },
      { status: 403 }
    );
  }

  const active = findActiveRunForProduct(shopifyProductId);
  if (active) {
    return NextResponse.json(
      { error: "Er draait al een Marktplaats-browsertest voor dit product. Wacht tot deze klaar is.", runId: active.runId },
      { status: 409 }
    );
  }

  let draft;
  try {
    draft = await marktplaatsService.buildAdvertisement(shopifyProductId);
  } catch (err) {
    const message = compactMessage(humanizeError(err instanceof Error ? err.message : String(err)));
    await safeLog("browser_test_error", shopifyProductId, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const validation = marktplaatsService.validateAdvertisement(draft);
  if (!validation.publishable) {
    return NextResponse.json(
      { error: "Validatie bevat errors — vul de ontbrekende Shopify-gegevens eerst aan.", validation },
      { status: 422 }
    );
  }

  const run = createRun(shopifyProductId);
  run.title = draft.title;
  recordStatus(run, { field: "Validatie", status: "ok", detail: `${validation.checks.filter((c) => c.status === "ok").length} checks OK` });
  await safeLog("browser_test_start", shopifyProductId, `Gestart voor "${draft.title}"`);

  // Deliberately not awaited: the run can take minutes (manual login) and the
  // UI polls GET ?runId= for progress instead of holding this request open.
  void (async () => {
    try {
      const publisher = new MarktplaatsBrowserTestPublisher(run);
      await publisher.runDraft(draft);
      await safeLog("browser_test_done", shopifyProductId, run.message ?? "Klaar");
    } catch (err) {
      const message = compactMessage(humanizeError(err instanceof Error ? err.message : String(err)));
      recordStatus(run, { field: "Browser", status: "error", detail: message });
      setState(run, "failed", message);
      await safeLog("browser_test_error", shopifyProductId, message);
    } finally {
      if (run.state === "queued" || run.state === "running" || run.state === "waiting_login" || run.state === "waiting_code") {
        setState(run, "done", run.message ?? "Klaar");
      }
    }
  })();

  return NextResponse.json(
    {
      runId: run.runId,
      title: draft.title,
      validation,
      imageCount: draft.imageUrls.length,
      fieldCount: draft.fields.length,
      allowSubmit: getBrowserTestConfig().allowSubmit,
    },
    { status: 202 }
  );
}
