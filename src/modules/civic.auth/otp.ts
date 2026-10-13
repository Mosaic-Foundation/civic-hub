// The one-time sign-in code's rules, in one place.
//
// A hub's sign-in (./index.ts) and the super admin's (src/control/auth.ts)
// both prove a mailbox with an emailed six-digit code. They keep their codes
// in different tables — a hub's are hub data, the super admin's are not — but
// they enforce the SAME rules, so neither grows a weaker copy: how the code
// is generated and how long it lives (here), and how often a new one may be
// requested and how many tries it takes (./codeRules.ts).
// Extracted 2026-09-26 (Phase 5 part one) from ./index.ts.

import { theName } from "../../shared/hubCopy.js";
import { randomInt } from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
// How many tries a code takes, how many may be live, and the per-address and
// per-IP caps: ./codeRules.ts (the sign-in slice, 2026-10-14). Nothing locks
// an address any more; too many wrong tries burn the code.

export function generateOTP(): string {
  // Cryptographically secure — Math.random() is predictable and unfit for a
  // security credential.
  return randomInt(100000, 1000000).toString();
}

export interface CodeEmail {
  html: string;
  text: string;
}

/**
 * The code email. `title` and `rawSender` are escaped: a hub's display name
 * is admin-authored text.
 *
 * The code sits on a line of its own in both parts, after the words "code"
 * and "is", which is what iOS and Android look for to offer it above the
 * keyboard (sign-in slice, 2026-10-14). `link`, when given, is the "Sign in"
 * button: the same code as a link, which opens the hub with one Confirm.
 */
export function renderCodeEmail(
  code: string,
  rawSender: string,
  action = "finish signing in",
  title = "Your sign-in code",
  link: string | null = null,
): CodeEmail {
  // "the" only where the name wants one (review R40): "the Example County
  // Civic Hub", but never "the We The People …".
  const inSender = theName(rawSender);
  const signOff = theName(rawSender, true);
  const button = link
    ? `
      <p style="margin: 0 0 24px; text-align: center;">
        <a href="${escapeHtml(link)}" style="display: inline-block; background: #1f2937; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 12px 28px; border-radius: 8px;">Sign in</a>
      </p>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">Or enter this code in ${escapeHtml(inSender)} to ${escapeHtml(action)}. Your code is:</p>`
    : `
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">Enter this code in ${escapeHtml(inSender)} to ${escapeHtml(action)}. Your code is:</p>`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(title)}</h1>${button}
      <p style="font-size: 32px; font-weight: 600; letter-spacing: 8px; background: #f3f4f6; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 0 0 24px;">${code}</p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0 0 8px;">
        This code expires in 10 minutes. If you didn't request it, you can ignore this email.
      </p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0;">
        — ${escapeHtml(signOff)}
      </p>
    </div>
  `;
  const text = [
    title,
    "",
    ...(link ? [`Sign in: ${link}`, "", `Or enter this code in ${inSender} to ${action}. Your code is:`] : [`Enter this code in ${inSender} to ${action}. Your code is:`]),
    "",
    code,
    "",
    "This code expires in 10 minutes. If you didn't request it, you can ignore this email.",
    "",
    `— ${signOff}`,
  ].join("\n");
  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
