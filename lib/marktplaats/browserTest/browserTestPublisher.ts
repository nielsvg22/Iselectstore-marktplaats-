import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";

import { AdvertisementDraft, DraftField } from "../service";
import {
  BrowserTestConfig,
  assertSubmitAllowed,
  ensureDir,
  getBrowserTestConfig,
  stopBeforeSubmit,
  SubmitNotAllowedError,
} from "./config";
import {
  BrowserTestRun,
  compactMessage,
  isStopRequested,
  recordStatus,
  setState,
  takeSubmittedLogin,
  waitForVerificationCode,
} from "./status";
import {
  CORE_FIELD_SELECTORS,
  SelectorCandidate,
  buildAttributeCandidates,
  escapeRegExp,
  isRegexPattern,
  selectValueCandidates,
  toRegExp,
} from "./selectors";
import {
  ImageDownloadResult,
  cleanupImageDir,
  cleanupStaleImageDirs,
  downloadImagesForBrowserTest,
} from "./imageStore";
import {
  autoLoginCooldownElapsed,
  autoLoginCooldownRemainingMinutes,
  getActiveContext,
  recordAutoLoginAttempt,
  setActiveContext,
} from "./session";
import { upsertCategoryMapping } from "../categoryService";
import { setAttributeMapping } from "../mappingEngine";

/**
 * MarktplaatsBrowserTestPublisher — LOCAL/DEV-ONLY Playwright test.
 *
 * It opens the real Marktplaats placement form and fills it with the data
 * produced by MarktplaatsService (the same mapping the official API will use)
 * so we can verify the mapping against the real DOM.
 *
 * It NEVER replaces the official API publisher, and it NEVER publishes unless
 * MARKTPLAATS_BROWSER_ALLOW_SUBMIT is explicitly true — enforced by
 * assertSubmitAllowed() directly in front of the publish action.
 */

interface ResolvedLocator {
  locator: Locator;
  candidate: SelectorCandidate;
}

type PublishOutcome =
  | { kind: "success"; url: string }
  | { kind: "payment"; url: string }
  | { kind: "validation"; url: string; problems: string[] }
  | { kind: "timeout"; url: string };

const ADVANCE_CANDIDATES: SelectorCandidate[] = [
  { strategy: "role", role: "button", pattern: "/^(volgende|doorgaan|verder|verder gaan|next)/i" },
];

const SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { strategy: "role", role: "button", pattern: "/^(plaats advertentie|advertentie plaatsen|advertentie publiceren|plaatsen|publiceren)/i" },
  { strategy: "label", pattern: "/^(plaats advertentie|advertentie plaatsen|advertentie publiceren)/i" },
  { strategy: "css", pattern: 'button[type="submit"]', note: "CSS fallback: button[type=submit]" },
];

/** Verplichte verkoper-velden op het detailformulier. */
const POSTCODE_CANDIDATES: SelectorCandidate[] = [
  { strategy: "testid", pattern: "syi-postcode-input" },
  { strategy: "css", pattern: "#postCode", note: "CSS fallback: #postCode" },
  { strategy: "css", pattern: 'input[name="contactInformation.postCode"]', note: "CSS fallback: name" },
  { strategy: "label", pattern: "/^Postcode/i" },
];

/** "Hoe wil je adverteren?" — alleen de GRATIS vorm mag ooit worden gekozen. */
const FREE_BUNDLE_CANDIDATES: SelectorCandidate[] = [
  { strategy: "css", pattern: "#feature-FREE", note: "CSS: vrije bundle-radio" },
  { strategy: "testid", pattern: "bundle-option-FREE" },
];

/** Betaalde vormen — deze mogen nooit worden aangeklikt. */
const PAID_BUNDLE_PATTERN = /\b(plus|premium|dagtopper|blikvanger|featured)\b/i;

const FINAL_CONTROL_PATTERN =
  /plaats advertentie|advertentie plaatsen|advertentie publiceren|advertentie online|direct plaatsen|verkoop nu|betaal|bevestig/i;

/** Text that only appears once the advertisement is actually online. */
const PUBLISH_SUCCESS_PATTERN =
  /je advertentie (is|staat|wordt)|advertentie (is|staat) (geplaatst|online)|geplaatst in de categorie|gefeliciteerd met je advertentie|advertentie succesvol/i;

/** URL shapes of a finished placement (item page, seller view or "mijn advertenties"). */
const PUBLISHED_URL_PATTERN = /\/p\/\d+|\/seller\/view\/|\/my-account\/sell|\/advertenties\//;

const PAYMENT_URL_PATTERN = /\/payments\/|\/checkout\/|ideal\.nl/i;

const PAYMENT_HEADING_PATTERN = /^betaal|^betalen|betaalmethode|winkelwagen/i;

const MAX_ADVANCES = 4;

/** Thrown when requestStop() is called for this run — a user clicked "Stop test". */
class StoppedByUserError extends Error {
  constructor() {
    super("Test gestopt door gebruiker.");
    this.name = "StoppedByUserError";
  }
}

export class MarktplaatsBrowserTestPublisher {
  private readonly config: BrowserTestConfig;
  private imageDir: string | null = null;
  private unfilled: string[] = [];
  private advances = 0;
  private debugFiles: string[] = [];
  private cookiesHandled = false;

  constructor(private readonly run: BrowserTestRun) {
    this.config = getBrowserTestConfig();
  }

  // ---------------------------------------------------------------- status

  private ok(field: string, detail?: string) {
    recordStatus(this.run, { field, status: "ok", detail });
  }

  private warn(field: string, detail?: string) {
    recordStatus(this.run, { field, status: "warning", detail });
  }

  private error(field: string, detail?: string) {
    recordStatus(this.run, { field, status: "error", detail });
  }

  private info(field: string, detail?: string) {
    recordStatus(this.run, { field, status: "info", detail });
  }

  /** Playwright errors are huge — surface one readable line instead. */
  private errMsg(err: unknown): string {
    return compactMessage(err instanceof Error ? err.message : String(err));
  }

  // ----------------------------------------------------------------- main

  async runDraft(draft: AdvertisementDraft): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("MARKTPLAATS_BROWSER_TEST staat niet op true — de browsertest is uitgeschakeld.");
    }

    cleanupStaleImageDirs();
    setState(this.run, "running", "Browser starten");

    const context = await this.ensureContext();
    const page = await this.resolvePage(context);

    try {
      await this.openPlacementPage(page);
      await this.autoAcceptCookies(page);
      await this.snapshot(page, "00-plaatsingspagina");
      await this.ensureLoggedIn(page);
      await this.snapshot(page, "01-ingelogd");

      // De echte site is een wizard: stap 1 kent ALLEEN een titelveld en drie
      // cascaderende rubriek-dropdowns. Alles wat daar niet bestaat mag dus
      // pas ná "Verder" worden ingevuld.
      await this.fillStepOne(page, draft);
      const advanced = await this.selectCategoryAndAdvance(page, draft);
      await this.snapshot(page, "02-detailformulier");

      if (!advanced) {
        // Veilig stoppen: het detailformulier is niet bereikt, dus er valt
        // niets te vullen. Browser blijft open voor handmatige controle.
        this.run.stoppedBeforeSubmit = true;
        recordStatus(this.run, {
          field: "Controle",
          status: "info",
          detail: `Browser staat open voor handmatige controle${this.debugSuffix()}`,
        });
        setState(this.run, "done", "Detailformulier niet bereikt — handmatig verdergaan");
        return;
      }

      await this.uploadImages(page, draft);
      await this.fillCoreFields(page, draft);
      await this.fillStructuredFields(page, draft);
      await this.fillSellerFields(page);

      await this.maybeAdvance(page);
      await this.snapshot(page, "03-formulier-gevuld");

      await this.stopBeforeSubmitStep(page);
    } catch (err) {
      if (err instanceof StoppedByUserError) {
        recordStatus(this.run, { field: "Gestopt", status: "info", detail: "Test gestopt — tabblad is gesloten." });
        setState(this.run, "failed", "Gestopt door gebruiker");
        // Close only this run's own tab — the shared context (and any other
        // run's tab) stays open; other products may still be mid-run in it.
        await page.close().catch(() => {});
        return;
      }
      throw err;
    } finally {
      // Never close the browser on a normal finish: it must stay open for
      // manual inspection. A user-requested stop closes it explicitly above.
      await cleanupImageDir(this.imageDir);
      this.imageDir = null;
    }
  }

  // ------------------------------------------------------------- browser

  private async ensureContext(): Promise<BrowserContext> {
    const existing = getActiveContext();
    if (existing) {
      this.info("Browser", "Bestaande browsessie hergebruikt");
      return existing;
    }

    const { chromium } = await import("playwright");
    ensureDir(this.config.profileDir);

    const launch = async (userDataDir: string) =>
      chromium.launchPersistentContext(userDataDir, {
        headless: this.config.headless,
        channel: this.config.channel ?? undefined,
        viewport: { width: 1440, height: 960 },
        locale: "nl-NL",
        args: ["--disable-blink-features=AutomationControlled"],
      });

    let context: BrowserContext;
    try {
      context = await launch(this.config.profileDir);
    } catch (err) {
      const message = this.errMsg(err);
      // Chromium's own process_singleton guard refuses to open a userDataDir
      // it believes is still in use — but a Coolify redeploy (or any hard
      // container kill) swaps the whole container without Chromium ever
      // getting to clean up its own SingletonLock/-Cookie/-Socket files, so
      // the NEXT launch sees a lock from a process that no longer exists
      // anywhere. Clearing exactly those well-known files and retrying on
      // the SAME profile keeps the real (logged-in) session instead of
      // silently falling back to an empty throwaway profile.
      const staleLock = /SingletonLock|process_singleton|locked the profile/i.test(message);
      if (staleLock) {
        try {
          for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
            fs.rmSync(path.join(this.config.profileDir, name), { force: true });
          }
          context = await launch(this.config.profileDir);
          this.warn(
            "Browserprofiel",
            `Verouderd lockbestand van een vorige (gestopte) container opgeruimd — bestaand profiel alsnog gebruikt.`
          );
        } catch (retryErr) {
          context = await this.launchThrowawayProfile(launch, retryErr);
        }
      } else {
        context = await this.launchThrowawayProfile(launch, err);
      }
    }

    context.on("close", () => setActiveContext(null));
    setActiveContext(context);
    this.ok("Browser", `Playwright gestart (${this.config.headless ? "headless" : "headed"})`);
    return context;
  }

  /** Last resort: a throwaway profile means the user has to log in once more. */
  private async launchThrowawayProfile(
    launch: (userDataDir: string) => Promise<BrowserContext>,
    err: unknown
  ): Promise<BrowserContext> {
    const fallback = path.join(this.config.profileDir, `tmp-${process.pid}-${Date.now()}`);
    this.warn(
      "Browserprofiel",
      `Kon het vaste profiel niet openen (${this.errMsg(err)}) — tijdelijk profiel gebruikt.`
    );
    ensureDir(fallback);
    return launch(fallback);
  }

  /**
   * Always a fresh tab, never context.pages()[0] — multiple runs (different
   * products) can be active at once, all sharing the same logged-in context
   * (cookies/session), each working its own tab so they never fight over the
   * same page's URL/form state.
   */
  private async resolvePage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.navigationTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    return page;
  }

  private async openPlacementPage(page: Page): Promise<void> {
    this.info("Plaatsingspagina", `Openen ${this.config.placementUrl}`);
    try {
      await page.goto(this.config.placementUrl, { waitUntil: "domcontentloaded" });
      this.ok("Plaatsingspagina", page.url());
    } catch (err) {
      this.error("Plaatsingspagina", this.errMsg(err));
      throw err;
    }
  }

  /**
   * No credentials are ever stored in code. Three ways to get logged in, all
   * equally valid at every loop iteration: (1) MARKTPLAATS_USERNAME /
   * MARKTPLAATS_PASSWORD env vars trigger one automatic attempt, (2) the
   * admin UI's login fields (POST .../login) submit credentials once via
   * takeSubmittedLogin() — never persisted, (3) logging in by hand in the
   * embedded/noVNC browser works too, since isLoggedIn() is polled every
   * iteration regardless of how the session got there. The persistent
   * profile stores the session either way, so this only runs again after the
   * profile is wiped/expired.
   */
  private async ensureLoggedIn(page: Page): Promise<void> {
    const deadline = Date.now() + this.config.loginTimeoutMs;
    let waitingLogged = false;
    let autoLoginAttempted = false;

    for (;;) {
      if (isStopRequested(this.run)) throw new StoppedByUserError();

      if (await this.isLoggedIn(page)) {
        this.ok("Login", waitingLogged ? "Ingelogd — sessie lokaal opgeslagen in het Playwright-profiel" : "Bestaande sessie hergebruikt");
        if (/login|inloggen|signin/i.test(page.url())) {
          await page.goto(this.config.placementUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
        return;
      }

      await this.autoAcceptCookies(page);

      if (await this.isVerificationChallenge(page)) {
        await this.handleVerificationChallenge(page);
        continue; // re-check isLoggedIn() immediately with the loop's top
      }

      const submittedLogin = takeSubmittedLogin(this.run.runId);
      if (submittedLogin) {
        await this.attemptAutoLogin(page, submittedLogin.username, submittedLogin.password);
        continue; // re-check isLoggedIn() immediately with the loop's top
      }

      if (!autoLoginAttempted && this.config.username && this.config.password) {
        autoLoginAttempted = true;
        if (autoLoginCooldownElapsed()) {
          recordAutoLoginAttempt();
          await this.attemptAutoLogin(page, this.config.username, this.config.password);
          continue; // re-check isLoggedIn() immediately with the loop's top
        }
        this.info(
          "Login (auto)",
          `Overgeslagen — vorige automatische poging was te recent (nog ${autoLoginCooldownRemainingMinutes()} min. afkoelperiode, ter bescherming tegen een Marktplaats-accountblokkade). Log handmatig in.`
        );
      }

      if (Date.now() > deadline) {
        this.error(
          "Login",
          `Niet ingelogd binnen ${Math.round(this.config.loginTimeoutMs / 1000)}s. Log handmatig in en start de test opnieuw.`
        );
        throw new Error("Geen geldige Marktplaats-sessie — log handmatig in en probeer opnieuw.");
      }

      if (!waitingLogged) {
        waitingLogged = true;
        setState(this.run, "waiting_login", "Wacht op handmatige login in de geopende browser");
        recordStatus(this.run, {
          field: "Login",
          status: "info",
          detail: "Nog niet ingelogd — log nu handmatig in; de sessie wordt daarna automatisch herbruikt.",
        });
      }
      await page.waitForTimeout(2000);
    }
  }

  /**
   * Marktplaats shows a cookie banner on first load of a fresh profile —
   * accept it ourselves so it never blocks the login/2FA flow underneath.
   * Only actually "handled" once a click succeeds, so it keeps retrying on
   * every call (openPlacementPage, every ensureLoggedIn() loop iteration,
   * attemptAutoLogin()) until the banner is gone — covers a banner that
   * renders a beat later than the rest of the page.
   *
   * Tries several known consent-platform shapes, not just Marktplaats' own
   * exact "Accepteren" button text, since a fresh profile occasionally shows
   * a differently-worded or iframe-based (Cookiebot-style) variant:
   *  - direct DOM button, common Dutch accept-all wording
   *  - known CMP element ids (OneTrust) injected straight into the page
   *  - a Cookiebot-style consent iframe
   */
  private async autoAcceptCookies(page: Page): Promise<void> {
    if (this.cookiesHandled) return;
    try {
      const directCandidates = [
        page.getByRole("button", { name: /^(accepteren|alles accepteren|accepteer alles|akkoord|ik ga akkoord)$/i }).first(),
        page.locator("#onetrust-accept-btn-handler"),
      ];
      for (const candidate of directCandidates) {
        const visible = await candidate.isVisible({ timeout: 1500 }).catch(() => false);
        if (!visible) continue;
        await candidate.click({ timeout: 3000 });
        this.cookiesHandled = true;
        this.info("Cookies", "Cookiemelding automatisch geaccepteerd");
        await page.waitForTimeout(300).catch(() => {});
        return;
      }

      // Cookiebot-style banners render inside their own iframe.
      const consentFrame = page.frameLocator('iframe[id*="cookiebot" i], iframe[title*="cookie" i]').first();
      const frameAccept = consentFrame.getByRole("button", { name: /^(accepteren|alles accepteren|akkoord)$/i }).first();
      const frameVisible = await frameAccept.isVisible({ timeout: 1500 }).catch(() => false);
      if (frameVisible) {
        await frameAccept.click({ timeout: 3000 });
        this.cookiesHandled = true;
        this.info("Cookies", "Cookiemelding automatisch geaccepteerd (iframe)");
        await page.waitForTimeout(300).catch(() => {});
      }
    } catch {
      /* no cookie banner visible right now — nothing to do */
    }
  }

  /** Detects Marktplaats' SMS/e-mail verification ("Beveiligingscontrole") step. */
  private async isVerificationChallenge(page: Page): Promise<boolean> {
    if (/two-factor-auth|2fa|challenge/i.test(page.url())) return true;
    const heading = await page.locator("h1, h2").first().innerText().catch(() => "");
    return /beveiligingscontrole|verificatiecode|voer de code in|tweestapsverificatie/i.test(heading);
  }

  /**
   * Marktplaats asked for an SMS/e-mail verification code. Rather than make
   * someone switch into the embedded noVNC view to type it, the run pauses
   * in "waiting_code" state and the admin UI collects the code and posts it
   * to POST /api/marktplaats/browser-test/code, which resolves
   * waitForVerificationCode() below.
   */
  private async handleVerificationChallenge(page: Page): Promise<void> {
    setState(this.run, "waiting_code", "Marktplaats vraagt een verificatiecode");
    recordStatus(this.run, {
      field: "Verificatiecode",
      status: "info",
      detail: "Vul de SMS/e-mailcode in via het invoerveld hierboven in het adminpaneel.",
    });

    const code = await waitForVerificationCode(this.run.runId, this.config.loginTimeoutMs);
    if (isStopRequested(this.run)) throw new StoppedByUserError();
    if (!code) {
      this.warn(
        "Verificatiecode",
        `Geen code ontvangen binnen ${Math.round(this.config.loginTimeoutMs / 1000)}s — vul 'm zelf in via de live browser.`
      );
      return;
    }

    const filled = await this.enterVerificationCode(page, code);
    if (filled) {
      this.ok("Verificatiecode", "Code ingevuld en verzonden");
    } else {
      this.warn("Verificatiecode", "Kon het invoerveld voor de code niet vinden — vul 'm zelf in via de live browser.");
    }
  }

  /**
   * Fills a Marktplaats verification code, which may render either as one
   * field or as several single-digit boxes depending on the challenge type.
   */
  private async enterVerificationCode(page: Page, rawCode: string): Promise<boolean> {
    const digits = rawCode.replace(/\D/g, "");
    if (!digits) return false;

    try {
      const boxes = page.locator('input[type="tel"], input[inputmode="numeric"], input[autocomplete="one-time-code"]');
      const count = await boxes.count().catch(() => 0);
      if (count > 1 && count >= digits.length) {
        for (let i = 0; i < digits.length; i += 1) {
          await boxes.nth(i).fill(digits[i]).catch(() => {});
        }
      } else {
        const single = page
          .getByLabel(/code|verificatie/i)
          .or(page.locator('input[name*="code" i]'))
          .or(boxes.first())
          .first();
        if ((await single.count().catch(() => 0)) === 0) return false;
        await single.fill(digits);
      }

      const submit = page.getByRole("button", { name: /verstuur|bevestig|volgende|verifieer/i }).first();
      await submit.click({ timeout: 5000 }).catch(async () => {
        await page.keyboard.press("Enter").catch(() => {});
      });
      await page.waitForLoadState("domcontentloaded", { timeout: this.config.navigationTimeoutMs }).catch(() => {});
      return true;
    } catch (err) {
      this.warn("Verificatiecode", `Invullen mislukt: ${this.errMsg(err)}`);
      return false;
    }
  }

  /**
   * Fills and submits the real Marktplaats login form with
   * MARKTPLAATS_USERNAME / MARKTPLAATS_PASSWORD. Best-effort and silent on
   * failure — isLoggedIn() is re-checked by the caller's loop either way, so
   * a login-page layout change degrades to the normal manual-login wait
   * rather than crashing the run.
   */
  private async attemptAutoLogin(page: Page, username: string, password: string): Promise<void> {
    // Distinct field key from "Login" on purpose: that key gets overwritten
    // by the later "wacht op handmatige login" status once this returns, so
    // the outcome of the auto-login attempt would otherwise disappear from
    // the UI even when it failed.
    this.info("Login (auto)", "Automatisch inloggen met MARKTPLAATS_USERNAME/MARKTPLAATS_PASSWORD…");
    try {
      if (!/\/login|inloggen|signin|\/auth/i.test(page.url())) {
        await page.goto(`${this.config.baseUrl}/inloggen`, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
      await this.autoAcceptCookies(page);

      const usernameField = page
        .getByLabel(/e-?mail|gebruikersnaam|inlognaam/i)
        .or(page.getByPlaceholder(/e-?mail|gebruikersnaam/i))
        .or(page.locator('input[type="email"], input[name*="email" i], input[name*="username" i]'))
        .first();
      const passwordField = page
        .getByLabel(/wachtwoord/i)
        .or(page.getByPlaceholder(/wachtwoord/i))
        .or(page.locator('input[type="password"]'))
        .first();

      await usernameField.waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs });
      await usernameField.fill(username);
      await passwordField.waitFor({ state: "visible", timeout: 5000 });
      await passwordField.fill(password);

      const submit = page
        .getByRole("button", { name: /inloggen|log\s*in|aanmelden/i })
        .first();
      await submit.click({ timeout: 5000 }).catch(async () => {
        await passwordField.press("Enter");
      });

      await page.waitForLoadState("domcontentloaded", { timeout: this.config.navigationTimeoutMs }).catch(() => {});
      await page.waitForTimeout(800).catch(() => {});

      const stillOnLogin = /\/login|inloggen|signin|\/auth/i.test(page.url());
      if (stillOnLogin) {
        const pageError = await this.readLoginError(page);
        this.warn(
          "Login (auto)",
          `Nog op de inlogpagina na verzenden${pageError ? ` — melding: "${pageError}"` : " (geen foutmelding zichtbaar)"}`
        );
      } else {
        this.info("Login (auto)", `Formulier verzonden — pagina na inloggen: ${page.url()}`);
      }
    } catch (err) {
      this.warn("Login (auto)", `Automatisch inloggen mislukt (${this.errMsg(err)}) — val terug op handmatig inloggen. Pagina: ${page.url()}`);
    }
  }

  /** Reads a visible inline error (e.g. "onjuiste combinatie") near the login form, if any. */
  private async readLoginError(page: Page): Promise<string> {
    try {
      const nodes = page.locator(
        '[role="alert"], .hz-Text--error, .InputFeedback--error, [data-testid*="error"], [class*="error" i]:visible'
      );
      const count = await nodes.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 5); i += 1) {
        const text = (await nodes.nth(i).innerText().catch(() => "")).trim().replace(/\s+/g, " ");
        if (text.length > 0) return text.slice(0, 200);
      }
    } catch {
      /* best-effort diagnostic only */
    }
    return "";
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (/\/login|inloggen|signin|\/auth/i.test(url)) return false;
    try {
      const accountMarkers = await page
        .locator('a[href*="mijn-marktplaats" i], a[href*="/account" i], [data-testid*="profile" i], [data-testid*="account" i]')
        .count();
      if (accountMarkers > 0) return true;
      const loginMarkers = await page
        .locator('a[href*="login" i]:visible, button:has-text("Inloggen"):visible, a:has-text("Inloggen"):visible')
        .count();
      return loginMarkers === 0;
    } catch {
      return true;
    }
  }

  // ------------------------------------------------------------- category

  /** Stap 1 van de wizard: het enige veld dat daar bestaat is de titel. */
  private async fillStepOne(page: Page, draft: AdvertisementDraft): Promise<void> {
    await this.fillOne(page, {
      label: "Titel (rubriekstap)",
      value: draft.title,
      kind: "text",
      candidates: CORE_FIELD_SELECTORS.titleStep1.candidates,
      expects: true,
      timeoutMs: 4000,
    });

    // The controlled input can drop its value when React re-renders, and the
    // rubric dropdowns only enable once the title is really there.
    const veld = page.locator("#TextField-vulEenTitelIn").first();
    for (let poging = 0; poging < 3; poging++) {
      const huidig = await veld.inputValue().catch(() => "");
      if (huidig.trim().length > 0) return;
      await this.fillText(page, veld, draft.title);
      await page.waitForTimeout(500);
    }
    if ((await veld.inputValue().catch(() => "")).trim().length === 0) {
      this.warn("Titel (rubriekstap)", "Titel blijft leeg — de rubriekstap kan hierdoor niet doorgaan.");
    }
  }

  /**
   * Stap 1: rubriek kiezen via de drie cascaderende native <select>s
   * (#cat_sel_1/2/3) en daarna doorklikken naar het detailformulier.
   * Geeft false terug wanneer het detailformulier niet bereikt kon worden.
   */
  private async selectCategoryAndAdvance(page: Page, draft: AdvertisementDraft): Promise<boolean> {
    if (!draft.category) {
      this.error("Categorie", "Geen categoriemapping voor dit producttype.");
      return false;
    }

    const steps: { id: string; naam: string; kandidaten: string[]; verplicht: boolean; wacht: number }[] = [
      {
        id: "#cat_sel_1",
        naam: "Rubriek (L1)",
        kandidaten: this.nameCandidates(draft.category.l1CategoryName),
        verplicht: true,
        wacht: 20000,
      },
      {
        id: "#cat_sel_2",
        naam: "Subrubriek (L2)",
        kandidaten: this.nameCandidates(draft.category.l2CategoryName),
        verplicht: true,
        wacht: 12000,
      },
      { id: "#cat_sel_3", naam: "Type (L3)", kandidaten: this.typeCandidates(draft), verplicht: false, wacht: 8000 },
    ];

    let gekozen = 0;
    let l1Value: string | null = null;
    let l2Value: string | null = null;
    for (const step of steps) {
      const select = page.locator(step.id).first();
      // The rubric dropdowns hydrate separately from the title field, so a
      // single isVisible() check races against React — poll instead.
      const aanwezig = await this.waitForVisible(page, select, step.wacht);
      if (!aanwezig) {
        if (step.verplicht) {
          this.error(
            step.naam,
            `Dropdown ${step.id} niet geladen binnen ${Math.round(step.wacht / 1000)}s (pagina: ${page.url()}).`
          );
        } else {
          this.info(step.naam, "niet aanwezig op dit formulier (rubriek heeft dit niveau niet)");
        }
        continue;
      }
      await this.waitForOptionCount(page, select, 2, 8000);
      const optie = await this.selectByText(select, step.kandidaten);
      if (optie) {
        gekozen += 1;
        this.ok(step.naam, `${optie.text} (id ${optie.value})`);
        if (step.id === "#cat_sel_1") l1Value = optie.value;
        if (step.id === "#cat_sel_2") l2Value = optie.value;
        await page.waitForTimeout(800);
      } else {
        this.warn(
          step.naam,
          `geen passende optie gevonden voor "${step.kandidaten.join('", "')}" — ${await this.optionPreview(select)}`
        );
      }
    }

    if (gekozen === 0) {
      this.error("Categorie", "Geen enkele rubriek kon geselecteerd worden.");
      return false;
    }

    // Marktplaats requires numeric category IDs for the feed/API — ours start
    // as "UNVERIFIED" placeholders. A successful real selection here proves
    // the actual IDs, so persist them for reuse (e.g. by the feed builder)
    // instead of requiring official API access to look them up.
    if (l1Value && l2Value) {
      await upsertCategoryMapping({
        shopifyProductType: draft.productType,
        l1CategoryId: l1Value,
        l1CategoryName: draft.category.l1CategoryName,
        l2CategoryId: l2Value,
        l2CategoryName: draft.category.l2CategoryName,
      }).catch((err) => this.warn("Categorie", `Kon ontdekte categorie-ID's niet opslaan: ${this.errMsg(err)}`));
      this.info("Categorie", `Echte categorie-ID's ontdekt en opgeslagen (L1=${l1Value}, L2=${l2Value})`);
    }

    return this.advanceToDetails(page);
  }

  private async waitForVisible(page: Page, locator: Locator, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await locator.isVisible().catch(() => false)) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(250).catch(() => {});
    }
  }

  /** A cascade level is only usable once the previous level filled its options. */
  private async waitForOptionCount(page: Page, select: Locator, min: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const count = await select
        .evaluate((el) => (el as HTMLSelectElement).options.length)
        .catch(() => 0);
      if (count >= min) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(250).catch(() => {});
    }
  }

  /** Splits a composite mapping name ("Mobiele telefoons | Apple") into candidates. */
  private nameCandidates(name: string): string[] {
    const parts = name
      .split(/\s*[|>,/]\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return [...new Set([...parts, name.trim()].filter((p) => p.length > 0))];
  }

  /** Third-level candidates: L2 parts + manufacturer + "manufacturer part". */
  private typeCandidates(draft: AdvertisementDraft): string[] {
    const manufacturer = draft.fields.find((f) => f.key === "manufacturer_name")?.value ?? "";
    const parts = this.nameCandidates(draft.category?.l2CategoryName ?? "");
    const out = [...parts];
    // "Apple macbooks" — Markplaats heeft voor MacBook een eigen L3 onder Laptops.
    const typePlural = `${draft.productType.toLowerCase()}s`;
    if (manufacturer) {
      out.push(manufacturer);
      for (const p of parts) out.push(`${manufacturer} ${p}`);
      out.push(`${manufacturer} ${typePlural}`);
    }
    out.push(typePlural);
    return [...new Set(out.filter((p) => p.length > 0))];
  }

  /**
   * Diagnostic only: the real label text currently visible on the form, so a
   * field that no alias matches can be fixed from the run status alone
   * instead of needing a screenshot of the live browser.
   */
  private async listVisibleLabels(page: Page): Promise<string> {
    try {
      const labels = await page.evaluate(() => {
        const texts = new Set<string>();
        document.querySelectorAll("label").forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
          if (text.length > 0 && text.length < 60) texts.add(text);
        });
        return [...texts];
      });
      return labels.slice(0, 40).join(" | ");
    } catch {
      return "";
    }
  }

  private async optionPreview(select: Locator): Promise<string> {
    const texts = await select
      .evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.textContent?.trim() ?? ""))
      .catch(() => [] as string[]);
    return texts.filter(Boolean).length > 0
      ? `beschikbaar: ${texts.filter(Boolean).slice(0, 12).join(", ")}`
      : "geen opties geladen";
  }

  /** Exact → startsWith → contains, so a broad name still picks the right row. */
  private async selectByText(select: Locator, candidates: string[]): Promise<{ text: string; value: string } | null> {
    const options = await select
      .evaluate((el) =>
        [...(el as HTMLSelectElement).options].map((o) => ({ value: o.value, text: (o.textContent ?? "").trim() }))
      )
      .catch(() => [] as { value: string; text: string }[]);
    if (options.length === 0) return null;

    const wanted = [...new Set(candidates.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    for (const test of [(t: string, o: string) => t === o, (t: string, o: string) => o.startsWith(t), (t: string, o: string) => o.includes(t)]) {
      for (const w of wanted) {
        const hit = options.find((o) => o.text && test(w, o.text.toLowerCase()));
        if (hit && hit.value) {
          await select.selectOption(hit.value);
          return hit;
        }
      }
    }
    return null;
  }

  /**
   * Klik "Verder" en wacht tot het detailformulier (foto's/details) geladen is.
   * Fallback: laat Marktplaats zelf een rubriek voorstellen op basis van de titel.
   */
  private async advanceToDetails(page: Page): Promise<boolean> {
    const knop = page.getByTestId("redirectToPlaceAd").first();
    const knopZichtbaar = await knop.isVisible().catch(() => false);
    if (knopZichtbaar) {
      try {
        await knop.click({ timeout: 6000 });
        this.info("Volgende stap", '"Verder" aangeklikt');
      } catch (err) {
        this.warn("Volgende stap", `Doorklikken mislukt: ${this.errMsg(err)}`);
      }
    } else {
      this.warn("Volgende stap", 'Knop "Verder" niet gevonden.');
    }

    if (await this.waitForStepTwo(page)) {
      this.ok("Detailformulier", page.url());
      return true;
    }

    // Fallback: "Vind categorie" laat Marktplaats de rubriek uit de titel kiezen.
    const vind = page.getByTestId("findCategory").first();
    if (await vind.isVisible().catch(() => false)) {
      this.info("Categorie", 'Fallback: "Vind categorie" geprobeerd op basis van de titel.');
      await vind.click({ timeout: 5000 }).catch(() => {});
      if (await this.waitForStepTwo(page)) {
        this.ok("Detailformulier", page.url());
        return true;
      }
    }

    this.error(
      "Detailformulier",
      `Het formulier met foto's/details is niet bereikt (pagina: ${page.url()}) — controleer rubriek en titel handmatig in het geopende venster.`
    );
    return false;
  }

  /**
   * The rubric step hands over via a client-side redirect to
   * /plaats/{l1}/{l3}?bucketId={l2}, which then hydrates the detail form.
   *
   * Note: never probe "any of these selectors" with .first().isVisible() — the
   * detail form's file input is deliberately visually hidden, so it would win
   * the .first() race and report "not visible" forever.
   */
  private async waitForStepTwo(page: Page): Promise<boolean> {
    const rubriekPad = /\/plaats\/[^/?]+\/[^/?]+/;
    await page
      .waitForURL((url) => rubriekPad.test(url.pathname), { timeout: 20000, waitUntil: "domcontentloaded" })
      .catch(() => {});
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});

    const marker = page.locator('#title_nl-NL, [data-testid="place-listing-submit-button"]').first();
    try {
      await marker.waitFor({ state: "attached", timeout: 25000 });
    } catch {
      return false;
    }
    if (!rubriekPad.test(new URL(page.url()).pathname)) return false;

    const deadline = Date.now() + 10000;
    for (;;) {
      if (await page.locator("#title_nl-NL").first().isVisible().catch(() => false)) return true;
      if (Date.now() >= deadline) return true; // form is in the DOM; fields may simply be folded in
      await page.waitForTimeout(250).catch(() => {});
    }
  }

  // -------------------------------------------------------------- images

  private async uploadImages(page: Page, draft: AdvertisementDraft): Promise<void> {
    if (draft.imageUrls.length === 0) {
      this.warn("Afbeeldingen", "Geen productafbeeldingen gevonden in Shopify.");
      return;
    }

    let download: ImageDownloadResult;
    try {
      download = await downloadImagesForBrowserTest(draft.imageUrls, this.run.runId);
      this.imageDir = download.dir;
    } catch (err) {
      this.error("Afbeeldingen", `Downloaden mislukt: ${this.errMsg(err)}`);
      return;
    }

    for (const failure of download.failures) {
      this.warn("Afbeeldingen", `Kon downloaden niet ophalen: ${failure.error}`);
    }
    if (download.skipped.length > 0) {
      this.info("Afbeeldingen", `${download.skipped.length} extra afbeelding(en) overgeslagen (max ${this.config.maxImages}).`);
    }
    if (download.files.length === 0) {
      this.error("Afbeeldingen", "Geen afbeeldingen konden worden gedownload.");
      return;
    }

    const resolved = await this.waitForResolve(page, CORE_FIELD_SELECTORS.images.candidates, 3000, false);
    if (!resolved) {
      this.error("Afbeeldingen", "Geen file-input (input[type=file]) gevonden op het formulier.");
      return;
    }

    try {
      await resolved.locator.setInputFiles(download.files.map((f) => f.filePath));
      await page.waitForTimeout(2500);
      this.ok("Afbeeldingen", `${download.files.length} afbeelding(en) toegevoegd`);
    } catch (err) {
      this.error("Afbeeldingen", `Uploaden mislukt: ${this.errMsg(err)}`);
    }
  }

  // ---------------------------------------------------------- core fields

  private async fillCoreFields(page: Page, draft: AdvertisementDraft): Promise<void> {
    await this.fillOne(page, {
      label: "Titel",
      value: draft.title,
      kind: "text",
      candidates: CORE_FIELD_SELECTORS.title.candidates,
      expects: true,
      timeoutMs: 3000,
    });

    await this.fillOne(page, {
      label: "Omschrijving",
      value: draft.description,
      kind: "textarea",
      candidates: CORE_FIELD_SELECTORS.description.candidates,
      expects: true,
      timeoutMs: 3000,
    });

    await this.fillOne(page, {
      label: "Prijs",
      value: String(draft.price || ""),
      kind: "number",
      candidates: CORE_FIELD_SELECTORS.price.candidates,
      expects: true,
      timeoutMs: 3000,
    });
  }

  // ------------------------------------------------------ structured fields

  private async fillStructuredFields(page: Page, draft: AdvertisementDraft): Promise<void> {
    const l2CategoryId = draft.category?.l2CategoryId ?? null;
    for (const field of draft.fields) {
      const label = field.marktplaatsLabel ?? field.label;
      const candidates = buildAttributeCandidates({
        internalField: field.key,
        ownLabel: field.label,
        marktplaatsLabel: field.marktplaatsLabel,
      });
      await this.fillOne(page, {
        label,
        value: field.value,
        kind: field.kind === "select" || field.marktplaatsType === "LIST" ? "select" : field.kind,
        candidates,
        expects: field.expectsMarktplaatsField,
        marktplaatsKey: field.marktplaatsKey,
        timeoutMs: field.expectsMarktplaatsField ? 2500 : 800,
        options: field.marktplaatsOptions,
        discoverAttribute: l2CategoryId && !l2CategoryId.includes("UNVERIFIED") ? { internalField: field.key, l2CategoryId } : undefined,
      });
    }
  }

  /**
   * Reads the real Marktplaats attribute key off the DOM element that was
   * just filled (e.g. name="singleSelectAttribute[condition]" or a
   * data-testid="attribute-autocomplete-merk"), so the feed builder can use
   * the real key instead of a mock_-prefixed placeholder — without ever
   * needing official API access to look the key up.
   */
  private async discoverAttributeKey(locator: Locator): Promise<string | null> {
    try {
      const [name, testid] = await Promise.all([
        locator.getAttribute("name").catch(() => null),
        locator.getAttribute("data-testid").catch(() => null),
      ]);
      for (const raw of [name, testid]) {
        if (!raw) continue;
        const bracket = raw.match(/(?:singleSelectAttribute|numericAttribute|attribute)\[([^\]]+)\]/);
        if (bracket) return bracket[1];
        const autocomplete = raw.match(/^attribute-autocomplete-(.+)$/);
        if (autocomplete) return autocomplete[1];
      }
    } catch {
      /* best-effort discovery only */
    }
    return null;
  }

  private async fillOne(
    page: Page,
    params: {
      label: string;
      value: string;
      kind: "text" | "textarea" | "select" | "number";
      candidates: SelectorCandidate[];
      expects: boolean;
      timeoutMs: number;
      marktplaatsKey?: string | null;
      options?: AdvertisementDraft["fields"][number]["marktplaatsOptions"];
      discoverAttribute?: { internalField: string; l2CategoryId: string };
    }
  ): Promise<void> {
    const { label, value, expects } = params;
    if (!value || value.trim().length === 0) {
      this.info(label, "leeg in Shopify — overgeslagen");
      return;
    }

    const resolved = await this.waitForResolve(page, params.candidates, params.timeoutMs);
    if (!resolved) {
      const tried = params.candidates.length;
      // expects (expectsMarktplaatsField) must win over the mock_ check: while
      // every category mapping here is still "UNVERIFIED", attributeCache.ts
      // forces mock mode unconditionally, so EVERY field's marktplaatsKey
      // carries the mock_ prefix — including fields that genuinely exist on
      // the real form. Checking mock_ first silently downgraded real misses
      // (e.g. storage_gb on MacBook) to a harmless-looking "info" line that
      // never even reached maybeAdvance()'s retry-after-"Volgende" logic.
      if (expects) {
        const nearby = await this.listVisibleLabels(page);
        this.warn(
          label,
          `niet gevonden op het Marktplaats-formulier (${tried} selectoren geprobeerd)${
            nearby ? ` — zichtbare labels op de pagina: ${nearby}` : ""
          }`
        );
        this.unfilled.push(label);
      } else if (params.marktplaatsKey?.startsWith("mock_")) {
        this.info(label, `geen echt Marktplaats-attribuut (mapping-sleutel ${params.marktplaatsKey})`);
      } else {
        this.info(label, `geen bijpassend Marktplaats-veld (${tried} selectoren geprobeerd)`);
      }
      return;
    }

    try {
      const before = await this.readDisplay(resolved.locator, params.kind);
      await resolved.locator.scrollIntoViewIfNeeded().catch(() => {});

      // The mapping layer types fields from the (mock) API schema, where many
      // real Marktplaats dropdowns arrive as STRING. Never trust that: the DOM
      // decides whether we are filling an <input> or selecting an <option>.
      const tag = await resolved.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      const kind: typeof params.kind = tag === "select" ? "select" : params.kind;

      // Merk-achtige velden zijn geen gewone inputs maar een dialoog met een
      // zoeklijst (aria-haspopup="dialog") — daar moet uit gekozen worden.
      if (kind !== "select" && (await this.isAutocomplete(resolved.locator))) {
        const gekozen = await this.fillAutocomplete(page, resolved.locator, value);
        if (gekozen) {
          this.ok(
            label,
            `autocomplete "${gekozen}" ← "${value}" (${resolved.candidate.note ?? resolved.candidate.strategy})`
          );
          return;
        }
        this.info(label, "autocomplete niet tot stand gekomen — probeer vlak invullen");
      }

      let matched: string | null = null;
      if (kind === "select") {
        matched = await this.selectValue(page, value, resolved, params.options);
      } else {
        await this.fillText(page, resolved.locator, value);
      }
      let after = await this.readDisplay(resolved.locator, kind);

      // Selects throw when nothing matched, so reaching here already proves
      // the value landed. Text fields are verified by reading the DOM back.
      let applied =
        kind === "select"
          ? true
          : after.trim().length > 0 &&
            (after.trim() !== before.trim() || after.toLowerCase().includes(value.trim().toLowerCase()));

      // Controlled inputs (notably the € amount field) silently drop a
      // programmatic fill — retry with real keystrokes and a blur.
      if (!applied && kind !== "select") {
        await this.fillByKeyboard(page, resolved.locator, value);
        after = await this.readDisplay(resolved.locator, kind);
        applied =
          after.trim().length > 0 &&
          (after.trim() !== before.trim() || after.toLowerCase().includes(value.trim().toLowerCase()));
      }

      if (applied) {
        this.ok(
          label,
          kind === "select" && matched
            ? `geselecteerd "${matched}" ← "${value}" (${resolved.candidate.note ?? resolved.candidate.strategy})`
            : `ingevuld (${resolved.candidate.note ?? resolved.candidate.strategy})`
        );
        if (params.discoverAttribute) {
          const key = await this.discoverAttributeKey(resolved.locator);
          if (key) {
            await setAttributeMapping(params.discoverAttribute.l2CategoryId, params.discoverAttribute.internalField, key).catch(
              (err) => this.warn(label, `Kon ontdekte attribuutsleutel niet opslaan: ${this.errMsg(err)}`)
            );
          }
        }
      } else {
        this.warn(label, "veld gevonden maar de waarde lijkt niet te zijn toegepast");
        this.unfilled.push(label);
      }
    } catch (err) {
      this.warn(label, `invullen mislukt: ${this.errMsg(err)}`);
      this.unfilled.push(label);
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  private async isAutocomplete(locator: Locator): Promise<boolean> {
    return await locator
      .evaluate((el) => {
        if ((el.getAttribute("data-testid") ?? "").startsWith("attribute-autocomplete-")) return true;
        return Boolean(el.closest("[aria-haspopup='dialog']"));
      })
      .catch(() => false);
  }

  /**
   * Vul een autocomplete-veld (bijv. Merk) via zijn zoekdialoog: open, typ de
   * waarde en kies de beste match uit de lijst. Geeft de gekozen tekst terug.
   */
  private async fillAutocomplete(page: Page, locator: Locator, value: string): Promise<string | null> {
    await locator.click({ timeout: 5000 }).catch(() => {});
    const dialog = page.locator('[role="dialog"]').last();
    if (!(await dialog.isVisible().catch(() => false))) return null;

    const search = dialog.locator('input').first();
    await search.waitFor({ timeout: 5000 }).catch(() => {});
    await search.fill("").catch(() => {});
    await search.type(value, { delay: 20 }).catch(() => {});
    await page.waitForTimeout(1000);

    const items = await dialog
      .evaluate((el) => {
        const nodes = [...el.querySelectorAll('li, [role="option"], [data-testid*="option"], button, a')];
        return nodes.map((n) => (n.textContent ?? "").trim()).filter((t) => t.length > 0 && t.length < 80);
      })
      .catch(() => [] as string[]);

    const hit =
      items.find((t) => t.toLowerCase() === value.toLowerCase()) ??
      items.find((t) => t.toLowerCase().includes(value.toLowerCase()));
    if (!hit) return null;

    await dialog
      .evaluate((el, tekst) => {
        const nodes = [...el.querySelectorAll('li, [role="option"], [data-testid*="option"], button, a')];
        const node =
          nodes.find((n) => (n.textContent ?? "").trim() === tekst) ??
          nodes.find((n) => (n.textContent ?? "").trim().includes(tekst));
        if (node) (node as HTMLElement).click();
      }, hit)
      .catch(() => null);
    await page.waitForTimeout(500);
    return hit;
  }

  private async fillText(page: Page, locator: Locator, value: string): Promise<void> {
    try {
      await locator.fill(value);
      return;
    } catch {
      await this.fillByKeyboard(page, locator, value);
    }
  }

  /** Real keystrokes + blur, for inputs that ignore a programmatic fill. */
  private async fillByKeyboard(page: Page, locator: Locator, value: string): Promise<void> {
    await locator.click().catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.keyboard.type(value, { delay: 15 });
    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
  }

  private async selectValue(
    page: Page,
    rawValue: string,
    resolved: ResolvedLocator,
    options?: AdvertisementDraft["fields"][number]["marktplaatsOptions"]
  ): Promise<string> {
    const locator = resolved.locator;
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");

    const option = options?.find((o) => o.value === rawValue);
    const optionLabel = option ? option.labels?.nl ?? option.labels?.nl_NL ?? option.value : null;
    const candidates = selectValueCandidates(rawValue, optionLabel);

    if (tag === "select") {
      const opts = await locator
        .evaluate((el) =>
          [...(el as HTMLSelectElement).options].map((o) => ({ value: o.value, text: (o.textContent ?? "").trim() }))
        )
        .catch(() => [] as { value: string; text: string }[]);

      // Scoring instead of "first test that matches": a generic Shopify value
      // like "iPhone" hits a dozen real options through a loose token match,
      // and picking the first one would silently list the wrong model.
      // 4 = exact label, 3 = exact value, 2 = whole-token match, 1 = substring.
      const score = (candidate: string, option: { value: string; text: string }): number => {
        if (option.text.toLowerCase() === candidate.toLowerCase()) return 4;
        if (option.value.toLowerCase() === candidate.toLowerCase()) return 3;
        const safe = escapeRegExp(candidate).replace(/\s+/g, "\\s+");
        if (new RegExp(`(^|[^0-9A-Za-z])${safe}([^0-9A-Za-z]|$)`, "i").test(option.text)) return 2;
        if (option.text.toLowerCase().includes(candidate.toLowerCase())) return 1;
        return 0;
      };

      for (const candidate of candidates) {
        const hits = opts
          .map((opt) => ({ opt, s: score(candidate, opt) }))
          .filter((h) => h.s > 0 && h.opt.value);
        if (hits.length === 0) continue;

        const best = Math.max(...hits.map((h) => h.s));
        const winnaars = hits.filter((h) => h.s === best);
        if (winnaars.length > 1 && best < 3) {
          const tonen = winnaars
            .slice(0, 6)
            .map((h) => h.opt.text)
            .join('", "');
          throw new Error(
            `waarde "${candidate}" is ambigu: ${winnaars.length} opties passen ("${tonen}") — kies dit veld handmatig`
          );
        }

        const winnaar = winnaars[0].opt;
        for (const attempt of [
          () => locator.selectOption({ label: winnaar.text }),
          () => locator.selectOption({ value: winnaar.value }),
        ]) {
          try {
            await attempt();
            return winnaar.text;
          } catch {
            /* next strategy */
          }
        }
      }
      throw new Error(`geen passende optie in <select> voor "${rawValue}" (geprobeerd: ${candidates.join(", ")})`);
    }

    await locator.click();
    await page.waitForTimeout(500);
    for (const candidate of candidates) {
      const exactish = new RegExp(`^\\s*${escapeRegExp(candidate)}\\s*$`, "i");
      const optionLocators = [
        page.getByRole("option", { name: exactish }).first(),
        page.locator('[role="listbox"] li, [role="listbox"] [role="option"]').filter({ hasText: candidate }).first(),
      ];
      for (const optionLocator of optionLocators) {
        if ((await optionLocator.count()) > 0 && (await optionLocator.isVisible().catch(() => false))) {
          const tekst = (await optionLocator.innerText().catch(() => "")).trim();
          await optionLocator.click();
          return tekst || candidate;
        }
      }
    }
    throw new Error(`optie "${rawValue}" niet gevonden in de keuzelijst (geprobeerd: ${candidates.join(", ")})`);
  }

  private async readDisplay(locator: Locator, kind: string): Promise<string> {
    try {
      const value = await locator.inputValue();
      if (kind === "select" && value && value.trim().length > 0) return value;
      if (kind !== "select" && value !== null) return value;
    } catch {
      /* not a native input/select — fall through to innerText */
    }
    try {
      return await locator.innerText();
    } catch {
      return "";
    }
  }

  /**
   * Verplichte verkoper-invulling die nergens uit Shopify komt:
   *  - advertentievorm: altijd GRATIS (nooit Plus/Premium — dat kost geld)
   *  - postcode: verplicht veld van Marktplaats zelf
   */
  private async fillSellerFields(page: Page): Promise<void> {
    await this.selectFreeBundle(page);

    const postcode = this.config.postcode;
    if (!postcode) {
      this.error(
        "Postcode",
        "MARKTPLAATS_BROWSER_POSTCODE staat niet in .env.local — verplicht veld blijft leeg en plaatsen faalt."
      );
      return;
    }

    const resolved = await this.waitForResolve(page, POSTCODE_CANDIDATES, 4000);
    if (!resolved) {
      this.warn("Postcode", "Veld niet gevonden op dit formulier.");
      return;
    }

    const current = (await resolved.locator.inputValue().catch(() => "")).trim();
    if (current.toUpperCase() === postcode.toUpperCase()) {
      this.ok("Postcode", `${postcode} (al ingevuld)`);
      return;
    }

    await this.fillText(page, resolved.locator, postcode);
    const value = (await resolved.locator.inputValue().catch(() => "")).trim();
    if (value.toUpperCase() === postcode.toUpperCase()) {
      this.ok("Postcode", `${postcode} (${resolved.candidate.strategy})`);
    } else {
      this.warn("Postcode", `invullen lukte niet (verwacht ${postcode}, gevonden "${value}")`);
    }
  }

  /** Kiest de gratis advertentievorm; betaalde vormen worden nooit aangeklikt. */
  private async selectFreeBundle(page: Page): Promise<void> {
    const checked = await page
      .locator("#feature-FREE")
      .isChecked()
      .catch(() => false);
    if (checked) {
      this.ok("Advertentievorm", "Gratis (al geselecteerd)");
      return;
    }

    const resolved = await this.waitForResolve(page, FREE_BUNDLE_CANDIDATES, 3000);
    if (!resolved) {
      this.warn("Advertentievorm", "Gratis-optie niet gevonden — er is GEEN betaalde vorm aangeklikt.");
      return;
    }

    try {
      await resolved.locator.click();
      await page.waitForTimeout(400).catch(() => {});
    } catch (err) {
      this.warn("Advertentievorm", `aanklikken mislukt: ${this.errMsg(err)}`);
      return;
    }

    const active = await page
      .locator('input[name="bundle-selection"]')
      .evaluateAll((els) =>
        els.filter((el) => (el as HTMLInputElement).checked).map((el) => `${el.id}:${(el as HTMLInputElement).value}`)
      )
      .catch(() => [] as string[]);

    const paidHit = active.find((entry) => PAID_BUNDLE_PATTERN.test(entry));
    if (paidHit) {
      this.error("Advertentievorm", `Betaalde vorm actief (${paidHit}) — niet plaatsen!`);
      return;
    }
    this.ok("Advertentievorm", active.length > 0 ? "Gratis (€0,00)" : "aangeklikt (controle lukte niet)");
  }

  // ------------------------------------------------------------ navigation

  /**
   * Steps forward through the wizard ONLY while we still know fields we could
   * not fill, and never by pressing anything that could publish.
   */
  private async maybeAdvance(page: Page): Promise<void> {
    while (this.unfilled.length > 0 && this.advances < MAX_ADVANCES) {
      const resolved = await this.waitForResolve(page, ADVANCE_CANDIDATES, 1500);
      if (!resolved) return;
      const name = (await resolved.locator.innerText().catch(() => "")).trim();
      if (FINAL_CONTROL_PATTERN.test(name)) {
        this.info("Volgende stap", `Niet doorgeklikt — "${name}" ziet eruit als een publicatieknop.`);
        return;
      }
      try {
        await resolved.locator.click();
        this.advances += 1;
        await page.waitForTimeout(1500);
        this.info("Volgende stap", `"${name}" aangeklikt om resterende velden te bereiken`);
      } catch (err) {
        this.warn("Volgende stap", `Doorklikken mislukt: ${this.errMsg(err)}`);
        return;
      }
    }
  }

  // ------------------------------------------------------------- submit

  /**
   * FINAL SAFETY NET. Called exactly once, at the very end of the flow.
   * With MARKTPLAATS_BROWSER_ALLOW_SUBMIT=false the browser is left open on
   * the last review page and nothing is ever clicked — regardless of which
   * selectors or flow steps exist.
   */
  private async stopBeforeSubmitStep(page: Page): Promise<void> {
    const guard = stopBeforeSubmit("Plaats advertentie");
    this.run.stoppedBeforeSubmit = guard.stopped;

    if (guard.stopped) {
      recordStatus(this.run, {
        field: "Plaats advertentie",
        status: "info",
        detail: guard.reason,
      });
      this.info("Controle", `Browser staat open voor handmatige controle${this.debugSuffix()}`);
      setState(this.run, "done", "Gestopt vóór publicatie");
      return;
    }

    try {
      await this.attemptSubmit(page);
      setState(this.run, "done", "Publicatie uitgevoerd (expliciet toegestaan via MARKTPLAATS_BROWSER_ALLOW_SUBMIT=true)");
    } catch (err) {
      if (err instanceof SubmitNotAllowedError) {
        recordStatus(this.run, { field: "Plaats advertentie", status: "error", detail: err.message });
        this.run.stoppedBeforeSubmit = true;
        setState(this.run, "done", "Geblokkeerd door veiligheids-guard");
        return;
      }
      this.error("Plaats advertentie", this.errMsg(err));
      setState(this.run, "failed", "Publicatiestap mislukt");
    }
  }

  /**
   * The ONLY place that may trigger a definitive publish. assertSubmitAllowed()
   * throws first, so a future refactor cannot publish by accident.
   *
   * After clicking we do NOT assume success: we watch the page for a real
   * confirmation, a validation error, a confirmation dialog (one extra click)
   * or a payment step — a payment page is always left alone.
   */
  private async attemptSubmit(page: Page): Promise<void> {
    assertSubmitAllowed("Plaats advertentie");

    const resolved = await this.waitForResolve(page, SUBMIT_CANDIDATES, 3000);
    if (!resolved) {
      this.warn("Plaats advertentie", "Publicatieknop niet gevonden — browser blijft open op de controlepagina.");
      return;
    }

    const startUrl = page.url();
    await resolved.locator.click();
    await page.waitForTimeout(1500);
    this.ok("Plaats advertentie", "aangeklikt (MARKTPLAATS_BROWSER_ALLOW_SUBMIT=true)");

    const outcome = await this.waitForPublishOutcome(page, startUrl);
    await this.snapshot(page, "04-na-plaatsen");

    switch (outcome.kind) {
      case "payment":
        this.warn(
          "Betalingsstap",
          `Marktplaats wil naar een betaalpagina (${outcome.url}) — gestopt, er wordt niets betaald.`
        );
        setState(this.run, "done", "Gestopt vóór betaling — handmatig afronden");
        return;
      case "validation": {
        for (const line of outcome.problems.slice(0, 8)) {
          this.error("Validatie Marktplaats", line);
        }
        setState(this.run, "failed", "Plaatsen mislukt — Marktplaats toont validatiefouten");
        return;
      }
      case "success":
        this.run.postedUrl = outcome.url;
        this.ok("Geplaatst", outcome.url);
        this.info("Verwijderen", "Dit is een testadvertentie — verwijder hem zelf uit Mijn Advertenties.");
        setState(this.run, "done", "Testadvertentie geplaatst op Marktplaats");
        return;
      default:
        this.warn("Plaats advertentie", `Geen bevestiging gezien — laatste URL: ${outcome.url}`);
        setState(this.run, "done", "Plaatsing onbekend — browser staat open voor controle");
    }
  }

  /**
   * Polls the page after the publish click until Marktplaats confirms, shows
   * validation errors, asks for money, or we run out of patience. Clicks the
   * submit button at most ONCE extra for a confirmation dialog.
   */
  private async waitForPublishOutcome(page: Page, startUrl: string): Promise<PublishOutcome> {
    const deadline = Date.now() + 45_000;
    let confirmClicks = 0;

    for (;;) {
      const url = page.url();
      if (PAYMENT_URL_PATTERN.test(url)) return { kind: "payment", url };

      const heading = await page
        .locator("h1, h2")
        .first()
        .innerText()
        .catch(() => "");
      if (PAYMENT_HEADING_PATTERN.test(heading.trim())) return { kind: "payment", url };

      const body = await page.locator("body").innerText().catch(() => "");
      const navigatedAway = !this.samePage(url, startUrl);
      if (navigatedAway && (PUBLISHED_URL_PATTERN.test(url) || PUBLISH_SUCCESS_PATTERN.test(body))) {
        return { kind: "success", url };
      }

      // Marktplaats kan de geplaatste advertentie in een nieuw tabblad openen.
      const opened = await this.findPublishedPage(page, startUrl);
      if (opened) return { kind: "success", url: opened };

      const problems = await this.collectValidationProblems(page);

      if (problems.length > 0) {
        // A confirmation dialog keeps the old errors in the DOM — click through
        // it once. Otherwise the placement was rejected on this very page.
        const dialogVisible = await page
          .locator('[role="dialog"], [data-testid*="dialog"]')
          .first()
          .isVisible()
          .catch(() => false);
        if (dialogVisible && confirmClicks < 1) {
          confirmClicks += 1;
          const confirm = await this.resolveOn(page, SUBMIT_CANDIDATES);
          if (confirm) {
            await confirm.locator.click().catch(() => {});
            await page.waitForTimeout(2000);
            this.info("Plaats advertentie", "Bevestigingsdialoog een tweede keer aangeklikt");
            continue;
          }
        }
        if (!dialogVisible) return { kind: "validation", url, problems };
      }

      // Deliberately NO unconditional second click: pressing "Plaats je
      // advertentie" twice could create two advertisements. Only an explicit
      // confirmation dialog may be clicked through.

      if (Date.now() >= deadline) return { kind: "timeout", url };
      await page.waitForTimeout(1000).catch(() => {});
    }
  }

  /** URL's identiek buiten querystring/slashed af — voor "zijn we nog op het formulier?". */
  private samePage(a: string, b: string): boolean {
    const strip = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "");
    return strip(a) === strip(b);
  }

  /** Zoekt een ander tabblad waarop de advertentie daadwerkelijk is geplaatst. */
  private async findPublishedPage(page: Page, startUrl: string): Promise<string | null> {
    for (const other of page.context().pages()) {
      if (other === page) continue;
      const url = other.url();
      if (!url || url === "about:blank" || this.samePage(url, startUrl)) continue;
      if (PAYMENT_URL_PATTERN.test(url)) continue;
      const body = await other.locator("body").innerText().catch(() => "");
      if (PUBLISHED_URL_PATTERN.test(url) || PUBLISH_SUCCESS_PATTERN.test(body)) return url;
    }
    return null;
  }

  /** Visible field-level errors Marktplaats shows after a rejected submit. */
  private async collectValidationProblems(page: Page): Promise<string[]> {
    const problems: string[] = [];
    try {
      const nodes = page.locator(
        '.hz-InlineFeedback--error, [data-testid*="error"], [aria-invalid="true"] + *, .FormField-error'
      );
      const count = await nodes.count();
      for (let i = 0; i < Math.min(count, 8); i += 1) {
        const text = (await nodes.nth(i).innerText().catch(() => "")).trim().replace(/\s+/g, " ");
        if (text.length > 0 && !problems.includes(text)) problems.push(text.slice(0, 160));
      }
    } catch {
      /* optional — absence of errors must never break the run */
    }
    return problems;
  }

  // --------------------------------------------------------------- helpers

  private debugSuffix(): string {
    return this.debugFiles.length > 0 ? ` (debug: ${this.debugFiles[this.debugFiles.length - 1]})` : "";
  }

  private async snapshot(page: Page, step: string): Promise<void> {
    try {
      const dir = ensureDir(this.config.debugDir);
      const base = `${this.run.runId}-${step}`;
      const file = path.join(dir, `${base}.png`);
      await page.screenshot({ path: file }).catch(() => {});
      fs.writeFileSync(path.join(dir, `${base}.html`), await page.content().catch(() => ""));
      this.debugFiles.push(path.relative(process.cwd(), dir));
    } catch {
      /* debugging must never break the run */
    }
  }

  private buildLocator(page: Page, candidate: SelectorCandidate): Locator {
    const pattern = isRegexPattern(candidate.pattern) ? toRegExp(candidate.pattern) : candidate.pattern;
    switch (candidate.strategy) {
      case "label":
        return page.getByLabel(pattern, { exact: candidate.exact ?? false });
      case "role":
        return page.getByRole(candidate.role ?? "textbox", { name: pattern, exact: candidate.exact ?? false });
      case "placeholder":
        return page.getByPlaceholder(pattern, { exact: candidate.exact ?? false });
      case "testid":
        return page.getByTestId(String(pattern));
      case "xpath":
        return page.locator(`xpath=${pattern}`);
      case "css":
      default:
        return page.locator(String(pattern));
    }
  }

  private async resolveOn(
    page: Page,
    candidates: SelectorCandidate[],
    opts: { requireVisible?: boolean } = {}
  ): Promise<ResolvedLocator | null> {
    for (const candidate of candidates) {
      try {
        const locator = this.buildLocator(page, candidate).first();
        if ((await locator.count()) === 0) continue;
        if (opts.requireVisible !== false) {
          const visible = await locator.isVisible().catch(() => false);
          if (!visible) continue;
        }
        return { locator, candidate };
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  }

  /** Polls the candidate chain so late-rendering wizard fields are found too. */
  private async waitForResolve(
    page: Page,
    candidates: SelectorCandidate[],
    timeoutMs: number,
    requireVisible = true
  ): Promise<ResolvedLocator | null> {
    const deadline = Date.now() + Math.max(timeoutMs, 200);
    for (;;) {
      const found = await this.resolveOn(page, candidates, { requireVisible });
      if (found) return found;
      if (Date.now() >= deadline) return null;
      await page.waitForTimeout(250).catch(() => {});
    }
  }
}
