// The Admin digest: the daily email that tells a space's admins what is new
// in their queues (a kernel module until kernel step 4, 2026-11-19: "if it can
// be a plugin, it is one"; a space with no admins leaves it off). What is new
// is the kernel's count (SDK `adminWindow`); this plugin keeps where the last
// email that went out covered up to (./store.ts), renders the email and sends
// it.
//
// THE RULE (leaving-demo slice, 2026-10-15): each email covers only what is
// new since the last one, across everything an admin reviews, and never
// repeats an item. How it holds:
//   - The window runs from the mark the last digest that went out left
//     (admin_digest_marks.covered_until) to the moment this run started. The
//     first run on a hub looks back one day.
//   - The kernel counts every category by a time that never changes once
//     written, so an item falls in exactly one window.
//   - The run claims its window before counting, with a compare-and-set on the
//     mark, so two runs at once (the cron and a manual run) can't both send
//     it. If nothing could be delivered, the claim is given back.
//
// Nothing is sent when nothing is new; waiting alone never sends.

import { adminWindow, sendEmail, type AdminWindow, type DigestLine } from "../../src/sdk/index.js";
import type { MarkStore } from "./store.js";

/** What one email reports: the kernel's window (it carries the space's name). */
export type AdminDigestPayload = AdminWindow;
export type { DigestLine };

/** A hub's first digest looks back this far. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

// --- Rendering ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function noun(line: DigestLine, n: number): string {
  return n === 1 ? line.noun.one : line.noun.many;
}

/** "3 new process reviews (8 waiting, 1 flagged by the Code of Conduct check)". Pure. */
export function digestLineText(line: DigestLine): string {
  const head = line.new_count > 0 ? `${line.new_count} new ${noun(line, line.new_count)}` : `No new ${line.noun.many}`;
  const extra: string[] = [];
  if (line.waiting !== null) extra.push(`${line.waiting} waiting`);
  if (line.flagged > 0) extra.push(`${line.flagged} flagged by ${line.flagged_by ?? "a check"}`);
  return extra.length > 0 ? `${head} (${extra.join(", ")})` : head;
}

/** The lines an email shows: anything new, and any queue with something waiting. */
export function shownLines(p: AdminDigestPayload): DigestLine[] {
  return p.lines.filter((l) => l.new_count > 0 || (l.waiting ?? 0) > 0);
}

/** A line's items, each with a link to where it is dealt with. */
function detailsHtml(l: DigestLine): string {
  if (!l.details || l.details.length === 0) return "";
  const items = l.details
    .map(
      (d) =>
        `<li style="margin:6px 0 0;line-height:1.4;">${escapeHtml(d.text)} <a href="${escapeHtml(d.url)}" style="color:#1e3a5f;">Open it</a></li>`,
    )
    .join("");
  return `<ul style="list-style:circle;padding-left:18px;margin:4px 0 0;font-size:14px;color:#374151;">${items}</ul>`;
}

export function renderAdminDigestEmail(p: AdminDigestPayload): { subject: string; html: string; text: string } {
  const newParts = p.lines.filter((l) => l.new_count > 0).map((l) => `${l.new_count} ${noun(l, l.new_count)}`);
  const subject =
    p.new_total > 0 ? `[${p.hub_name}] ${p.new_total} new for admins: ${newParts.join(", ")}` : `[${p.hub_name}] Last month's activity`;
  const notes = p.notes ?? [];
  const lines = shownLines(p);
  const items = lines
    .map(
      (l) =>
        `<li style="margin:0 0 10px;line-height:1.4;"><a href="${escapeHtml(l.url)}" style="color:#1e3a5f;${
          l.new_count > 0 ? "font-weight:600;" : ""
        }">${escapeHtml(digestLineText(l))}</a>${detailsHtml(l)}</li>`,
    )
    .join("");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#1e3a5f;">${escapeHtml(p.hub_name)}: what's new for admins</h1>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Since the last one of these emails. Each line opens its list on the hub.</p>
      <ul style="list-style:disc;padding-left:20px;margin:0;font-size:15px;">${items}</ul>
      ${notes.map((n) => `<p style="margin:20px 0 0;font-size:15px;line-height:1.5;">${escapeHtml(n)}</p>`).join("")}
      <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;">
        You receive this because you are an admin of ${escapeHtml(p.hub_name)}. It counts only what arrived since the last
        one, and nothing is sent when nothing is new. Whether it is sent at all is under Hub settings → Plugins.
      </p>
    </div>
  `;
  const text = [
    `${p.hub_name}: what's new for admins (since the last one of these emails)`,
    "",
    ...lines.flatMap((l) => [
      `- ${digestLineText(l)}`,
      `  ${l.url}`,
      ...(l.details ?? []).flatMap((d) => [`    * ${d.text}`, `      ${d.url}`]),
    ]),
    ...notes.flatMap((n) => ["", n]),
    "",
    `You receive this because you are an admin of ${p.hub_name}. It counts only what arrived since the last one, and nothing is sent when nothing is new.`,
  ].join("\n");
  return { subject, html, text };
}

// --- Dispatch -----------------------------------------------------------------

export interface AdminDigestRunResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Nothing new: no email. */
  empty: boolean;
  /** Another run had already covered this window. */
  already_covered?: boolean;
  since: string;
  until: string;
  /** New and waiting per category, for the run log and tests. */
  counts: Record<string, { new: number; waiting: number | null; flagged: number }>;
}

/** Keyless local development "sends" by logging; that counts as delivered for the mark. */
const KEYLESS = "RESEND_API_KEY is not configured";

export async function runAdminDigest(marks: MarkStore, recipients: string[], now: Date = new Date()): Promise<AdminDigestRunResult> {
  const { readMark, moveMark, releaseMark } = marks;
  const until = now.toISOString();
  const previous = await readMark();
  const since = previous ?? new Date(now.getTime() - FIRST_WINDOW_MS).toISOString();
  const base = { total: recipients.length, sent: 0, skipped: 0, failed: 0, since, until, counts: {} };

  if (previous !== null && Date.parse(previous) >= now.getTime()) {
    return { ...base, skipped: recipients.length, empty: true, already_covered: true };
  }
  if (!(await moveMark(previous, until))) {
    return { ...base, skipped: recipients.length, empty: true, already_covered: true };
  }

  let payload: AdminDigestPayload;
  try {
    payload = await adminWindow(since, until);
  } catch (err) {
    await releaseMark(until, previous);
    throw err;
  }
  const counts = Object.fromEntries(
    payload.lines.map((l) => [l.id, { new: l.new_count, waiting: l.waiting, flagged: l.flagged }]),
  );

  if (payload.empty) {
    console.log(`[admin-digest] Nothing new since ${since} — no email (${recipients.length} recipient(s)).`);
    return { ...base, skipped: recipients.length, empty: true, counts };
  }
  if (recipients.length === 0) {
    console.warn("[admin-digest] No admins to send to; the window stays open for the next run.");
    await releaseMark(until, previous);
    return { ...base, empty: false, counts };
  }

  const { subject, html, text } = renderAdminDigestEmail(payload);
  let sent = 0;
  let failed = 0;
  let delivered = 0;
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html, text });
    if (result.sent) {
      sent += 1;
      delivered += 1;
      console.log(`[admin-digest] Sent to ${to} (resend id: ${result.id ?? "?"})`);
    } else if (result.error === KEYLESS) {
      delivered += 1;
      console.log(`---- [admin-digest] RESEND_API_KEY unset — logging email ----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---- end ----`);
    } else {
      failed += 1;
      console.warn(`[admin-digest] Send failed for ${to}: ${result.error ?? result.held_back_reason ?? "unknown"}`);
    }
  }
  // Nobody got it: the next run covers this window again rather than losing it.
  if (delivered === 0) await releaseMark(until, previous);
  return { ...base, sent, failed, empty: false, counts };
}
