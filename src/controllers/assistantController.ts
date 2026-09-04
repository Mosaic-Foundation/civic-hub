// Shared drafting-assistant controller — ONE dispatch surface for every
// process type. Which types have an assistant, and everything type-specific
// about it, comes from the registry (ProcessHandler.getAssistantConfig);
// this controller never branches on a process type itself.
//
//   GET  /assistant/:processType/config            — affordance + guidance for the UI
//   POST /assistant/:processType/drafts/:id/message — conversation turn
//   POST /assistant/:processType/drafts/:id/review  — Code of Conduct check

import { checkTextAgainstCoC } from "../modules/civic.assistant/service.js";
import type { Suggestion } from "../modules/civic.assistant/models.js";
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

    // Chat suggestions live in the chat — their Apply buttons work from the
    // cards there. Only HARD blocks are persisted onto the draft, because
    // they gate submission and must be visible on the form view too. Soft
    // cards (a sources list, a rewrite) used to be saved here as well and
    // then reappeared on the form as "Code of Conduct check" results
    // (Adam, 2026-09-02).
    const hardBlocks = response.suggestions.filter((s) => s.severity === "hard");
    if (hardBlocks.length > 0) {
      await config.draftStore.saveReviewResult(draft.id, hardBlocks);
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

    // The check is the Code of Conduct check and nothing else (Adam,
    // 2026-09-03: "it should suggest changes only based on code of conduct
    // violations… the writing assistant should be a different thing").
    // Hard blocks only; no best-practices advice, no fact-checking, no web
    // search, no chat turn. Writing help lives in the assistant panel, where
    // the person asks for it. Same for creation and for edits.
    {
      const state = toDraftState(draft);
      const fields = [
        { label: "Title", text: state.title ?? "" },
        { label: "Description", text: state.description ?? "" },
        { label: "Sources", text: state.sources ?? "" },
        { label: "Considerations", text: state.considerations ?? "" },
        { label: "Seed statements", text: state.seed_statements ?? "" },
      ];
      let suggestions: Suggestion[] = [];
      let unavailable = false;
      try {
        suggestions = await checkTextAgainstCoC(fields, getHubConfig());
      } catch (err) {
        console.error(`[assistant-review:${processType}] CoC check unavailable, failing open to human review:`, err instanceof Error ? err.message : err);
        unavailable = true;
      }
      await config.draftStore.saveReviewResult(draft.id, suggestions);
      const updated = await config.draftStore.get(draft.id);
      res.json({
        response: {
          message: unavailable
            ? AUTOMATED_REVIEW_UNAVAILABLE_NOTICE
            : suggestions.length
              ? "The Code of Conduct check found something that must be fixed first."
              : "No Code of Conduct issues found.",
          suggestions,
        },
        draft: updated,
        ...(unavailable ? { review_unavailable: true } : {}),
      });
      return;
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assistant-review:${processType}]`, message);
    res.status(500).json({ error: message });
  }
}


/**
 * POST /assistant/:processType/drafts/:id/suggest — "Get suggestions".
 *
 * The best-practices review, on request (Adam, 2026-09-03: a distinct
 * button — the Code of Conduct check catches violations; this one improves
 * the writing). Returns suggestion cards for the assistant panel; nothing
 * is saved as the draft's check result, so asking for advice never counts
 * as having run the check.
 */
export async function handleAssistantSuggest(
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
    const message =
      `Please review my current draft against ${config.bestPracticesTitle} and suggest ` +
      "concrete improvements as structured suggestions I can apply.";
    const response = await callAssistant({
      phase: "review",
      category,
      config,
      draft_state: toDraftState(draft),
      conversation_history: draft.conversation_history,
      user_message: message,
      hub_config: getHubConfig(),
    });
    // Advice is a conversation turn, not writing assistance until applied
    // (Apply is what marks assistant_helped).
    await config.draftStore.appendConversation(draft.id, message, response.message);
    const updated = await config.draftStore.get(draft.id);
    res.json({ response, draft: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[assistant-suggest:${processType}]`, message);
    res.status(500).json({ error: message });
  }
}
