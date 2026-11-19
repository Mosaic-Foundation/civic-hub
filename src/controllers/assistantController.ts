// Shared drafting-assistant controller — ONE dispatch surface for every
// process type. Which types have an assistant, and everything type-specific
// about it, comes from the registry (ProcessHandler.getAssistantConfig);
// this controller never branches on a process type itself.
//
//   GET  /assistant/:processType/config            — affordance + guidance for the UI
//
// The chat and the suggestions are the Writing assistant feature's
// (features/assistant/routes.ts).

import { route } from "../http/route.js";
import { getProcessHandler } from "../processes/registry.js";
import type { AssistantTypeConfig } from "../models/assistant.js";

function lookupConfig(processType: string): AssistantTypeConfig | undefined {
  return getProcessHandler(processType)?.getAssistantConfig?.();
}

/**
 * GET /assistant/:processType/config
 *
 * What the creation shell needs to render: whether this type has drafting
 * help at all, the greetings/kickoff for the panel, and the per-field
 * inline guidance shown to everyone (assistant or not). Public — it leaks
 * nothing beyond copy that renders on the form anyway.
 */
export const handleGetAssistantConfig = route(async (req, res) => {
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
});
