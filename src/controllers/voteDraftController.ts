import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  createVoteDraft,
  getVoteDraft,
  listUserVoteDrafts,
  updateVoteDraft,
  appendVoteConversation,
  saveVoteReviewResult,
  applyVoteDraftProposal,
  setVoteDraftStatus,
} from "../modules/civic.vote_drafts/index.js";
import {
  callAssistant,
  AUTOMATED_REVIEW_UNAVAILABLE_NOTICE,
  type HubConfig,
  type DraftState,
  type Phase,
} from "../modules/civic.proposal_assistant/index.js";
import { submitAsCreator } from "../modules/civic.review/index.js";

const VALID_PHASES = new Set(["brainstorm", "review", "free_form"]);

function getHubConfig(): HubConfig {
  return {
    hub_name: process.env.HUB_NAME ?? "Floyd Civic Hub",
    community_description:
      "residents of Floyd County, Virginia — a small rural community in the Blue Ridge Mountains",
  };
}

function draftState(draft: { title: string; description: string; sources: string }): DraftState {
  return {
    title: draft.title,
    description: draft.description,
    sources: draft.sources,
    considerations: "",
  };
}

export async function handleCreateVoteDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const draft = await createVoteDraft({ user_id: user.id });
    res.status(201).json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleListVoteDrafts(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const drafts = await listUserVoteDrafts(user.id, "drafting");
    res.json(drafts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetVoteDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getVoteDraft(id);
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

export async function handleUpdateVoteDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getVoteDraft(id);
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

    const { title, description, sources, voting_duration_ms, method, custom_options, skip_modified_flag } = req.body;

    const updated = await updateVoteDraft(id, {
      title,
      description,
      sources,
      voting_duration_ms,
      method,
      custom_options,
      skip_modified_flag: skip_modified_flag === true,
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleSendVoteAssistantMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;
  const { phase, user_message } = req.body;

  if (!user_message || typeof user_message !== "string") {
    res.status(400).json({ error: "user_message is required" });
    return;
  }
  if (!phase || !VALID_PHASES.has(phase)) {
    res.status(400).json({ error: "phase must be: brainstorm, review, or free_form" });
    return;
  }

  try {
    const draft = await getVoteDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Draft is not in drafting state" });
      return;
    }

    const hubConfig = getHubConfig();

    const response = await callAssistant({
      phase: phase as Phase,
      process_type: "vote",
      draft_state: draftState(draft),
      conversation_history: draft.conversation_history,
      user_message,
      hub_config: hubConfig,
    });

    await appendVoteConversation(id, user_message, response.message);

    if (response.draft_proposal) {
      await applyVoteDraftProposal(
        id,
        response.draft_proposal.title,
        response.draft_proposal.description,
        response.draft_proposal.sources,
      );
    }

    if (response.suggestions.length > 0) {
      await saveVoteReviewResult(id, response.suggestions);
    }

    const updatedDraft = await getVoteDraft(id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[vote-assistant]", message);
    res.status(500).json({ error: message });
  }
}

export async function handleReviewVoteDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getVoteDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Draft is not in drafting state" });
      return;
    }

    const hubConfig = getHubConfig();

    const reviewMessage =
      "Please review my current draft against the Code of Conduct and Vote Best Practices. " +
      "Return your feedback as structured suggestions.";

    let response;
    try {
      response = await callAssistant({
        phase: "review",
        process_type: "vote",
        draft_state: draftState(draft),
        conversation_history: draft.conversation_history,
        user_message: reviewMessage,
        hub_config: hubConfig,
      });
    } catch (reviewErr) {
      // Fail open: the automated pre-check couldn't run. Record a clean
      // (empty) review result so the draft is no longer "modified since
      // review", and let it through to human admin review (the real gate).
      console.error(
        "[vote-review] automated check unavailable, failing open to human review:",
        reviewErr instanceof Error ? reviewErr.message : reviewErr,
      );
      await saveVoteReviewResult(id, []);
      const degraded = await getVoteDraft(id);
      res.json({
        response: { message: AUTOMATED_REVIEW_UNAVAILABLE_NOTICE, suggestions: [] },
        draft: degraded,
        review_unavailable: true,
      });
      return;
    }

    // markAssisted: false — the CoC pre-check is not writing assistance
    // and must not trigger the "drafted with AI help" disclosure.
    await appendVoteConversation(id, reviewMessage, response.message, {
      markAssisted: false,
    });
    await saveVoteReviewResult(id, response.suggestions);

    const updatedDraft = await getVoteDraft(id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[vote-review]", message);
    res.status(500).json({ error: message });
  }
}

export async function handleSubmitVoteDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getVoteDraft(id);
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

    const optionalLinks = draft.sources
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const voteMethod = draft.method ?? "yes_no_unsure";
    // All votes go through the proposed phase: born as a "proposed vote",
    // they gather support and auto-activate at the support threshold. This is
    // the same regardless of who creates the vote (admins are auto-approved).
    const stateInput: Record<string, unknown> = {
      method: voteMethod,
      voting_duration_ms: draft.voting_duration_ms,
      activation_mode: "proposal_required",
    };
    if (voteMethod === "approval" && Array.isArray(draft.custom_options)) {
      stateInput.options = draft.custom_options;
    }

    const contentPayload = optionalLinks.length > 0
      ? { links: optionalLinks.map((url: string) => ({ url, label: url })) }
      : undefined;

    const result = await submitAsCreator(
      {
        process_type: "civic.vote",
        title: draft.title.trim(),
        description: draft.description.trim() || "",
        creator_id: user.id,
        creator_name: user.full_name || user.display_name || "Resident",
        creator_email: user.email,
        content: contentPayload as Record<string, unknown> | undefined,
        state: stateInput,
      },
      user.email,
    );

    await setVoteDraftStatus(id, "submitted");
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[vote-submit]", message);
    res.status(400).json({ error: message });
  }
}
