export interface EmailAttachment {
  filename: string;
  /** Raw bytes, or already-base64-encoded content. */
  content: Buffer | Uint8Array | string;
  contentType?: string;
  /** Set to embed inline (e.g. a logo) instead of as a downloadable attachment — reference it in the HTML as `cid:<contentId>`. */
  contentId?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(payload: EmailPayload): Promise<EmailSendResult>;
}
