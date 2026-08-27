// civic.announcement module — publication receipt
//
// An announcement carries the authority of whoever posted it: a card on
// the public feed reading "Board of Supervisors". That authority is what
// makes an official's account worth stealing, and sign-in here is a code
// sent to their inbox — so anyone holding that inbox, or a live session on
// an unlocked device, can publish in their name.
//
// This is the DETECTION half of the answer to that. It cannot prevent a
// fraudulent post; it makes one impossible to miss. The author is emailed
// because they are the one person on earth who knows instantly that they
// did not write it, and the admins are emailed because they are the ones
// who can take it down (moderation removal already exists).
//
// Prevention — a second factor, a freshness requirement on the publish
// action — is deliberately NOT here. Both are more expensive, and neither
// helps at all against a compromised inbox, which this does.
//
// Fire-and-forget by design: a receipt that fails must never fail the
// publish. See handleCreateAnnouncement.

import { sendEmail } from "../../utils/email.js";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AnnouncementReceiptInput {
  title: string;
  /** The office or role stamped on the post — "Board of Supervisors", "Admin". */
  authorLabel: string;
  /** Resolved display name of the poster, when known. */
  authorName: string | null;
  /** ISO timestamp of publication. */
  postedAt: string;
  /** Public URL of the announcement. */
  publicUrl: string;
  /** Display name of the hub, for the subject line. */
  hubLabel: string;
}

/**
 * Build the receipt. Pure — no I/O, no env reads — so the copy that
 * carries the security instruction is unit-testable.
 *
 * The subject leads with the fact rather than the title, because the
 * whole point is that it is legible in a notification preview by someone
 * who was not expecting it.
 */
export function formatAnnouncementReceipt(
  input: AnnouncementReceiptInput,
): { subject: string; html: string; text: string } {
  const who = input.authorName
    ? `${input.authorName} (${input.authorLabel})`
    : input.authorLabel;
  const when = formatTimestamp(input.postedAt);
  const subject = `Announcement published as ${input.authorLabel} — ${input.hubLabel}`;

  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#15294c;">
  <p style="margin:0 0 16px;">An announcement was just published on ${esc(input.hubLabel)}.</p>
  <table style="border-collapse:collapse;margin:0 0 16px;">
    <tr><td style="padding:2px 12px 2px 0;color:#5a6b85;">Title</td><td style="padding:2px 0;"><strong>${esc(input.title)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#5a6b85;">Posted as</td><td style="padding:2px 0;">${esc(who)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#5a6b85;">When</td><td style="padding:2px 0;">${esc(when)}</td></tr>
  </table>
  <p style="margin:0 0 16px;"><a href="${esc(input.publicUrl)}" style="color:#2a4e84;">View the announcement</a></p>
  <p style="margin:0;padding:12px 14px;background:#f4e1d2;color:#8c4a2b;border-radius:4px;">
    <strong>If you did not post this</strong>, your account may be compromised. Reply to
    this email or contact a hub administrator right away — an admin can remove the
    announcement, and it should be treated as urgent.
  </p>
</div>`.trim();

  const text = [
    `An announcement was just published on ${input.hubLabel}.`,
    ``,
    `Title:     ${input.title}`,
    `Posted as: ${who}`,
    `When:      ${when}`,
    ``,
    input.publicUrl,
    ``,
    `If you did not post this, your account may be compromised. Reply to this`,
    `email or contact a hub administrator right away — an admin can remove the`,
    `announcement, and it should be treated as urgent.`,
  ].join("\n");

  return { subject, html, text };
}

/** Readable UTC stamp — recipients are in one county, but the server is not. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toUTCString().replace(/ GMT$/, "")} UTC`;
}

/**
 * Who gets the receipt: the author first, then every configured admin.
 *
 * Deduped case-insensitively so an admin who posts under their own office
 * receives ONE email, not two. Author first so the ordering reflects who
 * the message is actually addressed to. Returns [] when there is nobody
 * to tell — a hub with no admins configured and an author whose email we
 * could not resolve.
 *
 * Pure and exported for tests: the dedupe is the part that would
 * otherwise quietly double-send on every post an admin-official makes.
 */
export function receiptRecipients(
  authorEmail: string | null | undefined,
  adminEmailsRaw: string | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  };
  if (authorEmail) push(authorEmail);
  for (const part of (adminEmailsRaw ?? "").split(",")) push(part);
  return out;
}

/**
 * Send the receipt to everyone who should see it.
 *
 * Never throws: a delivery failure is logged and swallowed. This runs
 * after the announcement is already persisted and published, so throwing
 * would report a failure for work that succeeded.
 */
export async function sendAnnouncementReceipt(
  input: AnnouncementReceiptInput,
  authorEmail: string | null | undefined,
): Promise<void> {
  const recipients = receiptRecipients(authorEmail, process.env.CIVIC_ADMIN_EMAILS);
  if (recipients.length === 0) {
    console.warn(
      "[announcement] no receipt recipients (no author email, no CIVIC_ADMIN_EMAILS) — receipt skipped",
    );
    return;
  }
  const { subject, html, text } = formatAnnouncementReceipt(input);
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html, text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[announcement] receipt to ${to} failed: ${message}`);
    }
  }
}
