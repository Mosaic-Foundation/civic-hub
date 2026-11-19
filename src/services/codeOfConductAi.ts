// The automated Code of Conduct check (the kernel's moderation; kernel step 3,
// out of civic.assistant): the hub's identity and Code of Conduct as the model
// reads them, the check itself at Submit, an invite's message and a
// conversation made directly, and what a draft keeps when it could not run.
// The drafting assistant feature (features/assistant/) reads the same hub
// identity and Code of Conduct text.

import { stripMarkdown } from "../shared/markdown.js";
import { aiConverse, aiDefaultModel, type AiConversationInput, type AiResult } from "../adapters/ai.js";
import { currentHub } from "../config/hubContext.js";
import { civicPlaceName } from "../config/hub.js";
import { hubKindOf, participantNoun } from "../shared/hubKind.js";
import { getSettingSync, hubDisplayNameSync } from "./hubSettings.js";
import { hubDocument } from "./hubDocuments.js";
import { KEYS } from "../models/hubSettings.js";
import { cocFakeEnabled } from "../config/devFlags.js";
import { fakeCodeOfConductCheck } from "../debug/fakeCodeOfConduct.js";
import { buildRespondTool, RESPONSE_TOOL, toAssistantResponse } from "./assistantResponse.js";
import type { HubConfig, Suggestion } from "../models/assistant.js";

/**
 * What a draft stores when the check could not run: a soft entry (never shown
 * on the form, never blocking) that says so, so the result is not mistaken
 * for a pass (codeOfConductVerdict in services/codeOfConduct.ts). The check
 * fails open: the real gate is human admin review (Decision #7).
 */
export const CHECK_UNAVAILABLE_RESULT = {
  severity: "soft",
  quoted_text: null,
  field: null,
  message: "The automated Code of Conduct check could not run.",
  suggested_revision: null,
  check_unavailable: true,
} as const;

/**
 * A conversation turn. By default the ai adapter's gate (src/adapters/ai.ts),
 * which records the call's usage under the purpose; tests pass their own.
 */
export type CallClaudeMultiTurnFn = (input: AiConversationInput) => Promise<AiResult>;

/**
 * Hub identity handed to the assistant, for the hub serving this request.
 * Single source — every caller (draft assistant, CoC-only check) uses this
 * rather than re-declaring.
 *
 * Name, place and Code of Conduct are the hub's own: its display name, its
 * `jurisdiction_name`, and the same resolved Code of Conduct document its
 * residents read (its override, or the shared template with its names). The
 * community line used to be one county's, with a sentence of scenery that no
 * setting holds; a hub with no civic geography gets a neutral line.
 */
export async function getHubConfig(): Promise<HubConfig> {
  const hub = currentHub();
  const place = civicPlaceName();
  // The hub's own word for its people ("neighbors"), or the kind's default.
  const people = participantNoun(
    hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)),
    2,
    getSettingSync(KEYS.COPY_RESIDENT_NOUN),
  );
  return {
    hub_name: hubDisplayNameSync(),
    // A hub that is not a place (identity.hub_kind) has participants, not
    // residents, even when it names a related place.
    community_description:
      hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)) !== "place"
        ? "the people who take part in it"
        : place
          ? `${people} of ${place}`
          : `the ${people} of the community it serves`,
    code_of_conduct: hub ? (await hubDocument(hub, KEYS.LEGAL_CODE_OF_CONDUCT)) ?? "" : "",
  };
}

/**
 * The hub's Code of Conduct, or — for a hub whose document could not be
 * loaded — the hard limits stated plainly, so the check still has something
 * to hold a submission to rather than an empty section.
 */
export function codeOfConductText(hubConfig: HubConfig): string {
  const text = hubConfig.code_of_conduct?.trim();
  if (text) return text;
  return "This hub's Code of Conduct could not be loaded. Hold submissions to these hard limits only: no slurs or hate speech, no harassment or personal attacks on named individuals, no threats of violence, no publishing anyone's private personal information.";
}

/**
 * Standalone Code of Conduct check for submission paths that have no
 * drafting assistant (e.g. conversation creation). Returns hard-block
 * suggestions only. Callers are expected to fail open on throw — the
 * real gate is human admin review.
 */
export async function checkTextAgainstCoC(
  fields: Array<{ label: string; text: string }>,
  hubConfig: HubConfig,
  claude: CallClaudeMultiTurnFn = (i) => aiConverse("assistant.review", i),
): Promise<Suggestion[]> {
  // The test rule (CIVIC_FAKE_ADAPTERS, or CIVIC_COC_FAKE; never production),
  // chosen here so every caller gets it: Submit, an invite's message and a
  // conversation created directly (which used to call the model regardless).
  if (cocFakeEnabled()) return fakeCodeOfConductCheck(fields);
  const model = aiDefaultModel();
  // Formatting is not content: the check reads the stripped text so a
  // marker can neither hide a violation nor be mistaken for one.
  const submission = fields
    .map((f) => ({ label: f.label, text: stripMarkdown(f.text) }))
    .filter((f) => f.text.trim().length > 0)
    .map((f) => `${f.label}:\n${f.text}`)
    .join("\n\n");
  if (!submission) return [];

  const result = await claude({
    model,
    system: buildCocCheckPrompt(hubConfig),
    messages: [
      {
        role: "user",
        content: `Check this submission against the Code of Conduct:\n\n${submission}`,
      },
    ],
    maxTokens: 1024,
    // Same reliability path as the assistant: a quoted violation with a raw
    // `"` used to break the hand-written JSON and DROP the hard block.
    tools: [buildRespondTool(fields.map((f) => f.label.toLowerCase()), { includeDraft: false })],
    toolChoice: { type: "tool", name: RESPONSE_TOOL },
    responseTool: RESPONSE_TOOL,
  });

  // Everything this prompt returns is a CoC finding — normalize to hard.
  return toAssistantResponse(result, []).suggestions.map((s) => ({
    ...s,
    severity: "hard" as const,
  }));
}

/**
 * System prompt for the standalone Code of Conduct check — used by
 * submission paths that have no drafting assistant (e.g. conversations).
 * CoC-only: no best-practices doc, no draft generation, no soft advice.
 */
export function buildCocCheckPrompt(hubConfig: HubConfig): string {
  return `You are an automated Code of Conduct pre-check on ${hubConfig.hub_name}, a civic platform for ${hubConfig.community_description}. You are given the text of a submission. Your ONLY job is to flag clear, unambiguous Code of Conduct violations: slurs, hate speech, harassment, personal attacks on named individuals, threats of violence, doxxing.

## Code of Conduct
${codeOfConductText(hubConfig)}

Do NOT flag opinions, criticism of officials or policy, blunt or emotional rhetoric, or anything the "What we will not remove" section protects. Do NOT offer writing advice, style suggestions, or soft feedback of any kind. If the text is acceptable, return an empty suggestions array.

## How you reply
Reply by calling the \`respond\` tool, exactly once. "message" is one short sentence summarizing the result. Each entry in "suggestions" is one violation: severity "hard" (you never make soft suggestions), "quoted_text" the offending text verbatim, "field" null, "message" what violates the Code of Conduct in plain prose, "suggested_revision" a civil rephrasing or removal. If the text is acceptable, "suggestions" is empty.`;
}
