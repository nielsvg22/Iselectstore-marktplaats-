import { EmailProvider, EmailPayload, EmailSendResult } from "../types";

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    // In mock mode we simply succeed and log nothing sensitive here.
    // The caller is responsible for writing a history row.
    return { ok: true, provider: this.name };
  }
}
