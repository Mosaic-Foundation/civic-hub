// Embedded hub documents for the proposal drafting assistant.
//
// Vercel serverless functions don't reliably bundle non-imported files,
// so these are inlined as string constants rather than read from disk.
// To update: edit the source .md files in config/hubs/floyd/ and copy
// the content here.

export const CODE_OF_CONDUCT = `# Code of Conduct

*Last updated: 2026-08-10*
*Version: 1.1*

The Floyd Civic Hub is a place for residents of Floyd County to engage with each other and with local government. For that to work, everyone needs to be able to participate without being harassed, attacked, or drowned out. This Code of Conduct describes how we keep the Hub civil — and, just as important, how we avoid the far worse problem of silencing opinions we happen to disagree with.

## Our north star: decorum, not opinion

We moderate how you say things. We do not moderate *what you think*.

You can disagree sharply with your neighbor. You can criticize the Board of Supervisors. You can argue that a policy is wrong, short-sighted, or unfair. You can be frustrated, passionate, and direct. We believe civic life gets *better* when residents speak up, even about things that make other residents uncomfortable — so we will not remove your contribution just because someone finds your view unpopular.

What we will not tolerate is a handful of behaviors that make it impossible for others to participate. Those are listed below.

## What we may remove

Content that:

- **Attacks a person** rather than an idea. "Your argument ignores X" is fair game. "You're an idiot for thinking that" is not.
- **Harasses, threatens, or intimidates** another user, an official, or any identifiable person. This includes sustained targeting of an individual across multiple posts or comments.
- **Uses slurs or targets people for who they are** — based on race, ethnicity, religion, national origin, sex, gender identity, sexual orientation, disability, or age. Criticism of groups' *actions* is permitted; dehumanizing attacks on who they are is not.
- **Shares someone's private information without consent** (doxxing), including home addresses, phone numbers not already public, workplace details, or medical information. Public officials' publicly listed contact information is fair to share.
- **Imports or reposts private content about specific people from other platforms** — for example, screenshots or copied social-media posts. Keep discussion on the Hub self-contained: engage with what people say *here*, not with what they said somewhere else. Linking to authoritative or official sources as references is permitted.
- **Is spam or obvious off-topic noise** — repetitive posts, commercial solicitation, or content unrelated to Floyd County civic matters.
- **Impersonates another person** or misrepresents your identity or affiliation to mislead others.
- **Endangers or sexualizes minors** in any way.
- **Incites imminent violence** or provides specific targets and means for harm.

## What we will not remove

We will not remove:

- Opinions you disagree with, even strongly.
- Civil criticism of elected officials, county employees, or any public figure acting in a public capacity.
- Accurate statements of fact that someone finds embarrassing or inconvenient.
- Dissenting views on policy — budgets, ordinances, land use, public safety, schools, or any other civic topic.
- Rhetoric that is blunt, emotional, or forceful, as long as it sticks to ideas rather than attacking people.

If you complain to us that a post should be removed because it's "wrong" or "hurtful" without specifying how it violates the rules above, we will decline and explain why. A Civic Hub that removes content based on popularity is not a civic hub at all.

## How moderation works

- An admin reviews reported content and content they encounter in the normal course of running the Hub.
- If the admin concludes a piece of content violates this Code, they remove it and note the reason in an internal log.
- Where we can identify how to reach you, we'll tell you your content was removed and why.
- If you disagree, you can appeal by emailing contact@civic.social. A human will re-examine the decision. We aim to respond within 7 days.
- Removal decisions are made by admins, not by an algorithm. This means they won't be instant, but they also won't be arbitrary.

## Repeat violations

Most violations are one-off. If someone violates the Code repeatedly or severely, we may:

- Temporarily restrict their account (read-only for a period).
- Permanently close their account.
- In cases involving credible threats or illegal activity, report the matter to the appropriate authorities.

These are last resorts. Our first move is always to remove the specific piece of content and move on.

## Transparency

We commit to being honest about our moderation:

- This Code is public and doesn't change quietly. Any substantive revision will be announced.
- The admin who runs the Hub and makes moderation decisions is named on our About page.
- We are willing to publish aggregate moderation statistics (e.g., "12 items removed this quarter, primarily for personal attacks") if residents ask. We will not publish the specific content removed or identify individual users.

## Things admins won't do

- Admins won't use their moderation privileges to silence critics of themselves or the Board.
- Admins won't remove content based on its political viewpoint.
- Admins won't moderate in secret — every removal is logged.
- Admins won't share information about one resident with another except as required by law or safety.

If you believe an admin has violated any of these, tell us at contact@civic.social. If the admin is the subject of the complaint, we'll escalate to an independent reviewer.

## Contact

To report a Code of Conduct violation or appeal a moderation decision:

contact@civic.social

Please include the URL of the content or a description of the situation, and what specifically you believe violates (or doesn't) this Code.`;

export const PROPOSAL_BEST_PRACTICES = `# Proposal Best Practices — Floyd Civic Hub

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

export const VOTE_BEST_PRACTICES = `# Vote Best Practices — Civic Hub

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

export const PROJECT_BEST_PRACTICES = `# Project Best Practices — Civic Hub

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
