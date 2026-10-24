// Tiny email client — posts to Resend's HTTP API.
// No SDK dependency — keeps the deployable surface small.
//
// Env vars:
//   RESEND_API_KEY   — secret key from resend.com. If unset, email is
//                       NOT sent (caller should log a fallback).
//   RESEND_FROM      — the verified sending address for the deployment.
//
// THE ONE PLACE MAIL LEAVES THIS SERVICE. Every sender in src/ ends up here,
// which is why the two guards live here and not in eleven call sites:
//   - services/emailSender.ts composes the From, deployment address + hub name
//   - services/mailGuard.ts    refuses a recipient a non-live hub must not
//                              write to
// Both are no-ops for a live hub on a properly configured deployment.

import { adapters } from "../adapters/index.js";
import { currentSender } from "../services/emailSender.js";
import { allowDelivery, type MailPurpose } from "../services/mailGuard.js";
import { hubModeHoldReason } from "../shared/delivery.js";

/** Startup: the mail transport logs what is missing or malformed. */
export function validateEmailConfig(): void {
  adapters().mail.checkAtStartup?.();
}

/** Can this deployment deliver mail? Unset, flows log the message instead. */
export function mailConfigured(): boolean {
  return adapters().mail.configured();
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** What the message is, where that changes who may receive it (mailGuard). */
  purpose?: MailPurpose;
}

export interface SendEmailResult {
  sent: boolean;
  /** The transport that delivered it ("resend", "fake"). */
  provider?: string;
  id?: string;
  error?: string;
  /**
   * The hub's mode held this message back on purpose (mailGuard.ts). Not a
   * failure: callers count it apart and say so, never as "could not be sent".
   * `error` is unset; `held_back_reason` says why in an admin's words.
   */
  held_back?: true;
  held_back_reason?: string;
}

/**
 * Send an email through the mail adapter. Returns { sent: false } when no
 * transport is configured: the caller can decide to fall back (log it, in
 * development).
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  // BEFORE the transport check, not after. Whether a hub may write to this
  // address is a decision about the hub, not about how mail happens to be
  // configured — and putting it first means the suppression is visible in
  // local development too, where there is no API key and the fallback path
  // would otherwise swallow it.
  const decision = allowDelivery(input.to, input.subject, input.purpose);
  if (!decision.send) {
    return {
      sent: false,
      held_back: true,
      held_back_reason: hubModeHoldReason(decision.mode ?? "a restricted"),
    };
  }

  const transport = adapters().mail;
  if (!transport.configured()) {
    return { sent: false, error: transport.notConfiguredReason() };
  }

  const sender = currentSender();
  if (transport.isSandboxSender(sender.address)) {
    console.warn(
      `[email] sending as the provider's sandbox (${sender.address}) — only the ` +
      "account owner will receive this. Set RESEND_FROM.",
    );
  }

  const delivery = await transport.send({
    from: sender.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? stripHtml(input.html),
  });
  return delivery.sent
    ? { sent: true, provider: transport.name, id: delivery.id }
    : { sent: false, error: delivery.error };
}

/**
 * Why a message was not sent, for a log line: "held back (this hub is in demo
 * mode)" for the mode guard, the error otherwise. Keeps a held-back message
 * from reading as "Failed to send" in the logs (review #36).
 */
export function unsentReason(result: SendEmailResult): string {
  if (result.held_back) return `held back (${result.held_back_reason ?? "hub mode"})`;
  return result.error ?? "unknown error";
}

/** Minimal HTML-to-text for the plaintext fallback. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}
