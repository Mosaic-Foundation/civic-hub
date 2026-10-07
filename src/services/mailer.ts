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
// Contract:
//   - resolves with a DeliveryReport: who it was sent to, and who the hub's
//     mode held it back from (src/services/mailGuard.ts) with the reason;
//   - held back is NOT failure (2026-10-07, review #34): on a demo or beta hub
//     an official is on neither list, and approving a brief used to answer
//     500 "Email delivery failed: … suppressed by hub mode" and leave it
//     pending. Now the brief publishes and its record says who was held back;
//   - throws `Email delivery failed: …` if any recipient really fails, so the
//     approval flows halt before publishing, as before;
//   - with no RESEND_API_KEY configured (local dev), logs the message and
//     counts it as sent, after the mode guard has had its say, so a held-back
//     recipient shows locally too.
//
// One send per recipient, never one message with many `to`s: recipients
// are officials and third parties who should not see each other's
// addresses.

import { sendEmail as sendViaResend } from "../utils/email.js";
import { mailDecision } from "./mailGuard.js";
import { hubModeHoldReason, type DeliveryReport } from "../shared/delivery.js";

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: [], held_back: [] };

  // The mode guard first, keyless or not: utils/email applies it too, but the
  // keyless path below never reaches utils/email.
  const deliverable: string[] = [];
  for (const to of message.to) {
    const decision = mailDecision(to);
    if (decision.send) deliverable.push(to);
    else report.held_back.push({ email: to, reason: hubModeHoldReason(decision.mode ?? "a restricted") });
  }
  if (report.held_back.length > 0) {
    console.log(
      `[mailer] held back "${message.subject}" from ${report.held_back.length} recipient(s): ` +
        `${report.held_back.map((h) => h.email).join(", ")} (${report.held_back[0].reason})`,
    );
  }

  if (!process.env.RESEND_API_KEY) {
    if (deliverable.length === 0) return report;
    // Visible, structured fallback so local dev runs can see what would
    // have been sent. Treated as success for flow purposes.
    console.log("---- [mailer] RESEND_API_KEY unset — logging email ----");
    console.log(`To:      ${deliverable.join(", ")}`);
    console.log(`Subject: ${message.subject}`);
    console.log("");
    console.log(message.text);
    console.log("---- [mailer] end email ----");
    report.sent = deliverable;
    return report;
  }

  const failures: string[] = [];
  for (const to of deliverable) {
    try {
      const result = await sendViaResend({
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (result.sent) report.sent.push(to);
      else if (result.held_back) {
        report.held_back.push({ email: to, reason: result.held_back_reason ?? hubModeHoldReason("a restricted") });
      } else failures.push(`${to}: ${result.error ?? "unknown error"}`);
    } catch (err) {
      failures.push(`${to}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Email delivery failed: ${failures.join("; ")}`);
  }
  console.log(
    `[mailer] delivered "${message.subject}" to ${report.sent.length} recipient(s)`,
  );
  return report;
}
