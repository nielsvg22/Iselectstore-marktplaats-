import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SubmitNotAllowedError,
  assertSubmitAllowed,
  getBrowserTestConfig,
  isBrowserTestEnabled,
  isSubmitAllowed,
  stopBeforeSubmit,
} from "@/lib/marktplaats/browserTest/config";
import {
  CORE_FIELD_SELECTORS,
  FIELD_LABEL_ALIASES,
  SelectorStrategy,
  buildAttributeCandidates,
} from "@/lib/marktplaats/browserTest/selectors";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("harde publicatie-guard", () => {
  it("blokkeert publicatie standaard (ALLOW_SUBMIT niet gezet)", () => {
    delete process.env.MARKTPLAATS_BROWSER_ALLOW_SUBMIT;
    expect(isSubmitAllowed()).toBe(false);
    expect(() => assertSubmitAllowed("Plaats advertentie")).toThrow(SubmitNotAllowedError);
    expect(stopBeforeSubmit().stopped).toBe(true);
  });

  it("blokkeert publicatie expliciet wanneer ALLOW_SUBMIT=false", () => {
    process.env.MARKTPLAATS_BROWSER_ALLOW_SUBMIT = "false";
    expect(isSubmitAllowed()).toBe(false);
    expect(() => assertSubmitAllowed("Plaats advertentie")).toThrow(SubmitNotAllowedError);
    const guard = stopBeforeSubmit("Plaats advertentie");
    expect(guard.stopped).toBe(true);
    expect(guard.reason).toContain("MARKTPLAATS_BROWSER_ALLOW_SUBMIT");
  });

  it("laat publicatie alleen toe met ALLOW_SUBMIT=true", () => {
    process.env.MARKTPLAATS_BROWSER_ALLOW_SUBMIT = "true";
    expect(isSubmitAllowed()).toBe(true);
    expect(() => assertSubmitAllowed("Plaats advertentie")).not.toThrow();
    expect(stopBeforeSubmit().stopped).toBe(false);
  });

  it("heeft de browsertest standaard UIT (MARKTPLAATS_BROWSER_TEST)", () => {
    delete process.env.MARKTPLAATS_BROWSER_TEST;
    expect(isBrowserTestEnabled()).toBe(false);
    process.env.MARKTPLAATS_BROWSER_TEST = "true";
    expect(isBrowserTestEnabled()).toBe(true);
    process.env.MARKTPLAATS_BROWSER_TEST = "false";
    expect(isBrowserTestEnabled()).toBe(false);
  });

  it("levert een complete config zonder fonts/profiel te committen", () => {
    const config = getBrowserTestConfig();
    expect(config.placementUrl).toMatch(/^https:\/\/www\.marktplaats\.nl\//);
    expect(config.profileDir).toContain(".playwright");
    expect(config.maxImages).toBeGreaterThan(1);
  });
});

describe("selectorketen", () => {
  const strategies: SelectorStrategy[] = ["label", "role", "placeholder", "testid", "css", "xpath"];

  it("heeft voor ieder kernveld minstens één selector met fallbacks", () => {
    for (const [field, plan] of Object.entries(CORE_FIELD_SELECTORS)) {
      expect(plan.candidates.length, `${field} moet minstens 2 kandidaten hebben`).toBeGreaterThanOrEqual(2);
      // Een file-input heeft normaal geen label/role — daar is testid + CSS
      // de robuuste optie; alle andere velden beginnen bij label/role.
      const hasRobust =
        field === "images"
          ? plan.candidates.some((c) => c.strategy === "testid" || c.strategy === "css")
          : plan.candidates.some((c) => c.strategy === "label" || c.strategy === "role");
      expect(hasRobust, `${field} moet een robuuste eerste kandidaat hebben`).toBe(true);
      for (const candidate of plan.candidates) {
        expect(strategies).toContain(candidate.strategy);
        expect(candidate.pattern.length).toBeGreaterThan(0);
        if (candidate.strategy === "role") expect(candidate.role).toBeTruthy();
      }
    }
  });

  it("kiest robuuste label-selectors boven CSS/XPath voor productvelden", () => {
    const candidates = buildAttributeCandidates({
      internalField: "storage_gb",
      ownLabel: "Opslag (GB)",
      marktplaatsLabel: "Opslagcapaciteit",
    });
    expect(candidates[0].strategy).toBe("label");
    expect(candidates[0].pattern).toContain("Opslagcapaciteit");
    expect(candidates.some((c) => c.strategy === "css")).toBe(true);
    expect(candidates.some((c) => c.strategy === "xpath")).toBe(true);
  });

  it("heeft alias-lijsten voor de velden uit de opdracht", () => {
    for (const key of ["model", "storage_gb", "color", "condition", "battery_percentage", "manufacturer_name"]) {
      expect(FIELD_LABEL_ALIASES[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("geen dubbele mappinglogica", () => {
  const root = path.resolve(__dirname, "..");
  const browserTestDir = path.join(root, "lib/marktplaats/browserTest");

  it("browserTest-modules bevatten geen centrale mapping-/generatorencode", () => {
    const forbidden = [
      "generateMarktplaatsTitle",
      "generateMarktplaatsDescription",
      "generateShopifyTitle",
      "mapProductToAttributes",
      "buildMarktplaatsPayload",
      "runPreflightValidation",
    ];
    for (const file of fs.readdirSync(browserTestDir)) {
      if (!file.endsWith(".ts")) continue;
      const source = fs.readFileSync(path.join(browserTestDir, file), "utf8");
      for (const fn of forbidden) {
        expect(source.includes(fn), `${file} mag ${fn} niet (her)implementeren`).toBe(false);
      }
    }
  });

  it("browserTest-code importeert de advertentiedata via MarktplaatsService", () => {
    const publisher = fs.readFileSync(path.join(browserTestDir, "browserTestPublisher.ts"), "utf8");
    expect(publisher).toContain('from "../service"');
    expect(publisher).toContain("AdvertisementDraft");
  });

  it("geen enkele client-component importeert playwright", () => {
    const appDir = path.join(root, "app");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".tsx") ? [full] : [];
      });
    for (const file of walk(appDir)) {
      const source = fs.readFileSync(file, "utf8");
      expect(source.includes('from "playwright"'), `${file} mag geen playwright-import hebben`).toBe(false);
      expect(source.includes('require("playwright")')).toBe(false);
    }
  });
});
