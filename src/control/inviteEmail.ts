// The invite email (pilot readiness, 2026-10-30): an optional recipient on the
// console's Invite codes screen, sent through the one mail path. The console
// has no hub in scope, so it goes from the platform's sender and the hub mail
// guard does not apply. The code is in it twice: in the link and as text.

import { INVITE_SUBJECT, inviteLink } from "../shared/hubInvite.js";
import { PLATFORM_CONTACT_EMAIL, PLATFORM_SETUP_GUIDE_URL } from "../shared/platform.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The invite, rendered. Pure, so a test reads exactly what is sent. */
export function renderInviteEmail(input: { startHost: string; code: string; expiresAt: string }): { subject: string; text: string; html: string } {
  const { startHost, code } = input;
  const link = inviteLink(startHost, code);
  const until = new Date(input.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const text = [
    "Hello,",
    "",
    "You're invited to create a Civic Hub: a place for your community's votes, proposals and conversations. You'll be its first admin, and it starts as a demo you can look around in and make your own.",
    "",
    `Start here: ${link}`,
    "",
    `Or go to https://${startHost} and enter this code: ${code}`,
    "",
    `The code works once, until ${until}.`,
    "",
    `The guide "Set up your hub" walks through what comes next: ${PLATFORM_SETUP_GUIDE_URL}`,
    "",
    `Questions? Write to ${PLATFORM_CONTACT_EMAIL}.`,
  ].join("\n");
  const a = (href: string, label = href) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const html = [
    `<p>Hello,</p>`,
    `<p>You're invited to create a Civic Hub: a place for your community's votes, proposals and conversations. You'll be its first admin, and it starts as a demo you can look around in and make your own.</p>`,
    `<p><strong>${a(link, "Create your hub")}</strong></p>`,
    `<p>Or go to ${a(`https://${startHost}`)} and enter this code: <strong>${escapeHtml(code)}</strong></p>`,
    `<p>The code works once, until ${escapeHtml(until)}.</p>`,
    `<p>The guide ${a(PLATFORM_SETUP_GUIDE_URL, "Set up your hub")} walks through what comes next.</p>`,
    `<p>Questions? Write to ${a(`mailto:${PLATFORM_CONTACT_EMAIL}`, PLATFORM_CONTACT_EMAIL)}.</p>`,
  ].join("\n");
  return { subject: INVITE_SUBJECT, text, html };
}
