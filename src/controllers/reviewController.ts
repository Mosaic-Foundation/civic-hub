import { Request, Response } from "express";
import { describeSubmission } from "../processes/registry.js";
import type { SubmissionField } from "../shared/submissionPreview.js";
import { getAuthUser, isAdminEmail } from "../middleware/auth.js";
import {
  reopenForRevision,
  submitForReview,
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
import { getDb } from "../db/client.js";

// --- Notification indicator ---


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

export async function handleGetReviewNotifications(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const count = await countReviewNotifications(
      user.id,
      isAdminEmail(user.email),
    );
    res.json({ count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleMarkReviewsSeen(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    await markReviewsSeen(user.id);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- Creator endpoints ---

export async function handleSubmitForReview(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const body = req.body as Record<string, unknown>;
    const process_type = body.process_type as string | undefined;
    const title = body.title as string | undefined;
    const description = body.description as string | undefined;
    const content = body.content as Record<string, unknown> | undefined;
    const config = body.config as Record<string, unknown> | undefined;
    const state = body.state as Record<string, unknown> | undefined;

    if (!process_type || !title || !description) {
      res
        .status(400)
        .json({ error: "process_type, title, and description are required" });
      return;
    }

    // Creator identity comes from the authenticated session, NEVER the request
    // body. Taking creator_email from the body let a resident make the hub send
    // review emails to an arbitrary address (an email-relay / phishing vector).
    const creator_email = user.email;
    const creator_name = user.full_name ?? user.display_name ?? user.email;

    const result = await submitForReview({
      process_type,
      title,
      description,
      creator_id: user.id,
      creator_name,
      creator_email,
      content,
      config,
      state,
    });

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleRevise(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;
    const body = req.body as Record<string, unknown>;

    const review = await reviseAndResubmit(reviewId, user.id, {
      title: body.title as string | undefined,
      description: body.description as string | undefined,
      content: body.content as Record<string, unknown> | undefined,
      config: body.config as Record<string, unknown> | undefined,
      note: body.note as string | undefined,
    });

    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Only the creator")
        ? 403
        : message.includes("Cannot revise")
          ? 409
          : 500;
    res.status(status).json({ error: message });
  }
}

export async function handleReopen(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;
    const result = await reopenForRevision(reviewId, user.id);
    // null → no draft on record: the client falls back to the inline form.
    res.json(result ?? { draft_id: null, draft_path: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Only the creator")
        ? 403
        : message.includes("Cannot revise")
          ? 409
          : 500;
    res.status(status).json({ error: message });
  }
}

export async function handleWithdraw(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;

    const review = await withdrawReview(reviewId, user.id);
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Only the creator")
        ? 403
        : message.includes("Cannot withdraw")
          ? 409
          : 500;
    res.status(status).json({ error: message });
  }
}

export async function handleGetMyReviews(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviews = await listCreatorReviews(user.id);

    const enriched = await Promise.all(
      reviews.map(async (review) => {
        const { data: proc } = await getDb()
          .from("processes")
          .select("type, title, description")
          .eq("id", review.process_id)
          .single();
        return {
          ...review,
          process_type: (proc as Record<string, unknown> | null)?.type ?? null,
          process_title: (proc as Record<string, unknown> | null)?.title ?? null,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetReview(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;

    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    if (review.creator_id !== user.id && !isAdminEmail(user.email)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const turns = await getReviewTurns(reviewId);
    const { data: proc } = await getDb()
      .from("processes")
      .select("*")
      .eq("id", review.process_id)
      .single();

    res.json({ review, turns, process: proc, submission: submissionFor(proc) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- Admin endpoints ---

export async function handleAdminListReviews(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const status = req.query.status as string | undefined;
    const reviews = await listReviews(status);

    const enriched = await Promise.all(
      reviews.map(async (review) => {
        const { data: proc } = await getDb()
          .from("processes")
          .select("type, title, description")
          .eq("id", review.process_id)
          .single();
        return {
          ...review,
          process_type: (proc as Record<string, unknown> | null)?.type ?? null,
          process_title: (proc as Record<string, unknown> | null)?.title ?? null,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleAdminGetReview(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const reviewId = req.params.reviewId as string;

    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const turns = await getReviewTurns(reviewId);
    const { data: proc } = await getDb()
      .from("processes")
      .select("*")
      .eq("id", review.process_id)
      .single();

    res.json({ review, turns, process: proc, submission: submissionFor(proc) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleAdminApprove(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;

    const result = await approveReview(reviewId, user.id);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Cannot approve") || message.includes("already been approved")
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function handleAdminRequestChanges(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;
    const note = (req.body as Record<string, unknown>).note as string | undefined;

    if (!note || note.trim().length === 0) {
      res.status(400).json({ error: "A note is required when requesting changes" });
      return;
    }

    const review = await requestChanges(reviewId, user.id, note);
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Cannot request")
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function handleAdminDecline(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    const reviewId = req.params.reviewId as string;
    const reason = (req.body as Record<string, unknown>).reason as string | undefined;

    if (!reason || reason.trim().length === 0) {
      res.status(400).json({ error: "A reason is required when declining" });
      return;
    }

    const review = await declineReview(reviewId, user.id, reason);
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found")
      ? 404
      : message.includes("Cannot decline")
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
}
