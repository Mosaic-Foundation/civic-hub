// The `mail` adapter's Resend implementation (hosting layer, ADR-012). The
// engine decides whether, whom from and what (src/utils/email.ts,
// src/services/mailGuard.ts, src/services/emailSender.ts); this delivers.
//
// Settings: RESEND_API_KEY (unset: not configured, mail is logged instead),
// RESEND_FROM (or the older SMTP_FROM): the deployment's verified sender.

import { env, hostingEnv } from "../config/env.js";
import type { MailTransport } from "../adapters/mail.js";

/** Resend's sandbox. Reaches the account owner and nobody else. */
export const SANDBOX_SENDER = "Civic Hub <onboarding@resend.dev>";

/** Is this the provider's sandbox, which reaches only the account owner? */
export function isSandboxSender(address: string): boolean {
  return /@resend\.dev$/i.test(address);
}

/**
 * Log, at startup, a mail setting that is missing or malformed, so a
 * misconfiguration surfaces in the deploy log rather than failing silently
 * per request. Never logs the key.
 */
export function checkResendAtStartup(): void {
  const apiKey = hostingEnv.RESEND_API_KEY;
  const from = hostingEnv.RESEND_FROM;
  const isProd = env.NODE_ENV === "production";

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

export const resendTransport: MailTransport = {
  name: "resend",
  configured: () => Boolean(hostingEnv.RESEND_API_KEY),
  notConfiguredReason: () => "RESEND_API_KEY is not configured",
  defaultSender: () => SANDBOX_SENDER,
  isSandboxSender,
  checkAtStartup: checkResendAtStartup,
  async send(message) {
    const apiKey = hostingEnv.RESEND_API_KEY;
    if (!apiKey) return { sent: false, error: "RESEND_API_KEY is not configured" };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { sent: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json()) as { id?: string };
      return { sent: true, id: data.id };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },
};
