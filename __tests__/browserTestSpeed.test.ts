import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

import { downloadImagesForBrowserTest, cleanupImageDir } from "@/lib/marktplaats/browserTest/imageStore";
import { getBrowserTestConfig } from "@/lib/marktplaats/browserTest/config";
import { MarktplaatsBrowserTestPublisher } from "@/lib/marktplaats/browserTest/browserTestPublisher";
import { createRun } from "@/lib/marktplaats/browserTest/status";

/**
 * Regression tests for part 5 (speed) of the assignment: bounded-concurrency
 * image downloads, and reusing an already-verified category mapping instead
 * of re-running the DOM text search.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadImagesForBrowserTest — begrensde gelijktijdigheid (onderdeel 5)", () => {
  it("downloadt meerdere afbeeldingen parallel, nooit meer dan de concurrency-limiet tegelijk", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from(`data-for-${url}`),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = Array.from({ length: 8 }, (_, i) => `https://cdn.example.com/photo-${i}.jpg`);
    const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await downloadImagesForBrowserTest(urls, runId);

    expect(result.files).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    // Nooit volledig sequentieel (zou maxInFlight === 1 geven) en nooit
    // ongebreideld parallel (zou maxInFlight === 8 geven) — bounded.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);

    // Bestandsvolgorde volgt de input-volgorde, niet de volgorde waarin de
    // (even snelle) downloads toevallig afronden.
    expect(result.files.map((f) => f.url)).toEqual(urls);

    await cleanupImageDir(result.dir);
  });

  it("laat één mislukte download de andere niet blokkeren", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("broken")) throw new Error("network down");
      return { ok: true, arrayBuffer: async () => Buffer.from("ok") } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = ["https://cdn.example.com/a.jpg", "https://cdn.example.com/broken.jpg", "https://cdn.example.com/c.jpg"];
    const result = await downloadImagesForBrowserTest(urls, `test-fail-${Date.now()}`);

    expect(result.files).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].url).toContain("broken");

    await cleanupImageDir(result.dir);
  });
});

describe("config — nieuwe env-vars uit de opdracht", () => {
  afterEach(() => {
    delete process.env.MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE;
    delete process.env.MARKTPLAATS_BROWSER_DEBUG_ARTIFACTS;
  });

  it("MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE is standaard false (onderdeel 2)", () => {
    delete process.env.MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE;
    expect(getBrowserTestConfig().allowThrowawayProfile).toBe(false);
    process.env.MARKTPLAATS_BROWSER_ALLOW_THROWAWAY_PROFILE = "true";
    expect(getBrowserTestConfig().allowThrowawayProfile).toBe(true);
  });

  it("MARKTPLAATS_BROWSER_DEBUG_ARTIFACTS is standaard true (onderdeel 5)", () => {
    delete process.env.MARKTPLAATS_BROWSER_DEBUG_ARTIFACTS;
    expect(getBrowserTestConfig().captureDebugArtifacts).toBe(true);
    process.env.MARKTPLAATS_BROWSER_DEBUG_ARTIFACTS = "false";
    expect(getBrowserTestConfig().captureDebugArtifacts).toBe(false);
  });

  it("GET-config stuurt nooit meer het noVNC-wachtwoord mee (onderdeel 4)", () => {
    const config = getBrowserTestConfig();
    expect(config).not.toHaveProperty("novncPasswordExposed");
    // De config zelf kent het wachtwoord nog server-side (nodig voor
    // toekomstig gebruik), maar de API-route (route.ts) laat het veld
    // bewust weg uit de JSON-response — zie app/api/marktplaats/browser-test/route.ts.
    const routeSource = fs.readFileSync("app/api/marktplaats/browser-test/route.ts", "utf8");
    expect(routeSource).not.toMatch(/novncPassword:\s*config\.novncPassword/);
  });
});

describe("selectByKnownValue() — hergebruik van een al-geverifieerde categoriemapping (onderdeel 5)", () => {
  it("kiest direct op bekende option-value, zonder de tekst-zoeklogica aan te roepen", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(createRun("prod-cat"));
    const options = [
      { value: "1234", text: "Mobiele telefoons" },
      { value: "5678", text: "Apple" },
    ];
    const select = {
      evaluate: vi.fn(async () => options),
      selectOption: vi.fn(async () => {}),
    } as any;

    const hit = await (publisher as any).selectByKnownValue(select, "5678");
    expect(hit).toEqual({ value: "5678", text: "Apple" });
    expect(select.selectOption).toHaveBeenCalledWith("5678");
  });

  it("geeft null terug (valt terug op tekst-zoeken) wanneer de bekende waarde niet meer bestaat", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(createRun("prod-cat-2"));
    const select = {
      evaluate: vi.fn(async () => [{ value: "9999", text: "Anders" }]),
      selectOption: vi.fn(async () => {}),
    } as any;

    const hit = await (publisher as any).selectByKnownValue(select, "1234");
    expect(hit).toBeNull();
    expect(select.selectOption).not.toHaveBeenCalled();
  });

  it("geeft null terug zonder DOM te raadplegen wanneer er geen bekende waarde is", async () => {
    const publisher = new MarktplaatsBrowserTestPublisher(createRun("prod-cat-3"));
    const select = { evaluate: vi.fn(), selectOption: vi.fn() } as any;
    const hit = await (publisher as any).selectByKnownValue(select, null);
    expect(hit).toBeNull();
    expect(select.evaluate).not.toHaveBeenCalled();
  });
});
