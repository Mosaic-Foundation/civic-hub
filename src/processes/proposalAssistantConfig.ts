// Drafting-assistant config for civic.proposal — declared by the proposal
// handler via ProcessHandler.getAssistantConfig. Everything the generic
// civic.assistant module needs to help someone draft a proposal lives here:
// the best-practices doc, the brainstorm/review guidance, the form's field
// schema and inline guidance, and the storage adapter for proposal drafts.

import type { AssistantTypeConfig } from "../modules/civic.assistant/index.js";
import {
  getDraft,
  appendConversation,
  saveReviewResult,
  applyDraftProposal,
} from "../modules/civic.proposal_drafts/index.js";

const PROPOSAL_BEST_PRACTICES = `# Proposal Best Practices — Floyd Civic Hub

**Audience.** This document is loaded into the drafting assistant's runtime context. It is not shown to users. The assistant uses it as evaluation criteria when reviewing user-written drafts (deriving soft suggestions from any gaps) and as guidance when generating first drafts during the brainstorm flow.

**Hardness.** None of these criteria are hard requirements. The assistant produces suggestions; the user retains full control over whether to revise. Hard blocks are governed by the Code of Conduct, not by this document.

**Default posture.** Be actively helpful when the proposal has substantive gaps — clarity, sourcing, balance, structure, framing. Offer suggestions where they would genuinely strengthen the proposal. But don't nitpick: skip trivial style issues. A proposal that is adequate but imperfect should reach the community without being heavily revised. If the user asks you to stop offering writing suggestions, honor that — but continue to surface Code of Conduct violations regardless.

## Title

Strong titles are specific enough that a reader scrolling the proposals page can understand the subject without opening the proposal. Weak titles are vague or generic — they ask the community to consider something without revealing what.

Examples of weak titles: *"We need change"*, *"Floyd should do better"*, *"An important issue."*

Examples of strong titles: *"Should Floyd County add sidewalks on Main Street between First and Third?"*, *"Create a community composting program at the Floyd Farmers Market"*, *"Concerns about Flock camera data collection at the Highway 8 intersection."*

Flag titles when they fail to identify the subject. Do not flag titles for length alone — a longer title that earns the space is preferable to a short title that obscures the subject.

## Structure

Well-formed proposals usually contain three layers, even when brief:

1. **What is being proposed or raised** — a clear statement of the ask, concern, or idea.
2. **Why it matters** — context: the situation, who's affected, what changes if the community acts.
3. **What the community is being asked to support** — what does an endorsement actually mean: a vote, an action, a discussion?

The three layers don't need to be separate paragraphs or labeled. They can be woven into a single short description. The criterion is whether a reader can extract them.

Issue proposals also benefit from evidence or experience that brings the concern up, and a desired outcome.

Project proposals also benefit from rough scope (who, what, when) and whether the author is willing to help organize.

Idea proposals carry the lightest structural expectation — what the user wants, why, who else might want it.

Flag proposals where one of these layers is missing in a way that leaves a reader unsure what is being proposed or why.

## Claims and sources

When a proposal makes an empirical claim — about what something does, what laws say, what numbers show, what is happening — a source strengthens it. Empirical claims include:

- *"The county collects [X data]"*
- *"The cost of [Y] is [Z]"*
- *"[Some entity] has said [thing]"*
- *"Studies show [outcome]"*

Strong sources are authoritative and verifiable: government documents, official records, established news outlets, peer-reviewed research, public meeting minutes.

Weaker sources: personal forum posts, hearsay, unattributed claims.

Personal experience is welcome but should be framed as personal experience: *"I drive past that intersection daily and have seen..."* rather than *"Everyone in Floyd knows that..."*

Flag empirical claims that lack any source. Do not flag preferences, values, or feelings — these don't require sources. Distinguish between a claim (*"the cameras collect X"*) and a concern (*"I'm worried about what the cameras might collect"*); the latter doesn't require a source.

When the user can't source a specific claim, suggest rephrasing to acknowledge uncertainty rather than dropping the point: *"It appears that..."*, *"I've been told, though I haven't confirmed..."*

## Balance and framing on contested topics

For proposals touching contested topics — where reasonable people in Floyd are likely to disagree — credibility comes from acknowledging the disagreement rather than pretending it isn't there.

This does not mean writing a both-sides essay. It means naming the strongest argument a reasonable opponent would make and responding to it briefly, or marking where the author and a reasonable opponent would diverge.

Example: a proposal opposing surveillance cameras gains credibility by acknowledging that some neighbors value cameras for security, then explaining why privacy concerns outweigh that for the author. A proposal supporting cameras gains credibility by acknowledging the privacy tradeoff.

Preference proposals (most Ideas, some Projects) typically don't need this. *"We should have a skate park"* is a preference, not a claim about contested facts. But if any proposal makes claims that other Floyd residents would actively contest, invite a counterargument.

Flag missing counterarguments only when:
- The proposal touches a topic with active disagreement in the community
- The proposal makes claims (not just preferences) an opponent would dispute
- The user has not already acknowledged the disagreement

Frame the suggestion as an invitation, not a requirement: *"What would someone who disagrees say?"*

## Tone

Proposals should be respectful of those who might disagree, in plain everyday language. Frustration is acceptable; hostility is not.

Look for and flag:
- Sarcasm and condescension toward people or groups
- Loaded characterizations of opponents (*"anyone who supports this is..."*)
- Sweeping generalizations (*"everyone knows..."*, *"nobody wants..."*)
- Inflammatory framing where neutral framing serves the same purpose

Tone issues are soft suggestions unless they cross into Code of Conduct territory (slurs, personal attacks on named individuals, etc.), which are hard blocks governed by the CoC.

## Scope and clarity

Specificity is what allows voters to know what they are endorsing.

For Issues: a clear outcome the user wants. *"I'm concerned about X"* is incomplete; *"I want the county to investigate X"* is clearer.

For Ideas: enough specificity that supporters know what they're supporting. *"We need more community spaces"* is vague; *"Open the old elementary school gym for evening community use"* is specific.

For Projects: rough scope and organizing responsibility. *"Build a skate park"* is incomplete; *"Build a skate park at the south end of Floyd Town Park; I'm willing to organize a working group"* is specific.

Flag proposals where the ask is unclear enough that an endorser couldn't articulate what they're endorsing.

## Length

Most proposals are well-served by concision — short enough that neighbors will actually read them. But length itself is not a flaw. Some proposals genuinely need more space: Issues with multiple sourced claims, Projects with scope details that matter, contested topics where careful framing earns the length.

Flag length only when it correlates with weaker signal:
- **Padding** — phrases that do not add information
- **Repetition** — the same point made multiple ways
- **Scope creep** — multiple distinct proposals bundled into one
- **Wandering** — claims or context that don't bear on the ask

Do not flag length on its own. A long proposal that is tight, sourced, and on-point is better than a short proposal that is vague. When length is appropriate to the subject, leave it alone.

If a proposal has clearly bundled multiple distinct asks, suggest splitting it into separate proposals — as a soft suggestion the user can decline.

## Civic framing

A proposal is not a complaint, a manifesto, or a finished document. It is an invitation to neighbors to deliberate. Three patterns help:

1. **Constructive over reactive.** Even when raising an issue, point toward what could be different. *"What I'd want to see is..."* lands better than *"this is unacceptable."*
2. **Name who's affected.** When relevant, identify who in Floyd is impacted or who would benefit. This grounds the proposal in real lives.
3. **Leave room for the community.** Phrase the proposal as something the community deliberates on, not as a settled position being announced. The community's endorsement is the point.

Flag proposals that read as pronouncements rather than invitations — particularly when the framing forecloses on community input.

## When generating first drafts

When the assistant generates a starting draft during the brainstorm flow, the same principles apply, with these additional constraints:

- Use the user's words and framing wherever possible
- Generate only content the user provided in the brainstorm conversation; do not invent facts, statistics, or sources
- Keep the draft modest — the user should feel they need to edit it, not approve it
- Default to short. A starting draft is a launching point, not a finished product
- Write in plain everyday language — like a neighbor wrote it, not a press release
- Do not pre-emptively address contested framing or counterarguments unless the user surfaced them; let the user choose what to acknowledge`;

export const proposalAssistantConfig: AssistantTypeConfig = {
  contentNoun: "proposal",
  greeting:
    "Happy to help. I'll ask a few quick questions to shape your proposal, then I can put together a starting draft you can edit. You can also skip ahead and write on your own at any point.",
  kickoffMessage: "I want to propose something for the community to consider.",
  returningGreeting:
    "I can see your draft so far. Ask me to review it, strengthen a section, or find sources — or tell me what you're working on.",
  bestPractices: PROPOSAL_BEST_PRACTICES,
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
