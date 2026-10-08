// "You're now an admin of <hub>" (review R38, 2026-10-08).
//
// Sent to each address that joins a hub's admin list: the first admin when
// the console creates the hub, and anyone added later, from the console or
// from the hub's own Settings → Admins & board. Before this, nobody was told;
// they learned they were an admin by signing in.
//
// Runs inside the hub's scope (the console wraps the call in withHubScope),
// so the sender name, the link and the mode are the hub's own. The address is
// on the admin list by the time this runs, which the mode guard allows on a
// demo or beta hub; it is sent with purpose "admin_invite" because the
// request's settings snapshot predates the write (src/services/mailGuard.ts).
//
// A failed invite never undoes the change that caused it: the admin is
// added either way, and the caller says who was not emailed.

import { currentHub } from "../config/hubContext.js";
import { hubDisplayNameSync, hubModeSync } from "./hubSettings.js";
import { sendEmail } from "../utils/email.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { PLATFORM_CONTACT_EMAIL, PLATFORM_SETUP_GUIDE_URL } from "../shared/platform.js";

export interface AdminInviteInput {
  hubName: string;
  hubUrl: string;
  mode: "demo" | "beta" | "live";
}

/** What each mode means for a new admin, in a sentence. */
const MODE_LINE: Readonly<Record<AdminInviteInput["mode"], string>> = {
  demo:
    "The hub is a demo for now: anyone can look around, and items marked Sample are not real. When it is ready, Settings → Mode moves it to beta.",
  beta: "The hub is in beta: only its admins and the people on its allow list can sign in.",
  live: "The hub is live: anyone can sign in and take part.",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The invite, rendered. Pure, so a test reads exactly what is sent. */
export function renderAdminInvite(input: AdminInviteInput): { subject: string; text: string; html: string } {
  const { hubName, hubUrl } = input;
  const settingsUrl = `${hubUrl}/admin/settings`;
  const steps = [
    `Go to ${hubUrl} and sign in with this email address. A code comes to you by email.`,
    `Open Settings (${settingsUrl}). Work through Identity, Copy & pages, Legal and Email, so the hub speaks for your community.`,
    "Under Admins & board, add anyone who will run the hub with you. They get an email like this one.",
  ];
  const subject = `You're now an admin of ${hubName}`;
  const text = [
    "Hello,",
    "",
    `You've been made an admin of ${hubName}, at ${hubUrl}.`,
    "",
    "Your first steps:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    MODE_LINE[input.mode],
    "",
    `The guide "Set up your hub" walks through each step: ${PLATFORM_SETUP_GUIDE_URL}`,
    "",
    `Questions? Write to ${PLATFORM_CONTACT_EMAIL}.`,
  ].join("\n");
  const link = (href: string, label = href) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const html = [
    `<p>Hello,</p>`,
    `<p>You've been made an admin of <strong>${escapeHtml(hubName)}</strong>, at ${link(hubUrl)}.</p>`,
    `<p>Your first steps:</p>`,
    `<ol>`,
    `<li>Go to ${link(hubUrl)} and sign in with this email address. A code comes to you by email.</li>`,
    `<li>Open ${link(settingsUrl, "Settings")}. Work through Identity, Copy &amp; pages, Legal and Email, so the hub speaks for your community.</li>`,
    `<li>Under Admins &amp; board, add anyone who will run the hub with you. They get an email like this one.</li>`,
    `</ol>`,
    `<p>${escapeHtml(MODE_LINE[input.mode])}</p>`,
    `<p>The guide ${link(PLATFORM_SETUP_GUIDE_URL, "Set up your hub")} walks through each step.</p>`,
    `<p>Questions? Write to ${link(`mailto:${PLATFORM_CONTACT_EMAIL}`, PLATFORM_CONTACT_EMAIL)}.</p>`,
  ].join("\n");
  return { subject, text, html };
}

export interface InviteReport {
  /** Emailed. Locally, with no RESEND_API_KEY, "logged" counts here too. */
  sent: string[];
  /** Not emailed, each with the reason in plain words. */
  not_sent: Array<{ email: string; reason: string }>;
}

/** Email the invite to each address, in the hub in scope. Never throws. */
export async function sendAdminInvites(emails: readonly string[]): Promise<InviteReport> {
  const report: InviteReport = { sent: [], not_sent: [] };
  if (emails.length === 0 || !currentHub()) return report;
  const message = renderAdminInvite({ hubName: hubDisplayNameSync(), hubUrl: uiBaseUrl(), mode: hubModeSync() });
  for (const to of emails) {
    try {
      if (!process.env.RESEND_API_KEY) {
        // Local development: show what would have gone, as the mailer does.
        console.log(`---- [admin-invite] RESEND_API_KEY unset — logging email ----\nTo: ${to}\nSubject: ${message.subject}\n\n${message.text}\n---- end ----`);
        report.sent.push(to);
        continue;
      }
      const result = await sendEmail({ to, subject: message.subject, html: message.html, text: message.text, purpose: "admin_invite" });
      if (result.sent) report.sent.push(to);
      else report.not_sent.push({ email: to, reason: result.held_back_reason ?? result.error ?? "not sent" });
    } catch (err) {
      console.error(`[admin-invite] ${to}:`, err);
      report.not_sent.push({ email: to, reason: "The email could not be sent." });
    }
  }
  return report;
}

/** "Invited a@x.org." / "Could not email b@y.org (reason)." — for the page that added them. */
export function describeInvites(report: InviteReport): string | null {
  const parts: string[] = [];
  if (report.sent.length) parts.push(`Sent the admin invite to ${report.sent.join(", ")}.`);
  for (const n of report.not_sent) parts.push(`Could not email ${n.email}: ${n.reason}`);
  return parts.length ? parts.join(" ") : null;
}
