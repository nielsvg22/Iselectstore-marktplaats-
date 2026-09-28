import { EmailProvider, EmailPayload, EmailSendResult } from "../types";

export class PostmarkEmailProvider implements EmailProvider {
  readonly name = "postmark";
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.apiKey,
      },
      body: JSON.stringify({
        From: this.from,
        To: payload.to,
        Subject: payload.subject,
        HtmlBody: payload.html,
        TextBody: payload.text,
        MessageStream: "outbound",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, provider: this.name, error: data?.Message || `Postmark ${res.status}` };
    }
    return { ok: true, provider: this.name, providerMessageId: data?.MessageID };
  }
}
