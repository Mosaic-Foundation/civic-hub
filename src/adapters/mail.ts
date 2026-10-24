// The `mail` adapter (ADR-012): how a message leaves the hub. The engine
// decides whether to send (src/services/mailGuard.ts), whom from
// (src/services/emailSender.ts) and what; the transport only delivers.
// Hosting: src/hosting/resend.ts. Fake: src/adapters/fakes/mail.ts.

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailDelivery = { sent: true; id?: string } | { sent: false; error: string };

export interface MailTransport {
  /** "resend", "fake", "none": the `provider` on a send result. */
  readonly name: string;
  /** Can deliver. Unset, callers log the message instead (local development). */
  configured(): boolean;
  /** Why it cannot deliver, for the log. */
  notConfiguredReason(): string;
  /** The From when neither the hub nor the deployment names one. */
  defaultSender(): string;
  /** An address the provider delivers only to its own account (a warning, not a refusal). */
  isSandboxSender(address: string): boolean;
  send(message: OutgoingMail): Promise<MailDelivery>;
  /** Startup: log what is missing or malformed, never a secret. */
  checkAtStartup?(): void;
}
