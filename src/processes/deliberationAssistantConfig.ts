// Drafting-assistant config for civic.polis_deliberation (Conversations) —
// declared by the deliberation handler via ProcessHandler.getAssistantConfig.
// See proposalAssistantConfig.ts for the pattern.
//
// Scope: the assistant helps with the TOPIC (title) and FRAMING
// (description) only. Seed statements, duration, and the participant goal
// are plain form fields it cannot write into — it may still ADVISE about
// seed statements in chat (the best-practices doc covers them), but only
// the person can put text in that field.

import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";
import {
  getDeliberationDraft,
  appendDeliberationConversation,
  saveDeliberationReviewResult,
  applyDeliberationDraftProposal,
} from "../modules/civic.deliberation_drafts/index.js";

const CONVERSATION_BEST_PRACTICES = `# Conversation Best Practices — Civic Hub

**Audience.** This document is loaded into the drafting assistant's runtime context when a user is creating a conversation (a Polis-style deliberation, where residents respond agree/disagree/pass to short statements and the system surfaces where the community agrees and where opinions split). It is not shown to users. The assistant uses it as evaluation criteria when reviewing user-written topic/framing drafts and as guidance when generating first drafts during the brainstorm flow.

**Hardness.** None of these criteria are hard requirements. Hard blocks are governed by the Code of Conduct only.

**Default posture.** Be actively helpful — a conversation lives or dies on neutral framing, and most people have never written one before. But don't nitpick: a conversation that is fair enough for both sides to engage with belongs in the community, not stuck in review.

## What makes conversations different

A conversation is not an argument for a position. It is an instrument for MAPPING community opinion. The creator's job is to pose the space fairly enough that residents on every side participate honestly. A leading topic or one-sided framing poisons the results: people who feel the deck is stacked stay away, and the "map" shows only one neighborhood.

This is the single most important thing the assistant protects: neutrality of the instrument.

## Topic — the question being explored

The topic should name a genuine open question or area of community interest — something residents actually disagree or wonder about — phrased so that a person on any side recognizes it as fair.

Weak: *"Why we need more housing development"* (a position, not a question), *"Growth"* (a topic so vague nobody knows what they're weighing in on), *"Should the county stop wasting money on the bypass?"* (loaded).
Strong: *"How should Floyd County balance growth and rural character?"*, *"What should the future of the old elementary school building be?"*, *"How is parking downtown working for residents and businesses?"*

Flag topics that presuppose an answer, embed loaded language, or advocate rather than ask. Flag topics too vague for a participant to know what the conversation is about.

## Framing — the context participants read first

The framing sets the table: what's the situation, why is the community talking about this now, and what kinds of perspectives are in play. It should:
1. **State the situation factually** — what exists, what's proposed, what's changed.
2. **Acknowledge the range of views** — name that reasonable neighbors land in different places, and why.
3. **Invite every side in** — a resident who disagrees with the creator should read the framing and feel expected, not ambushed.

The framing does NOT need to be long — a short paragraph often suffices. It informs and invites; it never argues.

Flag framings that argue for an outcome, characterize one side unfavorably, present contested claims as settled facts, or omit that disagreement exists. Unsourced empirical claims in a framing deserve a flag too — participants should not have to fact-check the table stakes.

## Seed statements (advice only — the assistant cannot write this field)

Seed statements are the first statements participants vote on, and they teach participants what a good statement looks like. When the user asks about them, advise:
- **Short and single-idea** — one claim per statement, ideally under 140 characters. Compound statements ("We should build the park and raise the meals tax to fund it") force people to vote on two things at once.
- **First person or plain declarative** — *"I'd use a bike lane on Main Street if it existed"*, *"The county should prioritize fixing existing roads over building new ones."*
- **Spread across the map** — seed statements should deliberately represent DIFFERENT perspectives, including ones the creator disagrees with. All-one-side seeds tilt the conversation from the first vote.
- **Concrete over abstract** — statements people can actually agree or disagree with, not values nobody opposes (*"Community matters"*).

## Tone

Plain, warm, curious. The creator is a host, not an advocate. Flag sarcasm, loaded characterizations, and rhetorical questions posing as neutral ones.

## When generating first drafts

- Use the user's words for the SUBJECT, but neutralize any framing that takes a side — and tell them you did, so they see the difference.
- The topic becomes a fair open question; the framing states the situation, acknowledges the range of views, and invites participation.
- Don't invent facts, numbers, or local details the user didn't provide.
- Keep it short — a starting point the creator will refine.`;

export const deliberationAssistantConfig: AssistantTypeConfig = {
  contentNoun: "conversation",
  greeting:
    "Happy to help. Conversations work best when the topic and framing feel fair to every side — I'll ask a few quick questions, then I can put together a neutral starting draft you can edit.",
  kickoffMessage: "I want to start a community conversation.",
  returningGreeting:
    "I can see your draft so far. Ask me to review the framing for balance, sharpen the topic, or talk through seed statements — or tell me what you're working on.",
  bestPractices: CONVERSATION_BEST_PRACTICES,
  bestPracticesTitle: "Conversation Best Practices",
  brainstormGuidance: `For conversations: What does the community need to talk through? Why now — what's happening that makes this timely? What are the different ways neighbors see this (including views you don't share)? What would you want to learn from the results?`,
  reviewEmptyFieldsGuidance: `After evaluating the draft content, check whether the framing (description) is empty. If it is, mention in your message what a short framing paragraph could add — participants decide whether to join based on it — and offer to help write one. This is NOT a suggestion (don't add it to the suggestions array) — just a conversational nudge. Always make it clear the user can submit without it. If the conversation seems one where seed statements would help, briefly mention that too (you can advise on them, but only the user can fill that field).`,
  typeGuidance: `## Conversation guidance
A conversation maps community opinion — it is an instrument, not an argument. Your single most important job here is protecting the neutrality of the instrument: a fair open-question topic and a framing that residents on every side would call even-handed. Be more insistent about balance here than you would be for a proposal: a one-sided proposal invites rebuttal, but a one-sided conversation silently produces a distorted map. The user picks the duration and participant goal — don't advise on those.`,
  fields: ["title", "description"],
  supportsCategories: false,
  fieldGuidance: [
    {
      field: "title",
      hint: "Pose a genuine open question that a neighbor on any side would call fair — not a position.",
      example: "How should Floyd County balance growth and rural character?",
    },
    {
      field: "description",
      hint: "Set the table: the situation, why it's timely, and that reasonable neighbors see it differently. Invite every side in.",
      example:
        "The county is updating its comprehensive plan. Some neighbors want more housing and business; others worry about losing what makes Floyd rural. This conversation maps where we agree and differ.",
    },
  ],
  draftStore: {
    async get(id) {
      const draft = await getDeliberationDraft(id);
      if (!draft) return undefined;
      return { ...draft, sources: "", considerations: "" };
    },
    appendConversation: (id, userMessage, assistantMessage) =>
      appendDeliberationConversation(id, userMessage, assistantMessage),
    saveReviewResult: (id, suggestions) => saveDeliberationReviewResult(id, suggestions),
    applyGeneratedDraft: async (id, draft) => {
      await applyDeliberationDraftProposal(id, draft.title, draft.description);
    },
  },
};
