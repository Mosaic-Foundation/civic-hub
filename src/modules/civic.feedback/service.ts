// civic.feedback service — persistence, operator notification, admin read.
//
// submitFeedback() writes a row to feedback_submissions. Whether it also
// emails the operator immediately depends on the category — see
// IMMEDIATE_EMAIL_CATEGORIES below. Email failure is non-fatal: we still
// return the persisted row so the user gets a confirmation while the
// operator picks the submission up in the admin panel.
//
// listFeedback() is the admin read path (/admin/feedback). It is the only
// reader: feedback never flows through emitEvent() and is never public.

import { getDb } from "../../db/client.js";
import { sendEmail } from "../../utils/email.js";
import { generateId } from "../../utils/id.js";
import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackSubmission,
  type SubmitFeedbackInput,
} from "./models.js";

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

export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

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
  };
}

export async function submitFeedback(
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

  const row = {
    id: generateId("fb"),
    category: input.category,
    message,
    name,
    email,
    user_id: input.user_id ?? null,
    user_agent: userAgent,
  };

  const { data, error } = await getDb()
    .from("feedback_submissions")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`feedback: ${error.message}`);
  }
  const submission = rowToSubmission(data);

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

  let query = getDb()
    .from("feedback_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.category) query = query.eq("category", options.category);
  if (options.since) query = query.gte("created_at", options.since);

  const { data, error } = await query;
  if (error) {
    throw new Error(`feedback: ${error.message}`);
  }
  return (data ?? []).map((row) => rowToSubmission(row as Record<string, unknown>));
}

async function notifyOperator(s: FeedbackSubmission): Promise<void> {
  const recipient =
    process.env.FEEDBACK_RECIPIENT_EMAIL?.trim() || "adam@civic.social";
  const subject = `[Civic Hub feedback] ${s.category} — ${s.message.slice(0, 60)}`;
  const html = renderOperatorEmail(s);
  const result = await sendEmail({ to: recipient, subject, html });
  if (result.sent) {
    console.log(
      `[feedback] Operator notified for ${s.id} (resend id: ${result.id ?? "?"})`,
    );
  } else {
    console.warn(
      `[feedback] Operator email NOT sent for ${s.id}: ${result.error ?? "unknown"}`,
    );
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
      <h1 style="font-size:18px;font-weight:600;margin:0 0 12px;">New Civic Hub feedback — ${escapeHtml(s.category)}</h1>
      <p style="margin:0 0 4px;color:#374151;"><strong>From:</strong> ${fromLabel}</p>
      <p style="margin:12px 0 4px;color:#374151;"><strong>Submitted:</strong> ${escapeHtml(formatDateUS(s.created_at))}</p>
      <div style="margin:16px 0 0;padding:14px 18px;background:#f3f4f6;border-radius:8px;line-height:1.5;font-size:14px;">${messageHtml}</div>
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">
        Submission id: <code>${escapeHtml(s.id)}</code>
      </p>
    </div>
  `;
}
