// Tiny email client — posts to Resend's HTTP API.
// No SDK dependency — keeps the deployable surface small.
//
// Env vars:
//   RESEND_API_KEY   — secret key from resend.com. If unset, email is
//                       NOT sent (caller should log a fallback).
//
// The "From" header is the email.from_address hub setting (KEYS.EMAIL_FROM_ADDRESS,
// falling back to RESEND_FROM / SMTP_FROM), e.g.
// "Floyd Civic Hub <noreply@floyd.civic.social>". Defaults to the Resend
// sandbox if unset.

import { getSettingSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

/**
 * Validate email configuration at startup. Logs warnings for missing
 * or malformed values so misconfigurations surface in deploy logs
 * rather than failing silently per-request.
 */
export function validateEmailConfig(): void {
  const apiKey = process.env.RESEND_API_KEY;
  const from = getSettingSync(KEYS.EMAIL_FROM_ADDRESS);
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
    console.warn(
      '[email] ⚠️  RESEND_FROM is not set — using Resend sandbox sender. ' +
      'Emails may land in spam or be rejected.',
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
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY is not configured" };
  }

  const from =
    getSettingSync(KEYS.EMAIL_FROM_ADDRESS) ?? "Civic Hub <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
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
