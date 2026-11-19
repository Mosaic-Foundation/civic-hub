// The Feedback plugin's service (a kernel module until kernel step 4,
// 2026-11-19): persistence, operator notification, admin read. Its table is
// the plugin's own (./store.ts); Civic.Social's copy of a Bug or Idea goes
// through the kernel's provider inbox (SDK `providerInbox`).
//
// submitFeedback() writes a row to feedback_submissions. Whether it also
// emails the operator immediately depends on the category — see
// IMMEDIATE_EMAIL_CATEGORIES below. Email failure is non-fatal: we still
// return the persisted row so the user gets a confirmation while the
// operator picks the submission up in the admin panel.
//
// listFeedback() is the admin read path (/admin/feedback). It is the only
// reader: feedback never flows through emitEvent() and is never public.

import {
  asEmailList,
  ConflictError,
  currentHubId,
  hubDisplayNameSync,
  NotFoundError,
  normalizePagePath,
  offices,
  providerInbox,
  reportError,
  sendEmail,
  unsentReason,
  settingsOf,
  ValidationError,
  generateId,
  type ProviderOrigin,
} from "../../src/sdk/index.js";
import type { FeedbackStore } from "./store.js";
import {
  FEEDBACK_CATEGORIES,
  SOFTWARE_STREAM,
  type MosaicCopy,
  type MosaicHubStream,
  type FeedbackCategory,
  type FeedbackSubmission,
  type SubmitFeedbackInput,
} from "./models.js";

export { normalizePagePath };

const MESSAGE_MAX_LEN = 4000;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const NAME_MAX_LEN = 200;
const EMAIL_MAX_LEN = 320;
const UA_MAX_LEN = 500;

/**
 * Categories that still trigger an immediate, per-submission email.
 *
 * Only moderation. A moderation flag is someone reporting content they
 * think shouldn't be up — latency there has a cost, so it keeps the push.
 * Everything else (idea, topic, bug, general) is not time-sensitive: it
 * lands in /admin/feedback and is summarised once a day by the admin
 * digest. That is deliberate — a per-submission email for every idea and
 * topic suggestion turns the inbox into the archive, which is exactly the
 * thing the admin panel replaces.
 *
 * To go back to emailing on every submission, add the other categories
 * here; to go fully silent, empty the set. Nothing else needs to change.
 */
const IMMEDIATE_EMAIL_CATEGORIES: ReadonlySet<FeedbackCategory> = new Set([
  "moderation",
]);

/** Whether a category still pages the operator the moment it arrives. */
export function sendsImmediateEmail(category: FeedbackCategory): boolean {
  return IMMEDIATE_EMAIL_CATEGORIES.has(category);
}

export class FeedbackValidationError extends ValidationError {}

function isValidCategory(value: unknown): value is FeedbackCategory {
  return (
    typeof value === "string" &&
    FEEDBACK_CATEGORIES.includes(value as FeedbackCategory)
  );
}

function rowToSubmission(row: Record<string, unknown>): FeedbackSubmission {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    category: row.category as FeedbackCategory,
    message: String(row.message),
    name: row.name ? String(row.name) : null,
    email: row.email ? String(row.email) : null,
    user_id: row.user_id ? String(row.user_id) : null,
    user_agent: row.user_agent ? String(row.user_agent) : null,
    screenshot_url: row.screenshot_url ? String(row.screenshot_url) : null,
    page_path: row.page_path ? String(row.page_path) : null,
    software_version: row.software_version ? String(row.software_version) : null,
    contact_ok: row.contact_ok === true,
    mosaic: row.mosaic_item_id
      ? {
          stream: row.mosaic_stream as MosaicHubStream,
          status: (row.mosaic_status ?? "received") as MosaicCopy["status"],
          sent_at: String(row.mosaic_sent_at ?? row.created_at),
          sent_by: (row.mosaic_sent_by ?? "sender") as MosaicCopy["sent_by"],
        }
      : null,
  };
}

/** Screenshot URLs may only be https, short, and — since the upload route
 *  is signed-in only — only accompany an attributed submission. Anything
 *  else is refused rather than silently dropped, so the form can say why. */
export const SCREENSHOT_URL_MAX_LEN = 2000;
export function normalizeScreenshotUrl(
  raw: unknown,
  userId: string | null | undefined,
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new FeedbackValidationError("screenshot_url must be a string");
  }
  const url = raw.trim();
  if (!url) return null;
  if (!userId) {
    throw new FeedbackValidationError("Sign in to attach a screenshot.");
  }
  if (url.length > SCREENSHOT_URL_MAX_LEN || !/^https:\/\/[^\s]+$/i.test(url)) {
    throw new FeedbackValidationError("screenshot_url must be an https URL");
  }
  return url;
}

export async function submitFeedback(
  store: FeedbackStore,
  input: SubmitFeedbackInput,
): Promise<FeedbackSubmission> {
  if (!isValidCategory(input.category)) {
    throw new FeedbackValidationError(
      `category must be one of: ${FEEDBACK_CATEGORIES.join(", ")}`,
    );
  }
  const message = (input.message ?? "").trim();
  if (!message) {
    throw new FeedbackValidationError("message is required");
  }
  if (message.length > MESSAGE_MAX_LEN) {
    throw new FeedbackValidationError(
      `message must be ${MESSAGE_MAX_LEN} characters or fewer`,
    );
  }

  const name = input.name?.trim() ? input.name.trim().slice(0, NAME_MAX_LEN) : null;
  const email = input.email?.trim()
    ? input.email.trim().toLowerCase().slice(0, EMAIL_MAX_LEN)
    : null;
  const userAgent = input.user_agent?.trim()
    ? input.user_agent.trim().slice(0, UA_MAX_LEN)
    : null;

  const screenshotUrl = normalizeScreenshotUrl(input.screenshot_url, input.user_id);

  const row = {
    id: generateId("fb"),
    category: input.category,
    message,
    name,
    email,
    user_id: input.user_id ?? null,
    user_agent: userAgent,
    screenshot_url: screenshotUrl,
    page_path: normalizePagePath(input.page_path),
    software_version: providerInbox.softwareVersion(),
    // Consent only means something with an address to share.
    contact_ok: input.contact_ok === true && email !== null,
  };

  const data = await store.insertSubmission(row);

  let submission = rowToSubmission(data);

  // Bug and Idea are about how the site works: Civic.Social gets a copy
  // (the form told the sender so). Best-effort: the hub has the item either
  // way, and an admin can still send it with "Send to Civic.Social".
  const stream = SOFTWARE_STREAM[submission.category];
  if (stream) {
    try {
      submission = await shareWithMosaic(store, submission, stream, "resident", "sender");
    } catch (err) {
      reportError("feedback.mosaic_copy", "Civic.Social copy failed; the hub has the item", {
        hub: currentHubId(),
        id: submission.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Operator notification, for the categories that still get one. When it
  // does send it MUST be awaited: on serverless (Vercel) the function is
  // frozen the moment the HTTP response is flushed, so a fire-and-forget
  // send is killed mid-request and the email silently never goes out
  // (submission still persists — which is exactly the "saved but no email"
  // symptom this fixes). Still best-effort: a send failure is caught and
  // logged, never thrown, so the already-persisted submission is reported
  // as success.
  if (sendsImmediateEmail(submission.category)) {
    await notifyOperator(submission).catch((err) => {
      console.warn(
        `[feedback] Operator notification failed for ${submission.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  } else {
    console.log(
      `[feedback] ${submission.id} (${submission.category}) saved for the admin panel; no immediate email by policy.`,
    );
  }

  return submission;
}

/** Write Civic.Social's copy of a hub item and record it on the hub's row. */
async function shareWithMosaic(
  store: FeedbackStore,
  s: FeedbackSubmission,
  stream: MosaicHubStream,
  origin: ProviderOrigin,
  sentBy: MosaicCopy["sent_by"],
): Promise<FeedbackSubmission> {
  const copy = await providerInbox.send({
    sourceFeedbackId: s.id,
    stream,
    origin,
    message: s.message,
    pagePath: s.page_path,
    userAgent: s.user_agent,
    softwareVersion: s.software_version,
    screenshotUrl: s.screenshot_url,
    // A forwarded item never carries the address: the sender agreed to the
    // hub, not to Civic.Social.
    contactOk: sentBy === "sender" && s.contact_ok,
    contactEmail: sentBy === "sender" && s.contact_ok ? s.email : null,
  });
  const updated = await store.recordMosaicCopy(s.id, {
    mosaic_item_id: copy.id,
    mosaic_stream: stream,
    mosaic_status: copy.status,
    mosaic_sent_at: new Date().toISOString(),
    mosaic_sent_by: sentBy,
  });
  return rowToSubmission(updated);
}

/**
 * "Send to Civic.Social": an admin forwards an item, usually a misfiled one,
 * to a stream they choose. Once per item; the sender's address never goes.
 */
export async function forwardToMosaic(
  store: FeedbackStore,
  id: string,
  stream: MosaicHubStream,
): Promise<FeedbackSubmission> {
  if (stream !== "bug" && stream !== "feature") {
    throw new FeedbackValidationError("stream must be bug or feature");
  }
  const row = await store.findSubmission(id);
  if (!row) throw new NotFoundError("No such feedback item.");
  const s = rowToSubmission(row);
  if (s.mosaic) throw new ConflictError("This item was already sent to Civic.Social.");
  return shareWithMosaic(store, s, stream, "forwarded", "admin");
}

export interface ListFeedbackOptions {
  /** Restrict to one category. Omit for everything. */
  category?: FeedbackCategory;
  /** Only submissions created at or after this ISO timestamp. */
  since?: string;
  /** Newest-first cap. Defaults to 200, hard-capped at 500. */
  limit?: number;
}

/**
 * Read feedback, newest first. Admin-only at every call site — the rows
 * carry name/email, and the table is RLS deny-all with service-role
 * bypass, so this function and the /admin route in front of it are the
 * entire exposure surface.
 *
 * Filtering is server-side on an indexed column
 * (feedback_submissions_category_idx) rather than in the page, so the
 * digest can ask for one category without pulling the table.
 */
export async function listFeedback(
  store: FeedbackStore,
  options: ListFeedbackOptions = {},
): Promise<FeedbackSubmission[]> {
  if (options.category !== undefined && !isValidCategory(options.category)) {
    throw new FeedbackValidationError(
      `category must be one of: ${FEEDBACK_CATEGORIES.join(", ")}`,
    );
  }
  const limit = Math.min(
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIST_LIMIT)),
    MAX_LIST_LIMIT,
  );

  const data = await store.listSubmissions({
    limit,
    category: options.category,
    since: options.since,
  });
  return data.map((row) => rowToSubmission(row as Record<string, unknown>));
}

/**
 * Who hears about new feedback on this hub: its configured feedback recipient
 * (the first of `plugin.feedback.recipients`, as before), else everyone on its
 * admin roster (`people.admin_emails`).
 *
 * The fallback used to be one person's address, hardcoded — so every hub on
 * the deployment that had not set a recipient mailed its residents' feedback
 * to the same individual, who runs none of them. Found in the Phase 1 part
 * five review; fixed in Phase 2a. With neither set, nobody is mailed.
 */
export function feedbackRecipients(
  configured: readonly string[],
  admins: readonly string[],
): string[] {
  if (configured.length > 0) return [configured[0]];
  return [...new Set(admins)];
}

async function notifyOperator(s: FeedbackSubmission): Promise<void> {
  const recipients = feedbackRecipients(
    asEmailList(settingsOf("feedback").get("recipients")),
    offices.adminEmails(),
  );
  if (recipients.length === 0) {
    console.warn(
      `[feedback] ${s.id} stored, but this hub has no feedback recipient and no admins to notify`,
    );
    return;
  }
  const subject = `[${hubDisplayNameSync()} feedback] ${s.category} — ${s.message.slice(0, 60)}`;
  const html = renderOperatorEmail(s);
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html });
    if (result.sent) {
      console.log(
        `[feedback] Operator notified for ${s.id} (resend id: ${result.id ?? "?"})`,
      );
    } else {
      console.warn(
        `[feedback] Operator email NOT sent for ${s.id}: ${unsentReason(result)}`,
      );
    }
  }
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

function renderOperatorEmail(s: FeedbackSubmission): string {
  const messageHtml = escapeHtml(s.message).replace(/\n/g, "<br>");
  const fromLabel =
    s.name && s.email
      ? `${escapeHtml(s.name)} &lt;${escapeHtml(s.email)}&gt;`
      : s.email
        ? escapeHtml(s.email)
        : s.name
          ? escapeHtml(s.name)
          : "Anonymous";
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;">New feedback on ${escapeHtml(hubDisplayNameSync())}: ${escapeHtml(s.category)}</h1>
      <p style="margin:0 0 4px;color:#374151;"><strong>From:</strong> ${fromLabel}</p>
      <p style="margin:12px 0 4px;color:#374151;"><strong>Submitted:</strong> ${escapeHtml(formatDateUS(s.created_at))}</p>
      ${s.screenshot_url ? `<p style="margin:4px 0;color:#374151;"><strong>Screenshot:</strong> <a href="${escapeHtml(s.screenshot_url)}">${escapeHtml(s.screenshot_url)}</a></p>` : ""}
      <div style="margin:16px 0 0;padding:14px 18px;background:#f3f4f6;border-radius:8px;line-height:1.5;font-size:14px;">${messageHtml}</div>
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">
        Submission id: <code>${escapeHtml(s.id)}</code>
      </p>
    </div>
  `;
}
