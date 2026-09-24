// Drafting-assistant config for civic.proposal — declared by the proposal
// handler via ProcessHandler.getAssistantConfig. Everything the generic
// civic.assistant module needs to help someone draft a proposal lives here:
// the best-practices doc, the brainstorm/review guidance, the form's field
// schema and inline guidance, and the storage adapter for proposal drafts.

import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";
import { KEYS } from "../models/hubSettings.js";
import {
  getDraft,
  appendConversation,
  saveReviewResult,
  applyDraftProposal,
} from "../modules/civic.proposal_drafts/index.js";

/**
 * Stand-in for the hub's own guide, used only when no hub is in scope (a unit
 * test, a script). In a request the assistant reads the hub's
 * `legal.proposal_best_practices` document instead — see
 * `bestPracticesDocument` below — which is the shared placeless guide, or the
 * hub's own version: Floyd's names its farmers market and town park, which is
 * better writing for Floyd and was, until 2026-09-24, compiled in here and
 * handed to every hub's assistant.
 */
const PROPOSAL_BEST_PRACTICES_FALLBACK = `# Proposal Best Practices

A strong proposal has a specific, neutral title that states what is proposed; a description that says what, where and who is affected; sources for any factual claim; and, on a contested topic, an honest acknowledgement of the other side. Preference proposals do not need sources. Personal experience is welcome when framed as personal experience.
`;

export const proposalAssistantConfig: AssistantTypeConfig = {
  contentNoun: "proposal",
  greeting:
    "Happy to help. I'll ask a few quick questions to shape your proposal, then I can put together a starting draft you can edit. You can also skip ahead and write on your own at any point.",
  kickoffMessage: "I want to propose something for the community to consider.",
  returningGreeting:
    "I can see your draft so far. Ask me to review it, strengthen a section, or find sources — or tell me what you're working on.",
  bestPractices: PROPOSAL_BEST_PRACTICES_FALLBACK,
  bestPracticesDocument: KEYS.LEGAL_PROPOSAL_BEST_PRACTICES,
  bestPracticesTitle: "Proposal Best Practices",
  brainstormGuidance: `For Issue: What's the concern, in your own words? What have you seen or experienced that brings this up? Who do you think is affected? What outcome would you want?
For Idea: What would you like to see happen? Why does it matter to you? Who else might want this?
For Project: What do you want to do? Who would it serve? What would it take, roughly? Are you willing to help organize it, or are you proposing someone else take it on?`,
  reviewEmptyFieldsGuidance: `After evaluating the draft content, check for empty optional fields (description, sources, considerations). For each empty field that would strengthen this particular proposal, mention it in your message — briefly explain what it could add and offer to help fill it in. These are NOT suggestions (don't add them to the suggestions array) — just a conversational nudge in your message like: "Your proposal is ready to submit as-is. I noticed the Considerations field is empty — for a project like this, noting who would organize it and what resources are needed could help voters understand feasibility. Want me to help draft that section, or would you rather submit now?" Always make it clear the user can submit without filling those fields.`,
  typeGuidance: `## Category guidance
Issue. Be alert to empirical claims. Ask for sources. On contested topics, invite a counterargument.
Idea. Preference-based. Don't require sources or counterarguments. Focus on clarity and specificity.
Project. Action-oriented. Focus on who would benefit, what it would take, who's organizing. Factual feasibility claims should be sourced.`,
  fields: ["title", "description", "sources", "considerations"],
  supportsCategories: true,
  fieldGuidance: [
    {
      field: "title",
      hint: "Be specific enough that a neighbor scrolling the list understands the subject without opening it.",
      example: "Create a community composting program at the farmers market",
    },
    {
      field: "description",
      hint: "Say what you're proposing, why it matters, and what an endorsement would mean. A few plain sentences is plenty.",
      example:
        "Our street floods every heavy rain. I'd like the county to assess the drainage; endorsing asks the Board to look into it.",
    },
    {
      field: "sources",
      hint: "Link anything that backs a factual claim — official documents, news articles, meeting minutes. Opinions don't need sources.",
    },
  ],
  draftStore: {
    async get(id) {
      const draft = await getDraft(id);
      if (!draft) return undefined;
      return { ...draft };
    },
    appendConversation: (id, userMessage, assistantMessage) =>
      appendConversation(id, userMessage, assistantMessage),
    saveReviewResult: (id, suggestions) => saveReviewResult(id, suggestions),
    applyGeneratedDraft: async (id, draft) => {
      await applyDraftProposal(
        id,
        draft.title,
        draft.description,
        draft.sources,
        draft.considerations,
      );
    },
  },
};
