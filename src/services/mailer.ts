// Mailer service — the brief / vote-results delivery mailer.
//
// Callers pass a fully-formatted message (subject, html, text, recipients);
// this module handles transport. Since 2026-09-06 transport is Resend via
// utils/email — the same sender every other email on the hub uses (sign-in
// codes, digests, review notices, feedback). It was nodemailer over SMTP,
// configured by SMTP_* env vars nobody maintained: the first real brief
// approval on prod halted with "535 Authentication credentials invalid"
// while every other email worked (Adam, smoke test item 27).
//
// Contract, unchanged for callers:
//   - resolves when every recipient was sent;
//   - throws `Email delivery failed: …` if any recipient fails, so the
//     approval flows halt before publishing;
//   - with no RESEND_API_KEY configured (local dev), logs the message and
//     resolves — the flow stays testable end to end with a visible trail.
//
// One send per recipient, never one message with many `to`s: recipients
// are officials and third parties who should not see each other's
// addresses.

import { sendEmail as sendViaResend } from "../utils/email.js";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    // Visible, structured fallback so local dev runs can see what would
    // have been sent. Treated as success for flow purposes.
    console.log("---- [mailer] RESEND_API_KEY unset — logging email ----");
    console.log(`To:      ${message.to.join(", ")}`);
    console.log(`Subject: ${message.subject}`);
    console.log("");
    console.log(message.text);
    console.log("---- [mailer] end email ----");
    return;
  }

  const failures: string[] = [];
  for (const to of message.to) {
    try {
      const result = await sendViaResend({
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (!result.sent) failures.push(`${to}: ${result.error ?? "unknown error"}`);
    } catch (err) {
      failures.push(`${to}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Email delivery failed: ${failures.join("; ")}`);
  }
  console.log(
    `[mailer] delivered "${message.subject}" to ${message.to.length} recipient(s)`,
  );
}
