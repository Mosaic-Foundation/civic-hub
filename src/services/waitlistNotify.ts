// Waitlist signup notification — best-effort operator email.
//
// Mirrors the pattern civic.feedback's notifyOperator and the meeting-summary
// cron's notifyCronOutcome already use: send through the shared Resend helper,
// address every admin in CIVIC_ADMIN_EMAILS, and treat a failed send as a log
// line, never an error. The signup is already persisted by the time we get
// here — a bounced notification must not turn a successful signup into a 500
// for the person who just filled in the form.

import { sendEmail } from "../utils/email.js";

export interface WaitlistSignup {
  email: string;
  /** Optional — the form never requires it. */
  name: string | null;
  notes: string | null;
  /** The "I'd like to be a test user" checkbox on the waitlist form. */
  wants_test_user: boolean;
  created_at: string;
}

/** Admins in CIVIC_ADMIN_EMAILS — same parse the cron alerts use. */
function adminRecipients(): string[] {
  return (process.env.CIVIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateUS(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

/**
 * Subject + body for a signup notification. Pure — the test-user opt-in has
 * to be readable from the subject line alone, because that is the only part
 * of this email that gets read on a phone lock screen.
 */
export function renderWaitlistNotification(signup: WaitlistSignup): {
  subject: string;
  html: string;
} {
  // Name first when we have one — "TEST USER — Dana Reed" reads as a person,
  // "TEST USER — d.reed+beta@example.com" reads as a row.
  const who = signup.name ? `${signup.name} <${signup.email}>` : signup.email;
  const subject = signup.wants_test_user
    ? `[Civic Hub waitlist] TEST USER — ${who}`
    : `[Civic Hub waitlist] ${who}`;

  const testUserRow = signup.wants_test_user
    ? `<p style="margin:12px 0;padding:12px 14px;background:#ecfdf5;border-left:3px solid #059669;border-radius:6px;font-size:14px;">
         <strong>Wants to be a test user.</strong> They asked to be approved onto the beta allowlist.
       </p>`
    : `<p style="margin:12px 0 4px;color:#6b7280;font-size:14px;">Did not opt in as a test user.</p>`;

  const notesHtml = signup.notes
    ? `<div style="margin:16px 0 0;padding:14px 18px;background:#f3f4f6;border-radius:8px;line-height:1.5;font-size:14px;">${escapeHtml(
        signup.notes,
      ).replace(/\n/g, "<br>")}</div>`
    : `<p style="margin:16px 0 0;color:#6b7280;font-size:14px;">No notes left.</p>`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;">New Civic Hub waitlist signup</h1>
      ${
        signup.name
          ? `<p style="margin:0 0 4px;color:#374151;"><strong>Name:</strong> ${escapeHtml(signup.name)}</p>`
          : ""
      }
      <p style="margin:0 0 4px;color:#374151;"><strong>Email:</strong> ${escapeHtml(signup.email)}</p>
      <p style="margin:0 0 4px;color:#374151;"><strong>Signed up:</strong> ${escapeHtml(formatDateUS(signup.created_at))}</p>
      ${testUserRow}
      ${notesHtml}
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">
        Approve testers by adding them to the beta allowlist in Admin → Settings.
      </p>
    </div>
  `;

  return { subject, html };
}

/**
 * Email every admin about a new signup. Best-effort and non-fatal: callers
 * should await it (serverless freezes the function the moment the response is
 * flushed, so fire-and-forget silently drops the send) but must not let a
 * rejection escape.
 */
export async function notifyAdminsOfWaitlistSignup(
  signup: WaitlistSignup,
): Promise<void> {
  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.warn(
      `[waitlist] new signup ${signup.email} but CIVIC_ADMIN_EMAILS is empty — nobody was notified.`,
    );
    return;
  }

  const { subject, html } = renderWaitlistNotification(signup);

  for (const to of recipients) {
    try {
      const result = await sendEmail({ to, subject, html });
      if (result.sent) {
        console.log(
          `[waitlist] notified ${to} of ${signup.email} (resend id: ${result.id ?? "?"})`,
        );
      } else {
        console.warn(
          `[waitlist] notification NOT sent to ${to} for ${signup.email}: ${result.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      console.warn(
        `[waitlist] notification email failed for ${to}: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    }
  }
}
