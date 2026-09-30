import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmailProvider, assertEmailProviderConfigured, EmailConfigError, isProductionRuntime } from "@/services/notifications/emailProviderFactory";

const KEYS = [
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "POSTMARK_API_KEY",
  "POSTMARK_FROM",
  "ALLOW_MOCK_EMAIL",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

// process.env is read-only voor NODE_ENV in de Next.js types.
const env = process.env as unknown as Record<string, string | undefined>;

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

let snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  snapshot = {};
  for (const k of KEYS) {
    snapshot[k] = env[k];
    setEnv(k, undefined);
  }
  setEnv("NODE_ENV", "test");
});

afterEach(() => {
  for (const k of KEYS) {
    setEnv(k, snapshot[k]);
  }
});

describe("isProductionRuntime", () => {
  it("is true when VERCEL_ENV=production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isProductionRuntime()).toBe(true);
  });

  it("is false for preview deployments", () => {
    process.env.VERCEL_ENV = "preview";
    setEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(false);
  });

  it("falls back to NODE_ENV outside Vercel", () => {
    setEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
  });
});

describe("mock provider guard", () => {
  it("allows mock outside production", () => {
    expect(() => createEmailProvider()).not.toThrow();
    expect(createEmailProvider().name).toBe("mock");
  });

  it("throws a clear error instead of silently swallowing mail in production", () => {
    process.env.VERCEL_ENV = "production";
    let caught: unknown;
    try {
      createEmailProvider();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EmailConfigError);
    expect((caught as Error).message).toContain("EMAIL_PROVIDER");
    expect((caught as Error).message).toContain("RESEND_API_KEY");
  });

  it("can be overridden deliberately with ALLOW_MOCK_EMAIL", () => {
    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_MOCK_EMAIL = "1";
    expect(createEmailProvider().name).toBe("mock");
  });
});

describe("resend configuration", () => {
  it("throws when the API key is missing in production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_FROM = "noreply@iselectstore.nl";
    expect(() => assertEmailProviderConfigured()).toThrow(EmailConfigError);
  });

  it("throws when the FROM address is missing", () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    expect(() => createEmailProvider()).toThrow(/RESEND_FROM/);
  });

  it("works when both are set", () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@iselectstore.nl";
    expect(createEmailProvider().name).toBe("resend");
  });
});

describe("unknown provider", () => {
  it("throws instead of falling back to mock", () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    expect(() => createEmailProvider()).toThrow(EmailConfigError);
  });
});
