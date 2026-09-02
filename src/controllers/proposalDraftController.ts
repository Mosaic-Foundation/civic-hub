import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  createDraft,
  getDraft,
  listUserDrafts,
  updateDraft,
  setDraftStatus,
  claimDraftForSubmission,
} from "../modules/civic.proposal_drafts/index.js";
import { type Category } from "../modules/civic.assistant/index.js";
import { submitAsCreator, reviseAndResubmit } from "../modules/civic.review/index.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";

// Assistant conversation + Code of Conduct review live on the shared
// /assistant routes (assistantController), dispatched through the registry.
// This controller owns only draft storage and submission.

const VALID_CATEGORIES = new Set(["issue", "idea", "project", "concern"]);
// Matches the proposal_drafts.proposal_duration_ms column default (6 weeks —
// the unified default across drafting types since 2026-08-28).
const DEFAULT_PROPOSAL_DURATION_MS = 42 * 24 * 60 * 60 * 1000;

export async function handleCreateDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const { category } = req.body;

  if (category && !VALID_CATEGORIES.has(category)) {
    res.status(400).json({ error: "Invalid category. Must be: issue, idea, or project" });
    return;
  }

  try {
    const draft = await createDraft({
      user_id: user.id,
      category: category as Category | undefined,
    });
    res.status(201).json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleListDrafts(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const drafts = await listUserDrafts(user.id, "drafting");
    res.json(drafts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized to view this draft" });
      return;
    }
    res.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleUpdateDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Cannot edit a submitted draft" });
      return;
    }

    const { title, description, sources, considerations, category, proposal_duration_ms, links, skip_modified_flag, assistant_applied } = req.body;

    if (category && !VALID_CATEGORIES.has(category)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }

    if (proposal_duration_ms !== undefined) {
      const dur = Number(proposal_duration_ms);
      const MIN_DURATION = 14 * 24 * 60 * 60 * 1000;   // 2 weeks
      // 3 months — the 6-month option was retired 2026-08-28 when every
      // duration-bearing type adopted the same 2w–3m picker. Existing
      // proposals with longer windows keep them; only new drafts are capped.
      const MAX_DURATION = 90 * 24 * 60 * 60 * 1000;
      if (isNaN(dur) || dur < MIN_DURATION || dur > MAX_DURATION) {
        res.status(400).json({ error: "Duration must be between 2 weeks and 3 months" });
        return;
      }
    }

    const updated = await updateDraft(id, {
      title,
      description,
      sources,
      considerations,
      category: category as Category | undefined,
      proposal_duration_ms: proposal_duration_ms !== undefined ? Number(proposal_duration_ms) : undefined,
      // Links are validated against the DRAFT id purely to reuse the
      // self-link/vocabulary checks; the real from_id is the process created
      // at submission. A draft can't link to itself in any meaningful sense.
      links: links === undefined ? undefined : validateLinkSet("", links),
      skip_modified_flag: skip_modified_flag === true,
      assistant_applied: assistant_applied === true,
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleSubmitDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Draft already submitted" });
      return;
    }
    if (!draft.title.trim()) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const hasHardBlocks = (draft.last_review_result ?? []).some(
      (s) => s.severity === "hard",
    );
    if (hasHardBlocks) {
      res.status(400).json({
        error: "Cannot submit: unresolved Code of Conduct concerns. Please review your draft and address all issues.",
      });
      return;
    }
    if (draft.draft_modified_since_review) {
      res.status(400).json({
        error: "Draft has been modified since last review. Please review again before submitting.",
      });
      return;
    }

    const optionalLinks = draft.sources
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let fullDescription = draft.description.trim();
    if (draft.considerations.trim()) {
      fullDescription = fullDescription
        ? `${fullDescription}\n\nConsiderations:\n${draft.considerations.trim()}`
        : `Considerations:\n${draft.considerations.trim()}`;
    }

    // Atomically claim the draft BEFORE creating anything. If a concurrent
    // or duplicate submit already claimed it, bail out without creating a
    // second proposal/review. On failure we roll the claim back so the user
    // can retry.
    const claimed = await claimDraftForSubmission(id);
    if (!claimed) {
      res.status(409).json({ error: "Draft has already been submitted" });
      return;
    }

    // Guard the duration: a missing/NaN value would make
    // `new Date(Date.now() + NaN)` an Invalid Date and crash toISOString()
    // with "Invalid time value". Fall back to the 90-day column default.
    const durationCandidate = Number(draft.proposal_duration_ms);
    const durationMs =
      Number.isFinite(durationCandidate) && durationCandidate > 0
        ? durationCandidate
        : DEFAULT_PROPOSAL_DURATION_MS;

    try {
      const content = {
        optional_links: optionalLinks,
        category: draft.category ?? null,
        assistant_helped: draft.assistant_helped,
        proposal_duration_ms: durationMs,
      };

      // Revision of an existing submission (admin requested changes): update
      // the process in place and put it back in the queue — never a second one.
      const reviewId = typeof req.body?.review_id === "string" ? req.body.review_id : undefined;
      if (reviewId) {
        const review = await reviseAndResubmit(reviewId, user.id, {
          title: draft.title.trim(),
          description: fullDescription || "",
          content,
          links: draft.links,
        });
        res.status(201).json({ review_id: review.id, process_id: review.process_id, auto_approved: false });
        return;
      }

      // One creation path: always submit for review; admins are auto-approved
      // (no review wait). The proposal's closes_at is derived from
      // proposal_duration_ms inside the approval flow.
      const result = await submitAsCreator(
        {
          draft_id: draft.id,
          links: draft.links,
          process_type: "civic.proposal",
          title: draft.title.trim(),
          description: fullDescription || "",
          creator_id: user.id,
          creator_name: user.full_name || user.display_name || "Resident",
          creator_email: user.email,
          content,
        },
        user.email,
      );

      res.status(201).json(result);
    } catch (workErr) {
      // The create failed after we claimed — release the draft for retry.
      await setDraftStatus(id, "drafting").catch(() => {});
      throw workErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}
