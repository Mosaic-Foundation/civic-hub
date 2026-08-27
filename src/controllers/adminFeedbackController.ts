// Admin feedback controller — the read side of civic.feedback.
//
// GET /admin/feedback is the operator's archive of everything residents
// have sent through the feedback form. Read-only by design: there is no
// approve, edit, or delete. Feedback is a record of what someone said,
// and an archive you can edit is a worse record than one you cannot.
//
// PII: these rows carry name and email. requireAdmin (mounted on the
// whole /admin router) is what stands between them and the world — this
// endpoint is the first path by which feedback leaves the database.

import type { Request, Response } from "express";
import {
  FeedbackValidationError,
  listFeedback,
} from "../modules/civic.feedback/index.js";
import type { FeedbackCategory } from "../modules/civic.feedback/index.js";

// --- GET /admin/feedback ----------------------------------------------------

export async function handleAdminListFeedback(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const rawCategory = req.query.category;
    const category =
      typeof rawCategory === "string" && rawCategory !== "" && rawCategory !== "all"
        ? (rawCategory as FeedbackCategory)
        : undefined;

    const rawLimit = req.query.limit;
    const parsedLimit =
      typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : NaN;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

    const items = await listFeedback({ category, limit });
    res.json({ items, count: items.length });
  } catch (err) {
    if (err instanceof FeedbackValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[admin/feedback] list failed: ${message}`);
    res.status(500).json({ error: "Could not load feedback" });
  }
}
