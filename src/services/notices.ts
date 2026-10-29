// notify(): a package tells some of the hub's people about one of its
// processes (Events 2, E2: an event's announcement to the people going, or
// what changed about it). The package names accounts; the hub holds the
// addresses and never hands one out. Each person gets their own message,
// through the mail adapter and the hub's mode guard (src/utils/email.ts), so
// nobody sees another's address and a demo or beta hub reaches only whom it
// may.
//
// Whom it skips: accounts that are not this hub's, people with no verified
// address, and people who turned notices off (`notices_email` false:
// Settings' "Notices about things I take part in", or a notice's own
// one-click link; design pass, decision 15, 2026-10-29). Unsubscribing from
// the digest no longer stops a notice that an event someone is going to was
// cancelled. The message is about one process of the package's type,
// and links to that process's page: the hub builds the link, so a package can
// link nowhere else. The type's grant must name `mail` (and the hub's
// approved grant too): the Plugins page then says it sends email.

import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { inChunks } from "../db/inChunks.js";
import { sendEmail } from "../utils/email.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";
import { env } from "../config/env.js";
import { buildUnsubscribeUrl } from "../modules/civic.digest/index.js";
import { hubDisplayNameSync } from "./hubSettings.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { processHeads } from "./processRows.js";
import { processDetailPath } from "../processes/registry.js";
import { grantOfType, refuseReach, typeMayUseAdapter } from "../plugins/grant.js";

export interface Notice {
  /** The subject line, without the hub's name (the hub adds it). */
  subject: string;
  /** The message, plain text. */
  text: string;
}

export interface NoticeReport {
  /** Delivered, or logged where the deployment has no mail transport (local). */
  sent: number;
  /** Held back by the hub's mode (demo, beta): on purpose, not a failure. */
  held_back: number;
  /** Not this hub's, no verified address, or unsubscribed from the hub's email. */
  skipped: number;
  /** The transport refused it. */
  failed: number;
}

const SUBJECT_MAX = 150;
const TEXT_MAX = 5000;
/** Messages in flight at once. */
const PARALLEL = 5;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Tell each of `accounts` (this hub's people) about the process `processId`. */
export async function notify(processId: string, accounts: readonly string[], notice: Notice): Promise<NoticeReport> {
  const subject = notice.subject.trim();
  const text = notice.text.trim();
  if (!subject || subject.length > SUBJECT_MAX) throw new ValidationError(`A notice needs a subject of at most ${SUBJECT_MAX} characters.`);
  if (!text || text.length > TEXT_MAX) throw new ValidationError(`A notice needs a message of at most ${TEXT_MAX} characters.`);
  const [process] = await processHeads([processId]);
  if (!process) throw new NotFoundError("That process is not on this hub.");
  if (!typeMayUseAdapter(process.type, "mail")) {
    refuseReach(grantOfType(process.type)?.packageName ?? process.type, "adapter", "mail (notify)");
  }

  const ids = [...new Set(accounts)];
  const report: NoticeReport = { sent: 0, held_back: 0, skipped: 0, failed: 0 };
  if (ids.length === 0) return report;

  type Person = { id: string; email: string | null; email_verified: boolean | null; notices_email: boolean | null };
  const db = forHub(currentHubId());
  const people = await inChunks(ids, (chunk) =>
    db.from("users").select<Person>("id, email, email_verified, notices_email").in("id", chunk),
  );
  const reachable = people.filter((p) => p.email && p.email_verified && p.notices_email !== false);
  report.skipped = ids.length - reachable.length;

  const base = uiBaseUrl();
  const link = `${base}${processDetailPath(process.type, process.id)}`;
  const settings = `${base}/settings`;
  const hub = hubDisplayNameSync();
  const fullSubject = `${hub}: ${subject}`;
  // Each person's own one-click link stops notices only; without the signing
  // secret (a local hub), the settings page does it.
  const secret = env.DIGEST_UNSUBSCRIBE_SECRET;
  const stopLink = (userId: string) =>
    secret && secret.length >= 16
      ? buildUnsubscribeUrl({ userId, apiBaseUrl: baseUrl(), secret, purpose: "unsub_notices" })
      : `${settings}#notices`;
  const message = (userId: string) => {
    const stop = stopLink(userId);
    const footer =
      `You get this because of what you did on ${hub}. To stop notices like this one, ` +
      `turn them off: ${stop} (the digest is a setting of its own: ${settings})`;
    return {
      text: `${text}\n\n${link}\n\n${footer}`,
      html:
        `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>` +
        `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
        `<p style="color:#666;font-size:13px">You get this because of what you did on ${escapeHtml(hub)}. ` +
        `<a href="${escapeHtml(stop)}">Stop notices like this one</a>. ` +
        `The digest is a setting of its own, in <a href="${escapeHtml(settings)}">your settings</a>.</p>`,
    };
  };

  for (let i = 0; i < reachable.length; i += PARALLEL) {
    await Promise.all(
      reachable.slice(i, i + PARALLEL).map(async (p) => {
        const body = message(p.id);
        const r = await sendEmail({ to: p.email!, subject: fullSubject, html: body.html, text: body.text });
        if (r.sent) report.sent += 1;
        else if (r.held_back) report.held_back += 1;
        else if (r.error && /not configured/i.test(r.error)) {
          // A deployment with no transport (local): logged, as every other mail is.
          console.log(`[notify] (no mail transport) "${fullSubject}" to ${p.email}`);
          report.sent += 1;
        } else report.failed += 1;
      }),
    );
  }
  return report;
}
