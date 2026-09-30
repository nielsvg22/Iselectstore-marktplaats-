import { EmailProvider } from "./types";
import { MockEmailProvider } from "./providers/mockProvider";
import { ResendEmailProvider } from "./providers/resendProvider";
import { PostmarkEmailProvider } from "./providers/postmarkProvider";

export class EmailConfigError extends Error {
  readonly code = "email_not_configured";
}

/**
 * True when we are running on the real production deployment.
 * `VERCEL_ENV` is authoritative on Vercel; NODE_ENV covers self-hosted runs.
 */
export function isProductionRuntime(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

/** Set ALLOW_MOCK_EMAIL=1 to deliberately run production with the mock provider (e.g. a smoke test). */
function mockAllowedInProduction(): boolean {
  const v = (process.env.ALLOW_MOCK_EMAIL || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Throws a clear, actionable error when production would silently swallow
 * every outgoing notification. Called before any send so a misconfigured
 * deployment fails loudly instead of pretending to work.
 */
export function assertEmailProviderConfigured(): void {
  const provider = (process.env.EMAIL_PROVIDER || "mock").toLowerCase().trim();

  if (provider === "mock") {
    if (isProductionRuntime() && !mockAllowedInProduction()) {
      throw new EmailConfigError(
        "EMAIL_PROVIDER is niet geconfigureerd (staat op 'mock'). Stel in Vercel in: " +
          "EMAIL_PROVIDER=resend, RESEND_API_KEY=... en RESEND_FROM=noreply@<jouw-domein>. " +
          "Zet ALLOW_MOCK_EMAIL=1 als je mock in productie echt wilt gebruiken."
      );
    }
    return;
  }

  if (provider === "resend") {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
      throw new EmailConfigError("EMAIL_PROVIDER=resend maar RESEND_API_KEY of RESEND_FROM ontbreekt.");
    }
    return;
  }

  if (provider === "postmark") {
    if (!process.env.POSTMARK_API_KEY || !process.env.POSTMARK_FROM) {
      throw new EmailConfigError("EMAIL_PROVIDER=postmark maar POSTMARK_API_KEY of POSTMARK_FROM ontbreekt.");
    }
    return;
  }

  throw new EmailConfigError(`Onbekende EMAIL_PROVIDER: ${provider} (verwacht: resend, postmark of mock).`);
}

export function createEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || "mock").toLowerCase().trim();

  switch (provider) {
    case "resend": {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM;
      if (!key || !from) {
        throw new EmailConfigError("EMAIL_PROVIDER=resend maar RESEND_API_KEY of RESEND_FROM ontbreekt");
      }
      return new ResendEmailProvider(key, from);
    }
    case "postmark": {
      const key = process.env.POSTMARK_API_KEY;
      const from = process.env.POSTMARK_FROM;
      if (!key || !from) {
        throw new EmailConfigError("EMAIL_PROVIDER=postmark maar POSTMARK_API_KEY of POSTMARK_FROM ontbreekt");
      }
      return new PostmarkEmailProvider(key, from);
    }
    case "mock":
      // Guard production against a silent mock before handing back the provider.
      assertEmailProviderConfigured();
      return new MockEmailProvider();
    default:
      throw new EmailConfigError(`Onbekende EMAIL_PROVIDER: ${provider}`);
  }
}
