// The meeting-summary job's alert email to a hub's admins.
//
// When: after each run of the "meeting_summary" job (src/jobs/meetingSummary.ts),
// and when a run aborts. Why: cronAlertReason names the reasons a run deserves
// attention even when it exited cleanly (a summary failed, one is held for
// review with a quality flag, a meeting has waited past its grace period, a
// revision is unreviewed, a summary predates its meeting, a published feed
// card no longer resolves); an uneventful run sends nothing. To whom: the hub
// in scope's admins (people.admin_emails, CIVIC_ADMIN_EMAILS as the bootstrap
// for a hub with no row). Best-effort: a bounced notification never fails the
// run.

import { sendEmail } from "../utils/email.js";
import { type BrokenPublication } from "./feedHealth.js";
import { brokenLinkProblem } from "../jobs/describe.js";
import { getAdminEmailsSync, hubDisplayNameSync } from "./hubSettings.js";
import { PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";
import { RECORD_GRACE_DAYS } from "../modules/civic.meeting_summary/index.js";

/**
 * How long a revision may wait for review before the cron mentions it.
 *
 * Long enough not to nag about something queued yesterday, short enough that an
 * improvement does not sit unread for a whole meeting cycle.
 */
export const REVISION_NAG_DAYS = 14;

function adminRecipients(): string[] {
  return getAdminEmailsSync();
}

export interface CronOutcome {
  discovered: number;
  created: number;
  skippedExisting: number;
  failed: number;
  failures: Array<{ source_id: string; error: string }>;
  duration_ms: number;
  connector_id: string;
  /** Published feed cards whose page no longer resolves. */
  brokenLinks?: BrokenPublication[];
  /** Summaries still describing a meeting that had not happened when written. */
  staleSummaries?: Array<{ meeting_date: string; meeting_title: string; generated_at: string }>;
  /** Revisions sitting unreviewed past the nag threshold. */
  staleRevisions?: Array<{ meeting_date: string; meeting_title: string; waiting_days: number }>;
  /**
   * Summaries this run wrote (or revisions it staged) that carry a quality
   * flag — kept, never auto-published, and named here so an admin looks.
   */
  flagged?: FlaggedSummary[];
  /**
   * Meetings with no usable record yet (readiness.ts). Every run retries them;
   * only those past RECORD_GRACE_DAYS count as a problem.
   */
  waiting?: WaitingMeeting[];
  /** The hub's grace (record_grace_days) the run used; RECORD_GRACE_DAYS when unset. */
  graceDays?: number;
  /** Set when the run aborted before finishing (discovery threw, config invalid). */
  fatal?: string;
}

export interface FlaggedSummary {
  process_id: string;
  meeting_date: string;
  meeting_title: string;
  message: string;
}

export interface WaitingMeeting {
  meeting_date: string;
  meeting_title: string;
  reason: string;
  days_since_meeting: number;
}

/** Waiting meetings that have waited longer than anyone should expect. */
export function overdueMeetings(
  waiting: readonly WaitingMeeting[] = [],
  graceDays: number = RECORD_GRACE_DAYS,
): WaitingMeeting[] {
  return waiting.filter((w) => w.days_since_meeting > graceDays);
}

/**
 * Why the run deserves an email, or null when it was genuinely uneventful.
 *
 * THIS IS THE GUARD THAT WAS MISSING. The previous version only notified
 * when `failed > 0`, which made two very different outcomes indistinguishable
 * from success:
 *
 *   1. Discovery returned zero entries. When Floyd County moved its
 *      agendas-and-minutes page to client-side rendering, `fetch()` began
 *      returning a shell with no meeting links in it. Discovery dutifully
 *      reported "0 meetings", the run exited 200 OK with failed=0, and the
 *      pipeline stayed silent for weeks while everyone assumed it was fine.
 *   2. The batch threw outright (bad config, discovery error). The catch
 *      block returned 500 to a cron caller that reads nobody's response.
 *
 * An empty listing USED to be reported as a failure here too, on the theory
 * that a source which stops parsing looks like one with no meetings. Changed
 * 2026-10-07 (review M7, Adam): it alarmed every quiet week and every title
 * filter that matched nothing recent, so admins learned to ignore the job. A
 * run that discovers nothing is "nothing new"; a source that cannot be read
 * throws in discovery, and that run aborts and alerts on its error (`fatal`).
 */
export function cronAlertReason(outcome: CronOutcome): string | null {
  if (outcome.fatal) {
    return `the run aborted: ${outcome.fatal}`;
  }
  if (outcome.failed > 0) {
    return `${outcome.failed} meeting(s) failed to summarize.`;
  }
  if (outcome.flagged && outcome.flagged.length > 0) {
    // The 2026-09-22 case, caught: the summary exists but is missing what it
    // should have. It is held for review; say so rather than let it sit.
    return (
      `${outcome.flagged.length} summary/summaries came out without video timestamps ` +
      `and are held for review: ${outcome.flagged.map((f) => `${f.meeting_date} ${f.meeting_title}`).join("; ")}.`
    );
  }
  const graceDays = outcome.graceDays ?? RECORD_GRACE_DAYS;
  const overdue = overdueMeetings(outcome.waiting, graceDays);
  if (overdue.length > 0) {
    return (
      `${overdue.length} meeting(s) have waited more than ${graceDays} days for a ` +
      `usable record: ${overdue.map((w) => `${w.meeting_date} ${w.meeting_title} (${w.reason})`).join("; ")}.`
    );
  }
  if (outcome.staleRevisions && outcome.staleRevisions.length > 0) {
    // Nothing is broken — the published version is still serving — but an
    // improvement is sitting unread, and silence would let it sit forever.
    return (
      `${outcome.staleRevisions.length} revision(s) have been waiting for review ` +
      `longer than ${REVISION_NAG_DAYS} days. The published summaries are ` +
      `unaffected, but the newer versions are not reaching the public.`
    );
  }
  if (outcome.staleSummaries && outcome.staleSummaries.length > 0) {
    // The Aug 2026 case: a summary written from the agenda three days before
    // the meeting, never revisited once the recording appeared. Every counter
    // read clean because nothing failed — the summary simply described the
    // wrong thing.
    return (
      `${outcome.staleSummaries.length} summary/summaries still describe a meeting ` +
      `that had not happened when they were written, and no newer source was ` +
      `available to replace them.`
    );
  }
  if (outcome.brokenLinks && outcome.brokenLinks.length > 0) {
    // The counters can all read zero while readers get 404s: this run's
    // predecessor unpublished two live pages and reported complete success.
    return (
      `${outcome.brokenLinks.length} item(s) on the feed are announced as ` +
      `published but their page is not public. Readers clicking them get nothing.`
    );
  }
  return null;
}

/**
 * Email admins when a run is worth their attention. Best-effort: a bounced
 * notification must never fail the run itself.
 */
export async function notifyCronOutcome(outcome: CronOutcome): Promise<void> {
  const reason = cronAlertReason(outcome);
  if (!reason) return;

  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.warn(
      `[meeting-summary] would have alerted admins (${reason}) but ` +
        `CIVIC_ADMIN_EMAILS is empty — nobody is watching this cron.`,
    );
    return;
  }

  const headline = outcome.fatal
    ? "failed"
    : outcome.failed > 0
      ? `completed with ${outcome.failed} failure(s)`
      : "needs your attention";

  const subject = `[${hubDisplayNameSync()}] Meeting summaries: ${headline}`;
  const failureLines = outcome.failures
    .map((f) => `<li><code>${f.source_id}</code>: ${f.error}</li>`)
    .join("\n");
  const html = `
    <p>The latest check for new meeting summaries ${headline}.</p>
    <p><strong>Why you're getting this:</strong> ${reason}</p>
    ${failureLines ? `<ul>${failureLines}</ul>` : ""}
    ${
      outcome.staleSummaries && outcome.staleSummaries.length > 0
        ? `<p><strong>Summaries written before their meeting happened</strong> — these describe planned topics, not the meeting:</p><ul>${outcome.staleSummaries
            .map(
              (t) =>
                `<li>${t.meeting_date} — ${t.meeting_title} (written ${t.generated_at.slice(0, 10)})</li>`,
            )
            .join("\n")}</ul>`
        : ""
    }
    ${
      outcome.brokenLinks && outcome.brokenLinks.length > 0
        ? `<p><strong>Broken feed links</strong> — published cards whose page does not open:</p><ul>${outcome.brokenLinks
            .map(
              (b) =>
                `<li>${brokenLinkProblem(b)} <code>${b.process_id}</code>, published ${b.published_at.slice(0, 10)}.</li>`,
            )
            .join("\n")}</ul>`
        : ""
    }
    <p>Connector: <code>${outcome.connector_id}</code><br/>
       Discovered: ${outcome.discovered} |
       Created: ${outcome.created} |
       Skipped existing: ${outcome.skippedExisting} |
       Failed: ${outcome.failed} |
       Duration: ${outcome.duration_ms}ms</p>
    <p>You can check the source address under Hub settings, Plugins, Meeting summaries.
       If it still fails after that, reply to ${PLATFORM_CONTACT_EMAIL}.</p>
  `;

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html });
    } catch (err) {
      console.warn(
        `[meeting-summary] notification email failed for ${to}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}
