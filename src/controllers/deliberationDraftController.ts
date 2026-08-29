// Conversation draft storage + submission. Assistant conversation and the
// Code of Conduct review live on the shared /assistant routes
// (assistantController), dispatched through the registry — this controller
// mirrors voteDraftController for the deliberation type.

import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  createDeliberationDraft,
  getDeliberationDraft,
  updateDeliberationDraft,
  setDeliberationDraftStatus,
} from "../modules/civic.deliberation_drafts/index.js";
import { submitAsCreator } from "../modules/civic.review/index.js";

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

    const seeds = draft.seed_statements
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const sources = draft.sources
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

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

    // One creation path: always submit for review; admins are auto-approved.
    const result = await submitAsCreator(
      {
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
