// Drafting-assistant config for civic.project — declared by the project
// handler via ProcessHandler.getAssistantConfig. See
// proposalAssistantConfig.ts for the pattern.

import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";
import {
  getProjectDraft,
  appendProjectConversation,
  saveProjectReviewResult,
  applyProjectDraftProposal,
} from "../modules/civic.project_drafts/index.js";

const PROJECT_BEST_PRACTICES = `# Project Best Practices — Civic Hub

**Audience.** This document is loaded into the drafting assistant's runtime context when a user is creating a community project page. It is not shown to users. The assistant uses it as evaluation criteria when reviewing user-written project descriptions and as guidance when generating first drafts during the brainstorm flow.

**Hardness.** None of these criteria are hard requirements. Hard blocks are governed by the Code of Conduct only.

**Default posture.** Be actively helpful when the project draft has substantive gaps. Don't nitpick — a project page that is clear enough for neighbors to understand what's happening belongs in the community, not stuck in review.

## Title — what the project is

The title should clearly name the project or initiative. It should be specific enough that someone scrolling a list of projects can tell what it's about without clicking through.

Weak: *"Community improvement"*, *"Let's do something"*, *"New project"*
Strong: *"Community garden at the old rec center lot"*, *"Neighborhood watch program for Elm Street"*, *"Free tutoring program at the public library"*

Flag titles that are vague topics rather than identifiable projects.

## Description — what, who, why, how

The description is a living document that explains the project to the community. It should answer:
1. **What** — what is being built, organized, or done
2. **Who** — who benefits, who is involved or needed
3. **Why** — why this matters to the community
4. **How** — rough plan, timeline, or next steps (as much as the creator knows)

The description does NOT need to be exhaustive — projects are living pages that get updates over time. A clear starting description is enough. The creator can edit and expand it as the project develops.

Flag descriptions that are purely abstract (no concrete action or plan) or that make large claims without any supporting detail.

## Sources

When a project description makes empirical claims (cost estimates, statistics, comparable examples), sources strengthen credibility. Link to relevant government documents, official records, news articles, or comparable project examples.

Don't require sources for preferences, plans, or intentions. A community garden project doesn't need citations — but if the creator claims "the lot is city-owned and available," that's worth sourcing.

## Tone

Projects are action-oriented — someone is doing or organizing something. The tone should be:
- Practical and concrete, not abstract or philosophical
- Inviting — written to attract participants and supporters, not to lecture
- Honest about what's known and unknown — "we're still figuring out funding" is better than silence on the topic

Flag language that is primarily complaint-oriented with no constructive element. A project page should describe what IS being done, not just what's wrong.

## Scope

Each project page should describe ONE coherent initiative. If a draft bundles unrelated efforts, suggest splitting into separate projects.

## When generating first drafts

- Use the user's words and framing
- Don't invent facts, costs, timelines, or sources
- Keep it short — a starting point the creator will expand over time
- Write in everyday language, like a neighbor explaining a project at a community meeting
- Focus on the concrete: what will happen, who will be involved, what's the first step`;

export const projectAssistantConfig: AssistantTypeConfig = {
  contentNoun: "project",
  greeting:
    "Happy to help. I'll ask a few quick questions to shape your project page, then I can put together a starting draft you can edit. You can also skip ahead and write on your own at any point.",
  kickoffMessage: "I want to start a community project.",
  returningGreeting:
    "I can see your draft so far. Ask me to review it, make it more concrete, or find sources — or tell me what you're working on.",
  bestPractices: PROJECT_BEST_PRACTICES,
  bestPracticesTitle: "Project Best Practices",
  brainstormGuidance: `For projects: What are you building or organizing? Who would it serve or involve? What resources, skills, or help do you need? What's the rough timeline or first steps? Are you leading this yourself or looking for someone to take it on?`,
  reviewEmptyFieldsGuidance: `After evaluating the draft content, check for empty optional fields (description, sources). For each empty field that would strengthen this particular project, mention it in your message — briefly explain what it could add and offer to help fill it in. These are NOT suggestions (don't add them to the suggestions array) — just a conversational nudge. Always make it clear the user can submit without filling those fields.`,
  typeGuidance: `## Project guidance
Projects are action-oriented living pages. Focus on helping the user describe what they're building or organizing clearly enough that neighbors can understand and decide whether to support or get involved. Projects are editable after creation — the initial description is a starting point. Encourage concrete details: who benefits, what's needed, what the first step is.`,
  fields: ["title", "description", "sources"],
  supportsCategories: false,
  fieldGuidance: [
    {
      field: "title",
      hint: "Name the project concretely enough to recognize in a list.",
      example: "Community garden at the old rec center lot",
    },
    {
      field: "description",
      hint: "Say what's being done, who it serves, why it matters, and the rough next steps. You can expand it as the project develops.",
      example:
        "Turning the empty lot behind the rec center into ten garden beds. Looking for five neighbors to help build them this fall.",
    },
    {
      field: "sources",
      hint: "Link cost estimates, comparable projects, or official documents you mention.",
    },
  ],
  draftStore: {
    async get(id) {
      const draft = await getProjectDraft(id);
      if (!draft) return undefined;
      return { ...draft, considerations: "" };
    },
    appendConversation: (id, userMessage, assistantMessage) =>
      appendProjectConversation(id, userMessage, assistantMessage),
    saveReviewResult: (id, suggestions) => saveProjectReviewResult(id, suggestions),
    applyGeneratedDraft: async (id, draft) => {
      await applyProjectDraftProposal(id, draft.title, draft.description, draft.sources);
    },
  },
};
