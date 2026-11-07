// The invite email (pilot readiness, 2026-10-30): an optional recipient on the
// console's Invite codes screen, sent through the one mail path. The console
// has no hub in scope, so it goes from the platform's sender and the hub mail
// guard does not apply.
//
// Pilot readiness 2 (2026-11-02): the link signs the person in as the address
// it was sent to, so it asks for no second code.
//
// Pilot readiness 3 (Adam, 2026-11-06): the email carries only the link. A
// link used or past its date is mended on the start page ("Send me a fresh
// link"), so the code and the two paragraphs about it are gone. The date is
// the link's own (seven days, never past the invite's end). An invite the
// console mints with no address is still a code, copied from the screen
// (shared/hubInvite.ts inviteMessage).

import { INVITE_SUBJECT, inviteSignInLink } from "../shared/hubInvite.js";
import { PLATFORM_CONTACT_EMAIL, PLATFORM_SETUP_GUIDE_URL } from "../shared/platform.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The invite, rendered. Pure, so a test reads exactly what is sent. */
export function renderInviteEmail(input: { startHost: string; linkToken: string; email: string; expiresAt: string }): { subject: string; text: string; html: string } {
  const { startHost, email } = input;
  const link = inviteSignInLink(startHost, input.linkToken);
  const until = new Date(input.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const intro =
    "You're invited to create a Civic Hub: a place for your community to make sense of issues, decide and act together. You'll be its first admin, and it starts as a demo you can look around in and make your own.";
  const text = [
    "Hello,",
    "",
    intro,
    "",
    `Create your hub: ${link}`,
    "",
    `This link signs you in as ${email} and works until ${until}.`,
    "",
    `The guide "Set up your hub" walks through what comes next: ${PLATFORM_SETUP_GUIDE_URL}`,
    "",
    `Questions? Write to ${PLATFORM_CONTACT_EMAIL}.`,
  ].join("\n");
  const a = (href: string, label = href) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const html = [
    `<p>Hello,</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p><strong>${a(link, "Create your hub")}</strong></p>`,
    `<p>This link signs you in as ${escapeHtml(email)} and works until ${escapeHtml(until)}.</p>`,
    `<p>The guide ${a(PLATFORM_SETUP_GUIDE_URL, "Set up your hub")} walks through what comes next.</p>`,
    `<p>Questions? Write to ${a(`mailto:${PLATFORM_CONTACT_EMAIL}`, PLATFORM_CONTACT_EMAIL)}.</p>`,
  ].join("\n");
  return { subject: INVITE_SUBJECT, text, html };
}
