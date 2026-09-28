import { EmailProvider } from "./types";
import { MockEmailProvider } from "./providers/mockProvider";
import { ResendEmailProvider } from "./providers/resendProvider";
import { PostmarkEmailProvider } from "./providers/postmarkProvider";

export function createEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || "mock").toLowerCase();

  switch (provider) {
    case "resend": {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM;
      if (!key || !from) {
        throw new Error("EMAIL_PROVIDER=resend maar RESEND_API_KEY of RESEND_FROM ontbreekt");
      }
      return new ResendEmailProvider(key, from);
    }
    case "postmark": {
      const key = process.env.POSTMARK_API_KEY;
      const from = process.env.POSTMARK_FROM;
      if (!key || !from) {
        throw new Error("EMAIL_PROVIDER=postmark maar POSTMARK_API_KEY of POSTMARK_FROM ontbreekt");
      }
      return new PostmarkEmailProvider(key, from);
    }
    case "mock":
      return new MockEmailProvider();
    default:
      throw new Error(`Onbekende EMAIL_PROVIDER: ${provider}`);
  }
}
