// Shared drafting-assistant controller — ONE dispatch surface for every
// process type. Which types have an assistant, and everything type-specific
// about it, comes from the registry (ProcessHandler.getAssistantConfig);
// this controller never branches on a process type itself.
//
//   GET  /assistant/:processType/config            — affordance + guidance for the UI
//   POST /assistant/:processType/drafts/:id/message — conversation turn
//   POST /assistant/:processType/drafts/:id/review  — Code of Conduct check

import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import { getProcessHandler } from "../processes/registry.js";
import {
  callAssistant,
  getHubConfig,
  AUTOMATED_REVIEW_UNAVAILABLE_NOTICE,
  type AssistantTypeConfig,
  type AssistantDraft,
  type Category,
  type DraftState,
  type Phase,
} from "../modules/civic.assistant/index.js";

const VALID_PHASES = new Set(["brainstorm", "review", "free_form"]);

function lookupConfig(processType: string): AssistantTypeConfig | undefined {
  return getProcessHandler(processType)?.getAssistantConfig?.();
}

function toDraftState(draft: AssistantDraft): DraftState {
  return {
    title: draft.title,
    description: draft.description,
    sources: draft.sources,
    considerations: draft.considerations ?? "",
    ...(draft.seed_statements !== undefined
      ? { seed_statements: draft.seed_statements }
      : {}),
  };
}

/**
 * GET /assistant/:processType/config
 *
 * What the creation shell needs to render: whether this type has drafting
 * help at all, the greetings/kickoff for the panel, and the per-field
 * inline guidance shown to everyone (assistant or not). Public — it leaks
 * nothing beyond copy that renders on the form anyway.
 */
export async function handleGetAssistantConfig(
  req: Request,
  res: Response,
): Promise<void> {
  const processType = req.params.processType as string;
  const config = lookupConfig(processType);

  if (!config) {
    res.json({ available: false, field_guidance: [] });
    return;
  }

  res.json({
    available: true,
    content_noun: config.contentNoun,
    greeting: config.greeting,
    returning_greeting: config.returningGreeting,
    kickoff_message: config.kickoffMessage,
    supports_categories: config.supportsCategories,
    field_guidance: config.fieldGuidance,
  });
}

/**
 * Shared ownership/state gate for the two draft endpoints. Writes the
 * error response and returns undefined when the request must not proceed.
 */
async function loadDraftForUser(
  req: Request,
  res: Response,
  config: AssistantTypeConfig,
): Promise<AssistantDraft | undefined> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  const draft = await config.draftStore.get(id);
  if (!draft) {
    res.status(404).json({ error: "Draft not found" });
    return undefined;
  }
  if (draft.user_id !== user.id) {
    res.status(403).json({ error: "Not authorized" });
    return undefined;
  }
  if (draft.status !== "drafting") {
    res.status(400).json({ error: "Draft is not in drafting state" });
    return undefined;
  }
  return draft;
}

/** POST /assistant/:processType/drafts/:id/message */
export async function handleAssistantMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const processType = req.params.processType as string;
  const { phase, user_message } = req.body;

  const config = lookupConfig(processType);
  if (!config) {
    res.status(404).json({ error: `No drafting assistant for process type: ${processType}` });
    return;
  }
  if (!user_message || typeof user_message !== "string") {
    res.status(400).json({ error: "user_message is required" });
    return;
  }
  if (!phase || !VALID_PHASES.has(phase)) {
    res.status(400).json({ error: "phase must be: brainstorm, review, or free_form" });
    return;
  }

  try {
    const draft = await loadDraftForUser(req, res, config);
    if (!draft) return;

    const category = config.supportsCategories
      ? ((draft.category ?? "idea") as Category)
      : undefined;

    const response = await callAssistant({
      phase: phase as Phase,
      category,
      config,
      draft_state: toDraftState(draft),
      conversation_history: draft.conversation_history,
      user_message,
      hub_config: getHubConfig(),
    });

    await config.draftStore.appendConversation(draft.id, user_message, response.message);

    if (response.draft_proposal) {
      await config.draftStore.applyGeneratedDraft(draft.id, response.draft_proposal);
    }

    if (response.suggestions.length > 0) {
      await config.draftStore.saveReviewResult(draft.id, response.suggestions);
    }

    const updatedDraft = await config.draftStore.get(draft.id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assistant:${processType}]`, message);
    res.status(500).json({ error: message });
  }
}

/** POST /assistant/:processType/drafts/:id/review — the always-on CoC check. */
export async function handleAssistantReview(
  req: Request,
  res: Response,
): Promise<void> {
  const processType = req.params.processType as string;

  const config = lookupConfig(processType);
  if (!config) {
    res.status(404).json({ error: `No drafting assistant for process type: ${processType}` });
    return;
  }

  try {
    const draft = await loadDraftForUser(req, res, config);
    if (!draft) return;

    const category = config.supportsCategories
      ? ((draft.category ?? "idea") as Category)
      : undefined;

    const reviewMessage =
      `Please review my current draft against the Code of Conduct and ${config.bestPracticesTitle}. ` +
      "Return your feedback as structured suggestions.";

    let response;
    try {
      response = await callAssistant({
        phase: "review",
        category,
        config,
        draft_state: toDraftState(draft),
        conversation_history: draft.conversation_history,
        user_message: reviewMessage,
        hub_config: getHubConfig(),
      });
    } catch (reviewErr) {
      // Fail open: the automated pre-check couldn't run. Record a clean
      // (empty) review result so the draft is no longer "modified since
      // review", and let it through to human admin review (the real gate).
      console.error(
        `[assistant-review:${processType}] automated check unavailable, failing open to human review:`,
        reviewErr instanceof Error ? reviewErr.message : reviewErr,
      );
      await config.draftStore.saveReviewResult(draft.id, []);
      const degraded = await config.draftStore.get(draft.id);
      res.json({
        response: { message: AUTOMATED_REVIEW_UNAVAILABLE_NOTICE, suggestions: [] },
        draft: degraded,
        review_unavailable: true,
      });
      return;
    }

    // The CoC pre-check is not writing assistance — appendConversation
    // never marks assistant_helped, so recording the exchange is safe.
    await config.draftStore.appendConversation(draft.id, reviewMessage, response.message);
    await config.draftStore.saveReviewResult(draft.id, response.suggestions);

    const updatedDraft = await config.draftStore.get(draft.id);
    res.json({ response, draft: updatedDraft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assistant-review:${processType}]`, message);
    res.status(500).json({ error: message });
  }
}
