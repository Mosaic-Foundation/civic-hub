// Conversation draft storage + submission. Assistant conversation and the
// Code of Conduct review live on the shared /assistant routes
// (assistantController), dispatched through the registry — this controller
// mirrors voteDraftController for the deliberation type.

import { Request, Response } from "express";
import { validateLinkSet } from "../modules/civic.process_links/index.js";
import { getAuthUser } from "../middleware/auth.js";
import {
  createDeliberationDraft,
  getDeliberationDraft,
  updateDeliberationDraft,
  setDeliberationDraftStatus,
} from "../modules/civic.deliberation_drafts/index.js";
import { submitAsCreator, reviseAndResubmit } from "../modules/civic.review/index.js";

export async function handleCreateDeliberationDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const draft = await createDeliberationDraft({ user_id: user.id });
    res.status(201).json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleGetDeliberationDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDeliberationDraft(id);
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

export async function handleUpdateDeliberationDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDeliberationDraft(id);
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

    const {
      title,
      description,
      sources,
      seed_statements,
      duration_ms,
      participation_threshold,
      links,
      skip_modified_flag,
      assistant_applied,
    } = req.body;

    const updated = await updateDeliberationDraft(id, {
      title,
      description,
      sources,
      seed_statements,
      duration_ms,
      participation_threshold,
      // Validated against an empty from_id purely for the vocabulary /
      // self-link checks (as the other draft types do); the real from_id is
      // the process created at submission.
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

export async function handleSubmitDeliberationDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getDeliberationDraft(id);
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
      res.status(400).json({ error: "Topic is required" });
      return;
    }
    if (!draft.description.trim()) {
      res.status(400).json({ error: "Framing is required" });
      return;
    }

    const hasHardBlocks = (draft.last_review_result ?? []).some(
      (s) => s.severity === "hard",
    );
    if (hasHardBlocks) {
      res.status(400).json({
        error: "Cannot submit: unresolved Code of Conduct concerns. Review your draft.",
      });
      return;
    }
    if (draft.draft_modified_since_review) {
      res.status(400).json({
        error: "Draft has been modified since last review. Please review again before submitting.",
      });
      return;
    }

    // Deduplicated, case- and whitespace-insensitively. Polis rejects a
    // repeated statement with `polis_err_post_comment_duplicate`, and before
    // 2026-09-04 that error aborted the whole seeding loop — which threw away
    // the conversation id and left an approved conversation stuck at "waiting
    // to start" with an orphan on Polis (proc_5889e8e441d1495e). The adapter
    // now tolerates the error too; this stops it being raised at all. First
    // occurrence wins, so the creator's ordering is preserved.
    const seen = new Set<string>();
    const seeds = draft.seed_statements
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => {
        const key = s.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // Cap at 6 — a "learn more" list, not a bibliography. The form guide
    // and the assistant's instructions carry the same limit; this is the
    // backstop.
    const sources = draft.sources
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 6);

    // duration_ms (not an absolute deadline) goes on state: the deadline is
    // computed when the conversation STARTS (auto-start at approval), so
    // review-queue time never eats into the participation window.
    const statePayload: Record<string, unknown> = {
      topic: draft.title.trim(),
      framing: draft.description.trim(),
      duration_ms: draft.duration_ms,
      assistant_helped: draft.assistant_helped,
      ...(draft.participation_threshold
        ? { participation_threshold: draft.participation_threshold }
        : {}),
      ...(seeds.length > 0 ? { seed_statements: seeds } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    };

    // Revision of an existing submission (admin requested changes): update
    // the process in place and put it back in the queue — never a second one.
    const reviewId = typeof req.body?.review_id === "string" ? req.body.review_id : undefined;
    if (reviewId) {
      const review = await reviseAndResubmit(reviewId, user.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        state: statePayload,
        links: draft.links,
      });
      await setDeliberationDraftStatus(id, "submitted");
      res.status(201).json({ review_id: review.id, process_id: review.process_id, auto_approved: false });
      return;
    }

    // One creation path: always submit for review; admins are auto-approved.
    const result = await submitAsCreator(
      {
        draft_id: draft.id,
        links: draft.links,
        process_type: "civic.polis_deliberation",
        title: draft.title.trim(),
        description: draft.description.trim(),
        creator_id: user.id,
        creator_name: user.full_name || user.display_name || "Resident",
        creator_email: user.email,
        state: statePayload,
      },
      user.email,
    );

    await setDeliberationDraftStatus(id, "submitted");
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[deliberation-submit]", message);
    res.status(400).json({ error: message });
  }
}
