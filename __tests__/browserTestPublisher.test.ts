import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MarktplaatsBrowserTestPublisher } from "@/lib/marktplaats/browserTest/browserTestPublisher";
import {
  createRun,
  findActiveRunForProduct,
  setState,
  submitVerificationCode,
} from "@/lib/marktplaats/browserTest/status";
import { getActiveContext, setActiveContext } from "@/lib/marktplaats/browserTest/session";

/**
 * Regression tests for part 7 of the assignment (MFA/profile-robustness
 * rewrite). Playwright itself is never started here — a minimal fake
 * `Page`/`BrowserContext` stands in, and `playwright`'s `chromium` is
 * mocked so `ensureContext()` can be exercised without a real browser.
 */

vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  setActiveContext(null);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setActiveContext(null);
  vi.restoreAllMocks();
});

function makeRun(shopifyProductId = "prod-1") {
  return createRun(shopifyProductId);
}

/** Minimal fake Playwright Page covering exactly what isLoggedIn()/waitForAuthenticationOutcome() touch. */
function makeFakePage(opts: { url: string; accountMarkers?: number; heading?: string; errorText?: string }) {
  let url = opts.url;
  const page = {
    url: () => url,
    setUrl: (u: string) => {
      url = u;
    },
    locator: (selector: string) => ({
      first: () => ({
        innerText: async (_o?: unknown) => {
          if (/h1, h2/.test(selector)) return opts.heading ?? "";
          if (/role="alert"/.test(selector)) return opts.errorText ?? "";
          return "";
        },
      }),
      count: async () => {
        if (/mijn-marktplaats/.test(selector)) return opts.accountMarkers ?? 0;
        return 0;
      },
    }),
    waitForTimeout: async () => {},
  };
  return page as unknown as import("playwright").Page & { setUrl: (u: string) => void };
}

describe("isLoggedIn() — geen optimistische aanname meer (onderdeel 1)", () => {
  it("retourneert true bij een expliciete accountmarker", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({ url: "https://www.marktplaats.nl/plaats", accountMarkers: 1 });
    await expect((publisher as any).isLoggedIn(page)).resolves.toBe(true);
  });

  it("retourneert false zonder enige marker — 'geen loginknop zichtbaar' is NIET genoeg bewijs", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({ url: "https://www.marktplaats.nl/plaats", accountMarkers: 0 });
    await expect((publisher as any).isLoggedIn(page)).resolves.toBe(false);
  });

  it("retourneert false tijdens de 2FA-interstitial, ook zonder /login in de URL", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({
      url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge?flow=login",
      accountMarkers: 0,
      heading: "Beveiligingscontrole",
    });
    await expect((publisher as any).isLoggedIn(page)).resolves.toBe(false);
  });
});

describe("waitForAuthenticationOutcome() — expliciet bewijs vóór 'authenticated' (onderdeel 1)", () => {
  it("'authenticated' pas na wegnavigeren van de challenge-URL + bevestigde accountmarker", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({ url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge", accountMarkers: 1 });
    (page as any).setUrl("https://www.marktplaats.nl/plaats");
    const outcome = await (publisher as any).waitForAuthenticationOutcome(page, "https://www.marktplaats.nl/two-factor-auth-setup/challenge", 2000);
    expect(outcome).toEqual({ kind: "authenticated" });
  });

  it("'rejected' bij een ongeldige code — Marktplaats' eigen foutmelding, nooit aangenomen", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({
      url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge",
      errorText: "De ingevoerde code is onjuist.",
    });
    const outcome = await (publisher as any).waitForAuthenticationOutcome(page, page.url(), 2000);
    expect(outcome.kind).toBe("rejected");
    expect((outcome as any).detail).toContain("onjuist");
  });

  it("'rejected' bij een verlopen code", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({
      url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge",
      errorText: "Deze code is verlopen, vraag een nieuwe aan.",
    });
    const outcome = await (publisher as any).waitForAuthenticationOutcome(page, page.url(), 2000);
    expect(outcome.kind).toBe("rejected");
  });

  it("'timeout' wanneer er noch bevestiging noch foutmelding verschijnt — nooit aangenomen als success", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const page = makeFakePage({ url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge" });
    const outcome = await (publisher as any).waitForAuthenticationOutcome(page, page.url(), 50);
    expect(outcome.kind).toBe("timeout");
  });
});

describe("handleVerificationChallenge() — 'code verzonden' ≠ 'ingelogd' (onderdeel 1 + 6)", () => {
  it("gaat pas naar 'authenticated' nadat de uitkomst dat expliciet bevestigt", async () => {
    const run = makeRun();
    const publisher = new MarktplaatsBrowserTestPublisher(run);
    vi.spyOn(publisher as any, "enterVerificationCode").mockResolvedValue(true);
    vi.spyOn(publisher as any, "waitForAuthenticationOutcome").mockResolvedValue({ kind: "authenticated" });
    const page = makeFakePage({ url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge" });

    const promise = (publisher as any).handleVerificationChallenge(page);
    expect(run.state).toBe("waiting_code");
    submitVerificationCode(run.runId, "123456");
    await promise;

    expect(run.state).toBe("authenticated");
    expect(run.codeAttempts ?? 0).toBe(0);
  });

  it("valt terug op 'waiting_code' (niet 'authenticated') bij een afgewezen/verlopen code", async () => {
    const run = makeRun();
    const publisher = new MarktplaatsBrowserTestPublisher(run);
    vi.spyOn(publisher as any, "enterVerificationCode").mockResolvedValue(true);
    vi.spyOn(publisher as any, "waitForAuthenticationOutcome").mockResolvedValue({ kind: "rejected", detail: "code verlopen" });
    const page = makeFakePage({ url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge" });

    const promise = (publisher as any).handleVerificationChallenge(page);
    submitVerificationCode(run.runId, "000000");
    await promise;

    expect(run.state).toBe("waiting_code");
    expect(run.codeAttempts).toBe(1);
  });

  it("blijft 'waiting_code' bij een tijdelijke netwerkfout tijdens verifiëren", async () => {
    const run = makeRun();
    const publisher = new MarktplaatsBrowserTestPublisher(run);
    vi.spyOn(publisher as any, "enterVerificationCode").mockResolvedValue(true);
    vi.spyOn(publisher as any, "waitForAuthenticationOutcome").mockResolvedValue({ kind: "network_error", detail: "ECONNRESET" });
    const page = makeFakePage({ url: "https://www.marktplaats.nl/two-factor-auth-setup/challenge" });

    const promise = (publisher as any).handleVerificationChallenge(page);
    submitVerificationCode(run.runId, "111111");
    await promise;

    expect(run.state).toBe("waiting_code");
  });
});

describe("ensureContext() — hard falen op een onbeschikbaar profiel (onderdeel 2)", () => {
  async function chromiumMock() {
    const playwright = await import("playwright");
    return playwright.chromium.launchPersistentContext as unknown as ReturnType<typeof vi.fn>;
  }

  it("faalt hard (geen stille fallback) wanneer het vaste profiel niet opent en throwaway niet is toegestaan", async () => {
    delete process.env.MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE;
    const launch = await chromiumMock();
    launch.mockReset().mockRejectedValue(new Error("EACCES: permission denied, open '/data/profile/Default'"));

    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    await expect((publisher as any).ensureContext()).rejects.toMatchObject({
      code: "MARKTPLAATS_PROFILE_UNAVAILABLE",
    });
    expect(launch).toHaveBeenCalledTimes(1); // geen tweede, stille poging met een leeg profiel
    expect(getActiveContext()).toBeNull();
  });

  it("gebruikt alleen een tijdelijk profiel wanneer dat expliciet is toegestaan", async () => {
    process.env.MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE = "true";
    const fakeContext = { on: vi.fn(), pages: () => [] };
    const launch = await chromiumMock();
    launch
      .mockReset()
      .mockRejectedValueOnce(new Error("EACCES: permission denied"))
      .mockResolvedValueOnce(fakeContext as any);

    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const context = await (publisher as any).ensureContext();
    expect(context).toBe(fakeContext);
    expect(launch).toHaveBeenCalledTimes(2);
    // Tweede aanroep gaat naar een ANDER (tijdelijk) pad dan de eerste.
    const [firstDir] = launch.mock.calls[0];
    const [secondDir] = launch.mock.calls[1];
    expect(secondDir).not.toBe(firstDir);
  });

  it("herbruikt het vaste profiel na opruimen van een verouderd SingletonLock (browserherstart, onderdeel 2)", async () => {
    const launch = await chromiumMock();
    const fakeContext = { on: vi.fn(), pages: () => [] };
    launch
      .mockReset()
      .mockRejectedValueOnce(new Error("Failed to create a ProcessSingleton for your profile directory. This means that running multiple instances would start multiple browser processes rather than opening a new window in the existing process. ... SingletonLock"))
      .mockResolvedValueOnce(fakeContext as any);

    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const context = await (publisher as any).ensureContext();
    expect(context).toBe(fakeContext);
    expect(launch).toHaveBeenCalledTimes(2);
    const [firstDir] = launch.mock.calls[0];
    const [secondDir] = launch.mock.calls[1];
    // Beide keren het VASTE profiel, nooit een tmp-fallback, voor dit specifieke geval.
    expect(secondDir).toBe(firstDir);
  });

  it("hergebruikt een bestaande, al actieve sessie in plaats van opnieuw te launchen", async () => {
    const launch = await chromiumMock();
    launch.mockReset();
    const fakeContext = { on: vi.fn(), pages: () => [] };
    setActiveContext(fakeContext as any);

    const publisher = new MarktplaatsBrowserTestPublisher(makeRun());
    const context = await (publisher as any).ensureContext();
    expect(context).toBe(fakeContext);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("meerdere producten achter elkaar, geen dubbele plaatsingen (onderdeel 7)", () => {
  it("blokkeert een tweede run voor HETZELFDE product terwijl de eerste nog actief is", () => {
    const first = createRun("prod-A");
    expect(findActiveRunForProduct("prod-A")?.runId).toBe(first.runId);

    setState(first, "done", "Klaar");
    expect(findActiveRunForProduct("prod-A")).toBeUndefined();

    const second = createRun("prod-A");
    expect(findActiveRunForProduct("prod-A")?.runId).toBe(second.runId);
  });

  it("laat verschillende producten gelijktijdig draaien zonder elkaar te blokkeren", () => {
    const runA = createRun("prod-A2");
    const runB = createRun("prod-B2");
    expect(findActiveRunForProduct("prod-A2")?.runId).toBe(runA.runId);
    expect(findActiveRunForProduct("prod-B2")?.runId).toBe(runB.runId);
  });

  it("blijft actief tijdens elke nieuwe MFA-tussenstap (verifying_code/authenticated)", () => {
    const run = createRun("prod-C");
    setState(run, "waiting_code");
    expect(findActiveRunForProduct("prod-C")?.runId).toBe(run.runId);
    setState(run, "verifying_code");
    expect(findActiveRunForProduct("prod-C")?.runId).toBe(run.runId);
    setState(run, "authenticated");
    expect(findActiveRunForProduct("prod-C")?.runId).toBe(run.runId);
  });
});
