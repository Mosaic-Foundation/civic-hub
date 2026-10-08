// The one-time sign-in code's rules, in one place.
//
// A hub's sign-in (./index.ts) and the super admin's (src/control/auth.ts)
// both prove a mailbox with an emailed six-digit code. They keep their codes
// in different tables — a hub's are hub data, the super admin's are not — but
// they enforce the SAME rules, from here, so neither grows a weaker copy:
// how the code is generated, how long it lives, how often a new one may be
// requested, how many wrong guesses it takes, and how long the lockout is.
// Extracted 2026-09-26 (Phase 5 part one) from ./index.ts, unchanged.

import { theName } from "../../shared/hubCopy.js";
import { randomInt } from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Brute-force defenses (audit P1 — account takeover). Cap wrong guesses per
// code, and throttle how often a fresh code can be requested so an attacker
// can't reset the cap by re-requesting.
export const MAX_VERIFY_ATTEMPTS = 5;
export const REQUEST_THROTTLE_MS = 30 * 1000; // 30s between code requests per email
// After MAX_VERIFY_ATTEMPTS wrong guesses the email is locked for this long —
// both verifying and requesting a new code are refused until it passes. Caps a
// patient brute-force attacker at 5 guesses per lockout window (negligible),
// while staying forgiving for a legit user who mistyped a few times.
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function generateOTP(): string {
  // Cryptographically secure — Math.random() is predictable and unfit for a
  // security credential.
  return randomInt(100000, 1000000).toString();
}

/** Human-friendly "try again in ~N minutes" message for a lockout. */
export function lockoutMessage(lockedUntilIso: string): string {
  const mins = Math.max(
    1,
    Math.ceil((new Date(lockedUntilIso).getTime() - Date.now()) / 60000),
  );
  return `Too many incorrect attempts. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

/**
 * The code email. `title` and `rawSender` are escaped: a hub's display name
 * is admin-authored text.
 */
export function renderCodeEmail(code: string, rawSender: string, action = "finish signing in", title = "Your sign-in code"): string {
  // "the" only where the name wants one (review R40): "the Example County
  // Civic Hub", but never "the We The People …".
  const inSender = escapeHtml(theName(rawSender));
  const signOff = escapeHtml(theName(rawSender, true));
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
      <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(title)}</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
        Enter this code in ${inSender} to ${escapeHtml(action)}:
      </p>
      <div style="font-size: 32px; font-weight: 600; letter-spacing: 8px; background: #f3f4f6; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 0 0 24px;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0 0 8px;">
        This code expires in 10 minutes. If you didn't request it, you can ignore this email.
      </p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0;">
        — ${signOff}
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
