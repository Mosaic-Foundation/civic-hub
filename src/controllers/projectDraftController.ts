import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  createProjectDraft,
  getProjectDraft,
  listUserProjectDrafts,
  updateProjectDraft,
  appendProjectConversation,
  saveProjectReviewResult,
  applyProjectDraftProposal,
  setProjectDraftStatus,
} from "../modules/civic.project_drafts/index.js";
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

export async function handleCreateProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const draft = await createProjectDraft({ user_id: user.id });
    res.status(201).json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleListProjectDrafts(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const drafts = await listUserProjectDrafts(user.id, "drafting");
    res.json(drafts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
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

export async function handleUpdateProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
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

    const { title, description, sources, banner_image_url, banner_image_alt, skip_modified_flag } = req.body;

    const updated = await updateProjectDraft(id, {
      title,
      description,
      sources,
      banner_image_url,
      banner_image_alt,
      skip_modified_flag: skip_modified_flag === true,
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleSendProjectAssistantMessage(
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
    const draft = await getProjectDraft(id);
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
      process_type: "project",
      draft_state: draftState(draft),
      conversation_history: draft.conversation_history,
      user_message,
      hub_config: hubConfig,
    });

    await appendProjectConversation(id, user_message, response.message);

    if (response.draft_proposal) {
      await applyProjectDraftProposal(
        id,
        response.draft_proposal.title,
        response.draft_proposal.description,
        response.draft_proposal.sources,
      );
    }

    if (response.suggestions.length > 0) {
      await saveProjectReviewResult(id, response.suggestions);
    }

    const updatedDraft = await getProjectDraft(id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-assistant]", message);
    res.status(500).json({ error: message });
  }
}

export async function handleReviewProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
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
      "Please review my current draft against the Code of Conduct and Project Best Practices. " +
      "Return your feedback as structured suggestions.";

    let response;
    try {
      response = await callAssistant({
        phase: "review",
        process_type: "project",
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
        "[project-review] automated check unavailable, failing open to human review:",
        reviewErr instanceof Error ? reviewErr.message : reviewErr,
      );
      await saveProjectReviewResult(id, []);
      const degraded = await getProjectDraft(id);
      res.json({
        response: { message: AUTOMATED_REVIEW_UNAVAILABLE_NOTICE, suggestions: [] },
        draft: degraded,
        review_unavailable: true,
      });
      return;
    }

    // markAssisted: false — the CoC pre-check is not writing assistance
    // and must not trigger the "drafted with AI help" disclosure.
    await appendProjectConversation(id, reviewMessage, response.message, {
      markAssisted: false,
    });
    await saveProjectReviewResult(id, response.suggestions);

    const updatedDraft = await getProjectDraft(id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-review]", message);
    res.status(500).json({ error: message });
  }
}

export async function handleSubmitProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
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

    const sources = draft.sources
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // One creation path: always submit for review; admins are auto-approved.
    const result = await submitAsCreator(
      {
        process_type: "civic.project",
        title: draft.title.trim(),
        description: draft.description.trim(),
        creator_id: user.id,
        creator_name: user.full_name || user.display_name || "Resident",
        creator_email: user.email,
        content: {
          sources,
          assistant_helped: draft.assistant_helped,
          banner_image_url: draft.banner_image_url ?? null,
          banner_image_alt: draft.banner_image_alt ?? null,
        },
      },
      user.email,
    );

    await setProjectDraftStatus(id, "submitted");
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-submit]", message);
    res.status(400).json({ error: message });
  }
}
