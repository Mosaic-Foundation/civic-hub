// Drafting-assistant config for civic.vote — declared by the vote handler
// via ProcessHandler.getAssistantConfig. See proposalAssistantConfig.ts for
// the pattern.

import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";
import {
  getVoteDraft,
  appendVoteConversation,
  saveVoteReviewResult,
  applyVoteDraftProposal,
} from "../modules/civic.vote_drafts/index.js";

const VOTE_BEST_PRACTICES = `# Vote Best Practices — Civic Hub

**Audience.** This document is loaded into the drafting assistant's runtime context when a user is creating a vote. It is not shown to users. The assistant uses it as evaluation criteria when reviewing user-written vote drafts and as guidance when generating first drafts during the brainstorm flow.

**Hardness.** None of these criteria are hard requirements. Hard blocks are governed by the Code of Conduct only.

**Default posture.** Be actively helpful when the vote draft has substantive gaps. Don't nitpick — a vote that is clear enough for neighbors to understand belongs in the community, not stuck in review.

## Title — the question being posed

The title IS the vote question. It should be phrased as something neighbors can meaningfully say yes or no to (or choose between options on). Strong titles are specific enough that a voter scrolling the list understands what they're weighing in on without opening the details.

Weak: *"Traffic issues"*, *"We need change"*, *"Library funding"*
Strong: *"Should Floyd County add sidewalks on Main Street between First and Third?"*, *"Should the county extend library hours to include Sundays?"*, *"Should Floyd allow food trucks on Main Street during the Saturday market?"*

Flag titles that are topics rather than questions. A vote title should be something a voter can respond to.

## Description — voter context

The description gives voters what they need to make an informed choice. It should answer:
1. **What is being asked** — restate or elaborate on the question if the title is concise
2. **Why it matters** — who is affected, what's the current situation, what would change
3. **What voters should know** — relevant facts, context, constraints

The description does NOT need to be long. Two to four sentences often suffice. The goal is informing, not persuading.

Flag descriptions that are purely persuasive (one-sided advocacy) without providing context for the other perspective. A vote question should let the community decide — the framing should be fair enough that a voter on either side doesn't feel the question is rigged.

## Sources

When a vote description makes empirical claims, sources strengthen credibility. The same standards as proposals apply: government documents, official records, established news outlets, public meeting minutes.

Flag unsourced empirical claims. Don't flag preferences, opinions, or experience.

## Balance

Votes are inherently about letting the community decide. The framing of the question and description should be fair:
- Don't use loaded language that presupposes the answer (*"Should we finally fix the dangerous intersection..."*)
- Present enough context that a voter on either side can make an informed choice
- If the topic is contested, acknowledge that reasonable people disagree

Flag framing that is so one-sided it functions as advocacy rather than a genuine question to the community.

## Duration awareness

The user will select how long the vote stays open (2 weeks to 3 months). The assistant does not need to advise on duration — that's a user choice. Don't comment on or suggest duration changes.

## Scope

Each vote should pose ONE clear question. If a draft bundles multiple distinct questions, suggest splitting into separate votes.

## When generating first drafts

Same constraints as proposals:
- Use the user's words and framing
- Don't invent facts or sources
- Keep it short — a starting point, not a finished product
- Write in everyday language
- Frame as a genuine question, not a position statement`;

export const voteAssistantConfig: AssistantTypeConfig = {
  contentNoun: "vote",
  greeting:
    "Happy to help. I'll ask a few quick questions to shape the vote question, then I can put together a starting draft you can edit. You can also skip ahead and write on your own at any point.",
  kickoffMessage: "I want to suggest a vote for the community.",
  returningGreeting:
    "I can see your draft so far. Ask me to review it, sharpen the question, or find sources — or tell me what you're working on.",
  bestPractices: VOTE_BEST_PRACTICES,
  bestPracticesTitle: "Vote Best Practices",
  brainstormGuidance: `For votes: What should the community vote on? What's the question you want to put to your neighbors? Why does this matter now? What context should voters have to make an informed decision?`,
  reviewEmptyFieldsGuidance: `After evaluating the draft content, check for empty optional fields (description, sources). For each empty field that would strengthen this particular vote, mention it in your message — briefly explain what it could add and offer to help fill it in. These are NOT suggestions (don't add them to the suggestions array) — just a conversational nudge. Always make it clear the user can submit without filling those fields.`,
  typeGuidance: `## Vote guidance
Votes are questions to the community. Focus on helping the user frame a clear, fair question that neighbors can meaningfully respond to. Ensure the description provides balanced context. Don't advise on vote duration — that's the user's choice.`,
  fields: ["title", "description", "sources"],
  supportsCategories: false,
  fieldGuidance: [
    {
      field: "title",
      hint: "Phrase it as a question neighbors can answer — not a topic.",
      example: "Should the county extend library hours to include Sundays?",
    },
    {
      field: "description",
      hint: "Give voters fair context: what's being asked, who's affected, and what would change. Inform, don't persuade.",
      example:
        "The library closes at 5pm on weekends. Sunday hours would cost about one staff shift; the board wants to know if residents would use them.",
    },
    {
      field: "sources",
      hint: "Link sources for any factual claims so voters can verify them.",
    },
  ],
  draftStore: {
    async get(id) {
      const draft = await getVoteDraft(id);
      if (!draft) return undefined;
      return { ...draft, considerations: "" };
    },
    appendConversation: (id, userMessage, assistantMessage) =>
      appendVoteConversation(id, userMessage, assistantMessage),
    saveReviewResult: (id, suggestions) => saveVoteReviewResult(id, suggestions),
    applyGeneratedDraft: async (id, draft) => {
      await applyVoteDraftProposal(id, draft.title, draft.description, draft.sources);
    },
  },
};
