// The invite email (pilot readiness, 2026-10-30): an optional recipient on the
// console's Invite codes screen, sent through the one mail path. The console
// has no hub in scope, so it goes from the platform's sender and the hub mail
// guard does not apply.
//
// Pilot readiness 2 (2026-11-02): the link signs the person in as the address
// it was sent to, so it asks for no second code. The code is there as text, for
// a link already used or a person other than the addressee: typed by hand, it
// keeps the emailed sign-in code, because the system doesn't know who holds it.
// The email says which is which.

import { INVITE_SUBJECT, inviteSignInLink } from "../shared/hubInvite.js";
import { PLATFORM_CONTACT_EMAIL, PLATFORM_SETUP_GUIDE_URL } from "../shared/platform.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The invite, rendered. Pure, so a test reads exactly what is sent. */
export function renderInviteEmail(input: { startHost: string; code: string; linkToken: string; email: string; expiresAt: string }): { subject: string; text: string; html: string } {
  const { startHost, code, email } = input;
  const link = inviteSignInLink(startHost, input.linkToken);
  const until = new Date(input.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const text = [
    "Hello,",
    "",
    "You're invited to create a Civic Hub: a place for your community's votes, proposals and conversations. You'll be its first admin, and it starts as a demo you can look around in and make your own.",
    "",
    `Create your hub: ${link}`,
    "",
    `This link signs you in as ${email}, so you won't need another code. It works once, until ${until}.`,
    "",
    `If the link has been used, or someone else is creating the hub, go to https://${startHost} and enter this code: ${code}`,
    "",
    `Because anyone could type that code, we'll then email a six-digit sign-in code to the address you give. The code works once, until ${until}.`,
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
    `<p>This link signs you in as ${escapeHtml(email)}, so you won't need another code. It works once, until ${escapeHtml(until)}.</p>`,
    `<p>If the link has been used, or someone else is creating the hub, go to ${a(`https://${startHost}`)} and enter this code: <strong>${escapeHtml(code)}</strong></p>`,
    `<p>Because anyone could type that code, we'll then email a six-digit sign-in code to the address you give. The code works once, until ${escapeHtml(until)}.</p>`,
    `<p>The guide ${a(PLATFORM_SETUP_GUIDE_URL, "Set up your hub")} walks through what comes next.</p>`,
    `<p>Questions? Write to ${a(`mailto:${PLATFORM_CONTACT_EMAIL}`, PLATFORM_CONTACT_EMAIL)}.</p>`,
  ].join("\n");
  return { subject: INVITE_SUBJECT, text, html };
}
