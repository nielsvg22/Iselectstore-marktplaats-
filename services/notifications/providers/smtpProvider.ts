import nodemailer, { Transporter } from "nodemailer";
import { EmailProvider, EmailPayload, EmailSendResult } from "../types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Generic SMTP provider — for a self-hosted mail service (e.g. Postal on Coolify) instead of a third-party API like Resend. */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly from: string;
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(payload: EmailPayload): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: payload.attachments?.map((a) => ({
          filename: a.filename,
          content: typeof a.content === "string" ? Buffer.from(a.content, "base64") : Buffer.from(a.content),
          contentType: a.contentType,
          ...(a.contentId ? { cid: a.contentId } : {}),
        })),
      });
      return { ok: true, provider: this.name, providerMessageId: info.messageId };
    } catch (err) {
      return { ok: false, provider: this.name, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
