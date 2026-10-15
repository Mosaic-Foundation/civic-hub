// Telling the waitlist the hub is open (leaving-demo slice, 2026-10-15).
//
// The waitlist form promises "We'll email you when access opens up". Until
// this, nothing did. On the switch to live, with its box ticked (the default,
// Adam 2026-10-15: these people asked to be told), every waitlist entry not yet
// told gets one short email, and told_open_at records it, so nobody is told
// twice: switching live → beta → live again tells only people who joined in
// between.
//
// Sent with purpose "hub_open" because the request's settings snapshot was read
// before the mode changed, so the mail guard still sees a beta hub (as for
// admin_invite, src/services/mailGuard.ts). The caller sends only after the
// switch to live has been written.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { readAll } from "../db/readAll.js";
import { sendEmail } from "../utils/email.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { hubDisplayNameSync } from "./hubSettings.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email. Pure; tested directly. */
export function renderHubOpenEmail(hubName: string, url: string): { subject: string; html: string; text: string } {
  const subject = `${hubName} is open`;
  const text =
    `You asked to be told when ${hubName} opened. It's open now: anyone can sign in with their email address.\n\n` +
    `${url}\n\n` +
    "You're receiving this one email because you joined the hub's waitlist. You won't get another unless you sign in.";
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;color:#1e3a5f;">${escapeHtml(hubName)} is open</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">You asked to be told when ${escapeHtml(hubName)} opened. It's open now: anyone can sign in with their email address.</p>
      <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Go to ${escapeHtml(hubName)}</a></p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">You're receiving this one email because you joined the hub's waitlist. You won't get another unless you sign in.</p>
    </div>`;
  return { subject, html, text };
}

export interface WaitlistToldResult {
  told: number;
  failed: number;
}

/** Email everyone on the waitlist not yet told, and mark them. Best-effort per address. */
export async function tellWaitlistHubIsOpen(): Promise<WaitlistToldResult> {
  const db = forHub(currentHubId());
  const rows = await readAll((from, to) =>
    db
      .from("waitlist")
      .select<{ email: string }>("email")
      .is("told_open_at", null)
      .order("email", { ascending: true })
      .range(from, to),
  );
  const message = renderHubOpenEmail(hubDisplayNameSync(), uiBaseUrl());
  let told = 0;
  let failed = 0;
  for (const { email } of rows) {
    const result = await sendEmail({ to: email, ...message, purpose: "hub_open" });
    // Keyless local development logs instead of sending; that still counts as
    // told, or a local run would offer to tell the same people forever.
    const keyless = result.error === "RESEND_API_KEY is not configured";
    if (keyless) console.log(`---- [hub-open] RESEND_API_KEY unset — logging email ----\nTo: ${email}\nSubject: ${message.subject}\n\n${message.text}\n---- end ----`);
    if (result.sent || keyless) {
      await db.from("waitlist").update({ told_open_at: new Date().toISOString() }).eq("email", email).is("told_open_at", null);
      told += 1;
    } else {
      failed += 1;
      console.warn(`[waitlist] could not tell ${email} the hub is open: ${result.error ?? result.held_back_reason ?? "unknown"}`);
    }
  }
  return { told, failed };
}
