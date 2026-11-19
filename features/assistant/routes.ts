// The drafting assistant's routes (features/assistant; kernel step 3): the AI
// chat about a draft (/message) and "Get suggestions" (/suggest), mounted at
// /assistant behind the Writing assistant's switch (plugin.assistant.enabled)
// and the resident check. GET /assistant/:processType/config, the form's copy,
// is the kernel's (src/routes/assistantRoutes.ts) and answers with the
// assistant off.

import { Router, type Request, type Response } from "express";
import {
  admitAiCall,
  ConflictError,
  currentAiLimits,
  currentHub,
  ForbiddenError,
  getAuthUser,
  getHubConfig,
  hubDocument,
  NotFoundError,
  processRegistry,
  requireResident,
  route,
  toDraftState,
  ValidationError,
  type AssistantDraft,
  type AssistantTypeConfig,
  type Category,
  type DraftState,
  type Phase,
} from "../../src/sdk/index.js";
import { callAssistant } from "./service.js";

const VALID_PHASES = new Set(["brainstorm", "review", "free_form"]);

async function lookupConfig(processType: string): Promise<AssistantTypeConfig | undefined> {
  return (await processRegistry()).handler(processType)?.getAssistantConfig?.();
}

/**
 * The type's config with its best-practices guide replaced by the hub's own
 * document, when the type names one. A guide whose worked examples are about
 * a place belongs to the hub, and the assistant should coach from the same
 * text the hub publishes rather than from a copy compiled into the server.
 */
async function withHubGuide(config: AssistantTypeConfig): Promise<AssistantTypeConfig> {
  if (!config.bestPracticesDocument) return config;
  const hub = currentHub();
  const doc = hub ? await hubDocument(hub, config.bestPracticesDocument) : null;
  return doc ? { ...config, bestPractices: doc } : config;
}


/**
 * The type's config narrowed to the fields that apply to THIS draft — a vote
 * only has "options" when its method needs a list. Feeds the prompt's draft
 * state, the reply schema's field enum, and validation alike, so the model
 * neither sees nor can target a field the form does not have right now.
 */
function effectiveConfig(config: AssistantTypeConfig, draft: DraftState): AssistantTypeConfig {
  const fields = config.activeFields?.(draft) ?? config.fields;
  return fields === config.fields ? config : { ...config, fields };
}

/**
 * Shared ownership/state gate for the draft endpoints. Throws a typed error
 * when the request must not proceed.
 */
async function loadDraftForUser(
  req: Request,
  res: Response,
  config: AssistantTypeConfig,
): Promise<AssistantDraft> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  const draft = await config.draftStore.get(id);
  if (!draft) throw new NotFoundError("Draft not found");
  if (draft.user_id !== user.id) throw new ForbiddenError("Not authorized");
  if (draft.status !== "drafting") {
    throw new ConflictError("Draft is not in drafting state", "already_submitted");
  }
  return draft;
}

/** POST /assistant/:processType/drafts/:id/message */
export const handleAssistantMessage = route(async (req, res) => {
  const processType = req.params.processType as string;
  const { phase, user_message } = req.body ?? {};

  const config = await lookupConfig(processType);
  if (!config) throw new NotFoundError("No drafting assistant for this process type", "no_assistant");
  if (!user_message || typeof user_message !== "string") {
    throw new ValidationError("user_message is required");
  }
  const maxChars = currentAiLimits().max_message_chars;
  if (user_message.length > maxChars) {
    throw new ValidationError(
      `That message is too long for the assistant. Please keep it under ${maxChars.toLocaleString("en-US")} characters.`,
      "message_too_long",
    );
  }
  if (!phase || !VALID_PHASES.has(phase)) {
    throw new ValidationError("phase must be: brainstorm, review, or free_form");
  }

  const draft = await loadDraftForUser(req, res, config);

  const category = config.supportsCategories
    ? ((draft.category ?? "idea") as Category)
    : undefined;

  const limits = await admitAiCall("chat", getAuthUser(res).id);
  const response = await callAssistant({
    phase: phase as Phase,
    category,
    config: effectiveConfig(await withHubGuide(config), toDraftState(draft)),
    draft_state: toDraftState(draft),
    conversation_history: draft.conversation_history,
    user_message,
    hub_config: await getHubConfig(),
    purpose: "assistant.message",
    limits,
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
    // No hash: a chat turn is not the check, so this never counts as one.
    await config.draftStore.saveReviewResult(draft.id, hardBlocks, null);
  }

  const updatedDraft = await config.draftStore.get(draft.id);
  res.json({ response, draft: updatedDraft });
});



/**
 * POST /assistant/:processType/drafts/:id/suggest — "Get suggestions".
 *
 * The best-practices review, on request (Adam, 2026-09-03: a distinct
 * button — the Code of Conduct check catches violations; this one improves
 * the writing). Returns suggestion cards for the assistant panel; nothing
 * is saved as the draft's check result, so asking for advice never counts
 * as having run the check.
 */
export const handleAssistantSuggest = route(async (req, res) => {
  const processType = req.params.processType as string;
  const config = await lookupConfig(processType);
  if (!config) throw new NotFoundError("No drafting assistant for this process type", "no_assistant");
  const draft = await loadDraftForUser(req, res, config);
  const category = config.supportsCategories
    ? ((draft.category ?? "idea") as Category)
    : undefined;
  const message =
    `Please review my current draft against ${config.bestPracticesTitle} and suggest ` +
    "concrete improvements as structured suggestions I can apply.";
  const limits = await admitAiCall("chat", getAuthUser(res).id);
  const response = await callAssistant({
    phase: "review",
    category,
    config: effectiveConfig(await withHubGuide(config), toDraftState(draft)),
    draft_state: toDraftState(draft),
    conversation_history: draft.conversation_history,
    user_message: message,
    hub_config: await getHubConfig(),
    purpose: "assistant.suggest",
    limits,
  });
  // Advice is a conversation turn, not writing assistance until applied
  // (Apply is what marks assistant_helped).
  await config.draftStore.appendConversation(draft.id, message, response.message);
  const updated = await config.draftStore.get(draft.id);
  res.json({ response, draft: updated });
});

export function assistantRouter(): Router {
  const router = Router();
  router.post("/:processType/drafts/:id/message", requireResident, handleAssistantMessage);
  router.post("/:processType/drafts/:id/suggest", requireResident, handleAssistantSuggest);
  return router;
}
