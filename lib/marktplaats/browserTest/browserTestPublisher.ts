// MarktplaatsBrowserTestPublisher — Playwright-based form-fill test against
// the REAL marktplaats.nl site. This is explicitly a mapping-verification
// tool, NOT the production publish path (that is lib/marktplaats/publishService.ts,
// the future official-API MarktplaatsApiPublisher). It must never be able to
// place a real advertisement by accident — see assertSubmitGuard() below,
// which is checked independently of whatever selector logic exists.
//
// Local/dev-only by design: launches a headed, visible Chromium window so a
// human can inspect the filled-in form. Does not run on Vercel/Coolify.
//
// Uses a persistent browser profile (launchPersistentContext) so a human
// logging into Marktplaats once keeps that session for subsequent runs —
// no credentials are ever read, stored, or committed by this code.

import { chromium, BrowserContext, Page } from "playwright";
import { mkdir } from "fs/promises";
import { BrowserFieldPlanItem, BrowserTestPlan, BrowserTestResult, FieldFillResult } from "./types";
import { downloadImages, cleanupImages } from "./imageDownloader";

const FIELD_TIMEOUT_MS = 4000;
const POST_AD_ENTRY_PATTERN = /plaats.*advertentie/i;

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

function isBrowserTestEnabled(): boolean {
  return env("MARKTPLAATS_BROWSER_TEST").toLowerCase() === "true";
}

function isSubmitAllowed(): boolean {
  return env("MARKTPLAATS_BROWSER_ALLOW_SUBMIT").toLowerCase() === "true";
}

/**
 * Hard guard: independent of whatever selector/click logic exists elsewhere
 * in this file. Any future code path that would perform the final
 * "plaats advertentie" submit MUST call this first and MUST stop if it
 * throws. Never remove this call to "simplify" the flow.
 */
function assertSubmitGuard(): void {
  if (!isSubmitAllowed()) {
    throw new Error(
      "MARKTPLAATS_BROWSER_ALLOW_SUBMIT staat niet op 'true' — automatisch publiceren via de browsertest is hard geblokkeerd. " +
        "Dit is een bewuste veiligheidsgrens, geen bug."
    );
  }
}

function profileDir(): string {
  return env("MARKTPLAATS_BROWSER_PROFILE_DIR", ".marktplaats-browser-profile");
}

function baseUrl(): string {
  return env("MARKTPLAATS_BASE_URL", "https://www.marktplaats.nl");
}

async function findPostAdEntryAndNavigate(page: Page, log: string[]): Promise<boolean> {
  const explicitListingUrl = env("MARKTPLAATS_LISTING_URL");
  if (explicitListingUrl) {
    log.push(`MARKTPLAATS_LISTING_URL ingesteld — navigeer direct naar ${explicitListingUrl}`);
    await page.goto(explicitListingUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    return true;
  }

  await page.goto(baseUrl(), { waitUntil: "domcontentloaded", timeout: 20000 });

  const candidates = [
    page.getByRole("link", { name: POST_AD_ENTRY_PATTERN }),
    page.getByRole("button", { name: POST_AD_ENTRY_PATTERN }),
    page.getByText(POST_AD_ENTRY_PATTERN, { exact: false }),
  ];

  for (const candidate of candidates) {
    try {
      const el = candidate.first();
      await el.waitFor({ state: "visible", timeout: 5000 });
      await el.click();
      await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
      log.push('"Plaats advertentie"-link gevonden en aangeklikt vanaf de homepage.');
      return true;
    } catch {
      // try next candidate
    }
  }

  log.push(
    'Kon geen "Plaats advertentie"-link vinden op de homepage. Navigeer handmatig naar de juiste pagina in het geopende venster, ' +
      "of zet MARKTPLAATS_LISTING_URL zodra je de echte URL kent."
  );
  return false;
}

/** True if this looks like Marktplaats' login screen rather than the posting form. */
async function looksLikeLoginScreen(page: Page): Promise<boolean> {
  try {
    const passwordField = page.locator('input[type="password"]').first();
    return await passwordField.isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

async function waitForManualLogin(page: Page, log: string[]): Promise<void> {
  log.push("Login-scherm gedetecteerd — log handmatig in in het geopende browservenster. De sessie wordt daarna onthouden.");
  const maxWaitMs = 5 * 60 * 1000;
  const pollMs = 2000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(pollMs);
    if (!(await looksLikeLoginScreen(page))) {
      log.push("Login gedetecteerd als voltooid — ga verder.");
      return;
    }
  }
  log.push("Nog steeds op het loginscherm na 5 minuten wachten — ga toch verder (velden invullen kan hierna mislukken).");
}

async function tryTextLikeField(page: Page, item: BrowserFieldPlanItem): Promise<FieldFillResult> {
  const strategies: (() => ReturnType<Page["getByLabel"]>)[] = [];
  for (const label of item.labels) {
    strategies.push(() => page.getByLabel(label, { exact: false }));
    strategies.push(() => page.getByPlaceholder(label, { exact: false }));
    strategies.push(() => page.getByRole(item.kind === "textarea" ? "textbox" : "textbox", { name: label }));
  }

  for (const strategy of strategies) {
    try {
      const locator = strategy().first();
      await locator.waitFor({ state: "visible", timeout: FIELD_TIMEOUT_MS });
      await locator.fill(item.value);
      return { key: item.key, label: item.labels[0], status: "filled" };
    } catch {
      // try next strategy
    }
  }

  return { key: item.key, label: item.labels[0], status: "not_found", detail: `Geen veld gevonden voor label(s): ${item.labels.join(", ")}` };
}

async function trySelectField(page: Page, item: BrowserFieldPlanItem): Promise<FieldFillResult> {
  const valuesToTry = [item.value, ...(item.valueSynonyms ?? [])];

  for (const label of item.labels) {
    try {
      const locator = page.getByLabel(label, { exact: false }).first();
      await locator.waitFor({ state: "visible", timeout: FIELD_TIMEOUT_MS });
      const tagName = await locator.evaluate((el) => el.tagName);

      if (tagName === "SELECT") {
        for (const value of valuesToTry) {
          try {
            await locator.selectOption({ label: value });
            return { key: item.key, label, status: "selected", detail: value };
          } catch {
            // try next value synonym
          }
        }
        return { key: item.key, label, status: "error", detail: `Geen van de waarden (${valuesToTry.join(", ")}) kon geselecteerd worden in dit dropdown-veld.` };
      }

      // Custom combobox: open it, then click a matching option by text.
      await locator.click();
      for (const value of valuesToTry) {
        try {
          const option = page.getByRole("option", { name: value, exact: false }).first();
          await option.waitFor({ state: "visible", timeout: FIELD_TIMEOUT_MS });
          await option.click();
          return { key: item.key, label, status: "selected", detail: value };
        } catch {
          // try next value synonym
        }
      }
    } catch {
      // try next label
    }
  }

  return { key: item.key, label: item.labels[0], status: "not_found", detail: `Geen select/combobox gevonden voor label(s): ${item.labels.join(", ")}` };
}

async function fillField(page: Page, item: BrowserFieldPlanItem): Promise<FieldFillResult> {
  try {
    if (item.kind === "select") return await trySelectField(page, item);
    return await tryTextLikeField(page, item);
  } catch (err) {
    return { key: item.key, label: item.labels[0], status: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function uploadImages(page: Page, imagePaths: string[], log: string[]): Promise<{ uploaded: number; failed: number }> {
  if (imagePaths.length === 0) return { uploaded: 0, failed: 0 };

  const fileInputCandidates = [page.locator('input[type="file"]').first(), page.getByLabel(/foto|afbeelding/i).first()];

  for (const candidate of fileInputCandidates) {
    try {
      await candidate.waitFor({ state: "attached", timeout: FIELD_TIMEOUT_MS });
      await candidate.setInputFiles(imagePaths);
      return { uploaded: imagePaths.length, failed: 0 };
    } catch {
      // try next candidate
    }
  }

  log.push("Geen file-upload veld gevonden voor afbeeldingen (geprobeerd: input[type=file], label bevat 'foto'/'afbeelding').");
  return { uploaded: 0, failed: imagePaths.length };
}

/**
 * Opens a real, visible Marktplaats session, fills in as much of the form
 * as it can from `plan`, uploads the product images, and then STOPS. Never
 * closes the browser context and never clicks a final submit/publish
 * control — see assertSubmitGuard().
 */
export async function runBrowserTest(plan: BrowserTestPlan): Promise<BrowserTestResult> {
  const startedAt = new Date().toISOString();
  const allowSubmit = isSubmitAllowed();
  const log: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isBrowserTestEnabled()) {
    throw new Error("MARKTPLAATS_BROWSER_TEST staat niet op 'true' — deze testfunctie is uitgeschakeld.");
  }
  if (process.env.VERCEL) {
    throw new Error("De Marktplaats-browsertest is alleen lokaal beschikbaar (npm run dev), niet op Vercel.");
  }

  await mkdir(profileDir(), { recursive: true });

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir(), {
      headless: false,
      viewport: null,
    });
  } catch (err) {
    throw new Error(`Kon geen browser starten: ${err instanceof Error ? err.message : String(err)}`);
  }

  const page = context.pages()[0] ?? (await context.newPage());

  const { dir: imagesDir, images, failed: downloadFailed } = await downloadImages(plan.imageUrls);
  if (downloadFailed.length > 0) {
    warnings.push(`${downloadFailed.length} van ${plan.imageUrls.length} afbeelding(en) konden niet gedownload worden.`);
  }

  const fieldResults: FieldFillResult[] = [];

  try {
    const navigated = await findPostAdEntryAndNavigate(page, log);
    if (!navigated) warnings.push("Kon de plaats-advertentie-pagina niet automatisch vinden — controleer het browservenster.");

    if (await looksLikeLoginScreen(page)) {
      await waitForManualLogin(page, log);
    }

    for (const item of plan.fields) {
      const result = await fillField(page, item);
      fieldResults.push(result);
      if (result.status === "error") errors.push(`${result.label}: ${result.detail}`);
      if (result.status === "not_found" && item.required) warnings.push(`Verplicht veld niet gevonden: ${result.label}`);
    }

    const { uploaded, failed } = await uploadImages(
      page,
      images.map((i) => i.path),
      log
    );
    fieldResults.push({
      key: "images",
      label: "Afbeeldingen",
      status: uploaded > 0 ? "filled" : "not_found",
      detail: `${uploaded} geüpload${failed > 0 ? `, ${failed} mislukt` : ""}`,
    });

    // Explicit, independent guard — stays in place even if selector logic
    // above changes. No submit/publish click exists anywhere in this file.
    if (allowSubmit) {
      assertSubmitGuard();
      log.push(
        "MARKTPLAATS_BROWSER_ALLOW_SUBMIT=true, maar deze versie van de testfunctie implementeert bewust geen submit-actie. " +
          "Publiceren blijft een handmatige stap in het geopende venster."
      );
    } else {
      log.push("MARKTPLAATS_BROWSER_ALLOW_SUBMIT=false — gestopt vóór publicatie. Controleer het formulier handmatig in het geopende venster.");
    }

    return {
      startedAt,
      allowSubmit,
      stoppedBeforeSubmit: true,
      fieldResults,
      imagesUploaded: uploaded,
      imagesFailed: failed + downloadFailed.length,
      warnings: [...warnings, ...log],
      errors,
      pageUrl: page.url(),
    };
  } finally {
    // Browser window stays open on purpose — only clean up the temp image
    // files, never the browser/context.
    await cleanupImages(imagesDir);
  }
}
