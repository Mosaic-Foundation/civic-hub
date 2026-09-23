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

import { currentSender, isSandboxSender } from "../services/emailSender.js";
import { allowDelivery } from "../services/mailGuard.js";

/**
 * Validate email configuration at startup. Logs warnings for missing
 * or malformed values so misconfigurations surface in deploy logs
 * rather than failing silently per-request.
 */
export function validateEmailConfig(): void {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM?.trim() || process.env.SMTP_FROM?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!apiKey) {
    const msg = "RESEND_API_KEY is not set — emails will NOT be sent.";
    if (isProd) {
      console.error(`[email] ❌ ${msg} OTP sign-in will fail silently.`);
    } else {
      console.warn(`[email] ⚠️  ${msg} OTP codes will be logged to console.`);
    }
    return;
  }

  if (!from) {
    // Not "may be rejected" — WILL be, for everyone but one address. This
    // wording was too mild to act on: it appeared in every dev function log
    // for fourteen hours while sign-in mail silently failed.
    console.error(
      "[email] ❌ RESEND_FROM is not set — falling back to the Resend sandbox " +
      "sender, which delivers ONLY to the Resend account owner's own address. " +
      "Every other recipient will be refused with 403 validation_error.",
    );
  } else {
    const emailMatch = from.match(/<([^>]+)>/);
    const addr = emailMatch ? emailMatch[1] : from;
    const domain = addr.split("@")[1];
    if (!domain || !domain.includes(".")) {
      console.error(
        `[email] ❌ RESEND_FROM domain looks malformed: "${domain}" (full value: "${from}"). ` +
        'Emails will likely be rejected by Resend.',
      );
    } else {
      console.log(`[email] ✓ RESEND_FROM domain: ${domain}`);
    }
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  sent: boolean;
  provider?: "resend";
  id?: string;
  error?: string;
}

/**
 * Send an email via Resend. Returns { sent: false } if RESEND_API_KEY is
 * unset — caller can decide to fall back (e.g. log to console in dev).
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  // BEFORE the transport check, not after. Whether a hub may write to this
  // address is a decision about the hub, not about how mail happens to be
  // configured — and putting it first means the suppression is visible in
  // local development too, where there is no API key and the fallback path
  // would otherwise swallow it.
  if (!allowDelivery(input.to, input.subject)) {
    return { sent: false, error: "suppressed by hub mode" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY is not configured" };
  }

  const sender = currentSender();
  if (isSandboxSender(sender.address)) {
    console.warn(
      `[email] sending as the Resend sandbox (${sender.address}) — only the ` +
      "Resend account owner will receive this. Set RESEND_FROM.",
    );
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? stripHtml(input.html),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        sent: false,
        error: `Resend ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string };
    return { sent: true, provider: "resend", id: data.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
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
