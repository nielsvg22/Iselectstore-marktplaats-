import { EmailProvider, EmailPayload, EmailSendResult } from "../types";

function toBase64(content: Buffer | Uint8Array | string): string {
  return typeof content === "string" ? content : Buffer.from(content).toString("base64");
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        // Resend's send endpoint only documents {filename, content} (base64) —
        // it infers the MIME type from the filename extension, no content-type field.
        // An inline image (e.g. a logo referenced as cid:<id> in the HTML) adds content_id.
        attachments: payload.attachments?.map((a) => ({
          filename: a.filename,
          content: toBase64(a.content),
          ...(a.contentId ? { content_id: a.contentId } : {}),
        })),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, provider: this.name, error: data?.message || `Resend ${res.status}` };
    }
    return { ok: true, provider: this.name, providerMessageId: data?.id };
  }
}
