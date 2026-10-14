import { ForbiddenError, NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { Request, Response } from "express";
import { describeSubmission } from "../processes/registry.js";
import type { SubmissionField } from "../shared/submissionPreview.js";
import { getAuthUser, isAdminEmail } from "../middleware/auth.js";
import {
  reopenForRevision,
  approveReview,
  requestChanges,
  declineReview,
  reviseAndResubmit,
  withdrawReview,
  getReview,
  getReviewTurns,
  listReviews,
  listCreatorReviews,
  countReviewNotifications,
  markReviewsSeen,
} from "../modules/civic.review/index.js";
import { processDetailPath } from "../processes/registry.js";
import { forHub } from "../db/forHub.js";
import { inChunks } from "../db/inChunks.js";
import { currentHubId } from "../config/hubContext.js";

function db() {
  return forHub(currentHubId());
}

/** The process row backing a review (type/title/description only), for list views. */
/**
 * Each review with its process's type and title, read in chunks (one query
 * per 200), not one query per review at once: a long queue made hundreds of
 * simultaneous reads and the list failed ("fetch failed"; Submit and Save,
 * 2026-10-12).
 */
async function withProcessSummaries<R extends { process_id: string }>(
  reviews: R[],
): Promise<Array<R & { process_type: string | null; process_title: string | null }>> {
  const ids = [...new Set(reviews.map((r) => r.process_id))];
  const rows = await inChunks(ids, (chunk) =>
    db().from("processes").select<{ id: string; type: string; title: string }>("id, type, title").in("id", chunk),
  );
  const byId = new Map(rows.map((p) => [p.id, p]));
  return reviews.map((review) => ({
    ...review,
    process_type: byId.get(review.process_id)?.type ?? null,
    process_title: byId.get(review.process_id)?.title ?? null,
  }));
}

/** The full process row backing a review, for detail views. */
async function getProcessRow(processId: string): Promise<Record<string, unknown>> {
  return db().from("processes").select("*").eq("id", processId).single();
}

// --- Notification indicator ---


/** Where this process lives publicly once approved, via the handler's own
 *  detailPath — so My Submissions can offer a share link without the UI
 *  keeping its own copy of the type→route map. Null until there is a
 *  process to point at. */
function detailPathFor(proc: unknown): string | null {
  const row = proc as { type?: string; id?: string } | null;
  if (!row || typeof row.type !== "string" || typeof row.id !== "string") return null;
  return processDetailPath(row.type, row.id);
}

/** The creator's submission as displayable fields, via the registry so a
 *  process type can extend the generic default. Null when the process row
 *  is missing (the review outlived it). */
function submissionFor(proc: unknown): SubmissionField[] | null {
  const row = proc as {
    type?: string; title?: string; description?: string;
    content?: Record<string, unknown> | null; state?: Record<string, unknown> | null;
  } | null;
  if (!row || typeof row.type !== "string") return null;
  return describeSubmission({
    type: row.type,
    title: row.title ?? "",
    description: row.description ?? "",
    content: row.content ?? null,
    state: row.state ?? null,
  });
}

// `?scope=mine` counts only the caller's own submissions, for an admin too:
// the account menu is personal, and an admin's queue counts are in the Admin
// menu (admin menu slice, 2026-10-13).
export const handleGetReviewNotifications = route(async (req, res) => {
  const user = getAuthUser(res);
  const mine = req.query.scope === "mine";
  const count = await countReviewNotifications(
    user.id,
    !mine && isAdminEmail(user.email),
  );
  res.json({ count });
});

export const handleMarkReviewsSeen = route(async (_req, res) => {
  const user = getAuthUser(res);
  await markReviewsSeen(user.id);
  res.json({ ok: true });
});

// --- Creator endpoints ---

const REVISE_TITLE_MAX = 200;
const REVISE_DESCRIPTION_MAX = 20_000;
const REVISE_NOTE_MAX = 2_000;

/** The fields a quick revise may change, checked; or why not, in words. */
export function reviseFields(
  body: Record<string, unknown>,
): { title?: string; description?: string; note?: string } | string {
  const out: { title?: string; description?: string; note?: string } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return "A title is required.";
    if (body.title.trim().length > REVISE_TITLE_MAX) return `The title must be ${REVISE_TITLE_MAX} characters or fewer.`;
    out.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return "The description must be text.";
    if (body.description.length > REVISE_DESCRIPTION_MAX) {
      return `The description must be ${REVISE_DESCRIPTION_MAX.toLocaleString("en-US")} characters or fewer.`;
    }
    out.description = body.description;
  }
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return "The note must be text.";
    if (body.note.length > REVISE_NOTE_MAX) return `The note must be ${REVISE_NOTE_MAX.toLocaleString("en-US")} characters or fewer.`;
    out.note = body.note;
  }
  if (body.content !== undefined || body.config !== undefined || body.state !== undefined) {
    return "Only the title, the description and a note can be revised here. Reopen the draft to change anything else.";
  }
  return out;
}

export const handleRevise = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;

  // The creator's quick revise (My submissions) changes the title and the
  // description, with a note to the reviewer: that is all the UI sends, and
  // all this route takes (Audit 2, the leftover from Audit 1). It used to
  // write a creator's raw `content` and `config` to their pending process,
  // skipping the type's validation. A revision that changes anything else
  // goes through the type's own draft (`draft_path` from /reopen), whose
  // resubmit runs the type's validation and builds the state.
  const fields = reviseFields(body);
  if (typeof fields === "string") {
    throw new ValidationError(fields);
  }
  const review = await reviseAndResubmit(reviewId, user.id, fields);

  res.json(review);
});

export const handleReopen = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;
  const result = await reopenForRevision(reviewId, user.id);
  // null → no draft on record: the client falls back to the inline form.
  res.json(result ?? { draft_id: null, draft_path: null });
});

export const handleWithdraw = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;

  const review = await withdrawReview(reviewId, user.id);
  res.json(review);
});

export const handleGetMyReviews = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviews = await listCreatorReviews(user.id);

  res.json(await withProcessSummaries(reviews));
});

export const handleGetReview = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;

  const review = await getReview(reviewId);
  if (!review) {
    throw new NotFoundError("Review not found");
  }

  if (review.creator_id !== user.id && !isAdminEmail(user.email)) {
    throw new ForbiddenError("Access denied");
  }

  const turns = await getReviewTurns(reviewId);
  const proc = await getProcessRow(review.process_id);

  res.json({ review, turns, process: proc, submission: submissionFor(proc), detail_path: detailPathFor(proc) });
});

// --- Admin endpoints ---

export const handleAdminListReviews = route(async (req, res) => {
  const status = req.query.status as string | undefined;
  const reviews = await listReviews(status);

  res.json(await withProcessSummaries(reviews));
});

export const handleAdminGetReview = route(async (req, res) => {
  const reviewId = req.params.reviewId as string;

  const review = await getReview(reviewId);
  if (!review) {
    throw new NotFoundError("Review not found");
  }

  const turns = await getReviewTurns(reviewId);
  const proc = await getProcessRow(review.process_id);

  res.json({ review, turns, process: proc, submission: submissionFor(proc), detail_path: detailPathFor(proc) });
});

export const handleAdminApprove = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;

  const result = await approveReview(reviewId, user.id);
  res.json(result);
});

export const handleAdminRequestChanges = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;
  const note = (req.body as Record<string, unknown>).note as string | undefined;

  if (!note || note.trim().length === 0) {
    throw new ValidationError("A note is required when requesting changes");
  }

  const review = await requestChanges(reviewId, user.id, note);
  res.json(review);
});

export const handleAdminDecline = route(async (req, res) => {
  const user = getAuthUser(res);
  const reviewId = req.params.reviewId as string;
  const reason = (req.body as Record<string, unknown>).reason as string | undefined;

  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("A reason is required when declining");
  }

  const review = await declineReview(reviewId, user.id, reason);
  res.json(review);
});
