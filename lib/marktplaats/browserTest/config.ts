import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Configuration + hard safety guard for the LOCAL Playwright browser test.
 *
 * This feature only ever *fills* the real Marktplaats form so we can verify
 * our field mapping. It is never a replacement for the official Marktplaats
 * API integration (see lib/marktplaats/apiPublisher.ts).
 *
 *   MARKTPLAATS_BROWSER_TEST=true           feature off/on (default: off)
 *   MARKTPLAATS_BROWSER_ALLOW_SUBMIT=false  click the final publish button
 *
 * Default is off/off: without explicit opt-in nothing runs and nothing can
 * ever be published through this path.
 *
 * ALLOW_SUBMIT=true makes the browser test place ONE real test advertisement
 * (used to verify the complete flow end-to-end — the test ad is deleted
 * manually afterwards). assertSubmitAllowed() is still the single hard guard:
 * no code path may reach the publish button without it.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return fallback;
  return TRUTHY.has(value);
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  return value.length === 0 ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface BrowserTestConfig {
  /** Feature switch — the API route refuses to start when false. */
  enabled: boolean;
  /** Hard switch in front of every definitive publish action. */
  allowSubmit: boolean;
  headless: boolean;
  /** Optional Chrome channel, e.g. "chrome" — handy on WSL/Windows. */
  channel: string | null;
  baseUrl: string;
  placementUrl: string;
  profileDir: string;
  debugDir: string;
  tempImageRoot: string;
  /** Seller postcode Marktplaats requires on every placed advertisement. */
  postcode: string | null;
  loginTimeoutMs: number;
  navigationTimeoutMs: number;
  maxImages: number;
  /**
   * Optional: when both are set, ensureLoggedIn() fills and submits the real
   * Marktplaats login form itself instead of waiting for a human — needed to
   * run this from a phone (typing into a remote noVNC session on mobile is
   * painful). Only ever read from env vars, never hardcoded or logged.
   * Omit either one to keep the original manual-login behaviour.
   */
  username: string | null;
  password: string | null;
}

export function getBrowserTestConfig(): BrowserTestConfig {
  const baseUrl = envString("MARKTPLAATS_BROWSER_BASE_URL", "https://www.marktplaats.nl");
  return {
    enabled: envFlag("MARKTPLAATS_BROWSER_TEST", false),
    allowSubmit: envFlag("MARKTPLAATS_BROWSER_ALLOW_SUBMIT", false),
    headless: envFlag("MARKTPLAATS_BROWSER_HEADLESS", false),
    channel: process.env.MARKTPLAATS_BROWSER_CHANNEL?.trim() || null,
    baseUrl: baseUrl.replace(/\/$/, ""),
    placementUrl: envString("MARKTPLAATS_BROWSER_PLACEMENT_URL", `${baseUrl.replace(/\/$/, "")}/plaats`),
    profileDir: path.resolve(process.cwd(), envString("MARKTPLAATS_BROWSER_PROFILE_DIR", ".playwright/marktplaats-profile")),
    debugDir: path.resolve(process.cwd(), envString("MARKTPLAATS_BROWSER_DEBUG_DIR", ".playwright/debug")),
    tempImageRoot: path.join(os.tmpdir(), "iselectstore-marktplaats-browser-test"),
    postcode: process.env.MARKPLAATS_BROWSER_POSTCODE?.trim() || null,
    loginTimeoutMs: envNumber("MARKTPLAATS_BROWSER_LOGIN_TIMEOUT_MS", 5 * 60 * 1000),
    navigationTimeoutMs: envNumber("MARKTPLAATS_BROWSER_NAV_TIMEOUT_MS", 30 * 1000),
    maxImages: envNumber("MARKTPLAATS_BROWSER_MAX_IMAGES", 10),
    username: process.env.MARKTPLAATS_USERNAME?.trim() || null,
    password: process.env.MARKTPLAATS_PASSWORD?.trim() || null,
  };
}

export function isBrowserTestEnabled(): boolean {
  return getBrowserTestConfig().enabled;
}

export function isSubmitAllowed(): boolean {
  return getBrowserTestConfig().allowSubmit;
}

export class SubmitNotAllowedError extends Error {
  readonly code = "MARKTPLAATS_SUBMIT_BLOCKED";
  constructor(action: string) {
    super(
      `Publicatie geblokkeerd: "${action}" mag niet worden uitgevoerd zolang MARKTPLAATS_BROWSER_ALLOW_SUBMIT niet op true staat.`
    );
    this.name = "SubmitNotAllowedError";
  }
}

/**
 * HARD GUARD. Call this immediately before ANY action that could end up
 * placing/confirming a real advertisement. It throws when the submit flag is
 * not explicitly enabled — deliberately independent of which selectors or
 * flow steps happen to exist, so future changes cannot accidentally publish.
 */
export function assertSubmitAllowed(action: string): void {
  if (!isSubmitAllowed()) {
    throw new SubmitNotAllowedError(action);
  }
}

export interface SubmitGuardResult {
  allowed: boolean;
  stopped: boolean;
  reason: string;
}

/**
 * Non-throwing variant used to *stop the flow* before the publish step.
 * Always ends the test on the last review page when submit is not allowed.
 */
export function stopBeforeSubmit(action = "Definitieve publicatie"): SubmitGuardResult {
  if (isSubmitAllowed()) {
    return { allowed: true, stopped: false, reason: "" };
  }
  return {
    allowed: false,
    stopped: true,
    reason: `Gestopt vóór "${action}" — MARKTPLAATS_BROWSER_ALLOW_SUBMIT staat op false. Controleer het formulier handmatig.`,
  };
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
