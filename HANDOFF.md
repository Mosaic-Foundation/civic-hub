# HANDOFF.md — Civic Hub Build Log

Updated after every Claude Code session. Records what was built, what's incomplete, and open questions.

---

## Outcomes page on the shared list-page skeleton — 2026-09-06

**Working in:** `civic-hub/ui/src/pages/Outcomes.tsx`, `Outcomes.css`

Adam, on desktop: Outcomes was "much narrower than all of the other
pages", had too little room under the tab strip, and was missing the
"Floyd County, Virginia" block every other section page opens with.

Cause: the page rendered its own `<header>` inside a `.outcomes-page`
capped at 780px, and never mounted `HubInfo`. The list pages (Votes,
Proposals, Projects, Conversations) are all `page page-home` → `<HubInfo />`
→ `.section` blocks with `.section-title` / `.section-description`, at
the shared width with the shared 1.5rem gutter.

Outcomes now uses exactly that skeleton. The bespoke width/header CSS is
gone from `Outcomes.css`; only the outcomes-specific pieces (filter bar,
count, row headline) remain. The 2026-09-04 phone-padding fix that lived
in `.outcomes-page` is now supplied by `.section`, so nothing regressed.

Verified on dev: at 1100px Votes and Outcomes both show HubInfo and
1052px cards; at 375px the cards keep the 1.5rem gutter with no
horizontal scroll.

## A process can no longer be offered as a link target for itself — 2026-09-06

**Working in:** `civic-hub/ui/src/components/` (+ `pages/ProjectDraft.tsx`)

Adam, editing the microgrid project on his phone: the related-process
picker suggested the project itself — its own title is the best match for
its own draft, so it was the top suggestion. The server already refused a
self-link at submit (`validateLink` → `self_link`, run with the real id in
`processEdits.ts` and the review service), so the bug was UI-only: the
picker was never told which process it was editing.

### What changed

- **`ProcessLinkField`** — new `selfId?: string` prop, folded into the
  picker's existing `exclude` list alongside already-picked targets. The
  server-side candidate search honours `exclude` for both the auto-suggest
  and typed-search paths, so the process disappears from both.
- **All four draft forms** (`ProjectDraftingForm`, `DraftingForm`,
  `VoteDraftingForm`, `DeliberationDraftingForm`) — new `linkSelfId?`
  prop threaded to the field. Only project editing exists today; any type
  that adopts editing passes its id and inherits the exclusion.
- **`ProjectDraft`** — passes `linkSelfId={editProcessId}`.
- A brand-new draft has no process id yet and leaves it unset — nothing to
  exclude, nothing changes.

### Also: picker candidate rows

The results list had the same squeeze as the picked-link rows fixed
earlier today: a no-shrink type label beside the title left a phone-width
title two words per line. Now the title takes the full row and the type
label sits beneath it (`ProcessLinkPicker.css`).

### Verified on dev at 375px

Skate park project (`proc_beta_dev_skatepark_001`) edit page as its
creator: suggestion request carries `exclude=proc_beta_dev_skatepark_001`;
typing "skate" returns only the recreation conversation; curl without the
exclusion returns the project, with it does not. Candidate title spans the
row (219px, three lines) with CONVERSATION below. `uitest_` session deleted;
nine stale `[uitest]` project drafts from 2026-09-04 deleted as well.

## Related-process links in draft forms: title on its own line — 2026-09-06

**Working in:** `civic-hub/ui/src/components/ProcessLinkField.css`

Adam, on his phone, linking the microgrid project to the outages
conversation: the linked row read "IMPLEMENTS", then the title one word
per line down a narrow column, then "CONVERSATION ×". He asked whether
this was projects-only.

**Universal.** All four draft forms (proposal, vote, project, conversation)
render the same `ProcessLinkField`, so the fix is one CSS change. The row
was a single flex line with three no-shrink labels (relation, type, ×) and
the title in whatever remained — about 80px on a 375px phone.

Now a two-line grid per link: relation + type + × on top, the title below
at full width. Named grid areas keep the DOM order (relation, title, type,
×) for screen readers. The published-page list (`RelatedProcesses`) already
wrapped and was not the problem.

Verified on dev at 375px with a project draft linked to
`proc_beta_conv_energy_001`: relation and type on one line, × at the right
edge, title full-width below wrapping to two lines. Test draft and
`uitest_` session deleted.

## Approval-vote option rows grow to show the whole option — 2026-09-05

**Working in:** `civic-hub/ui/src/components/`

Adam, testing approval voting on his phone (2026-09-05): the assistant
generated seven options that applied correctly, but "when I view the
options, it's the same issue that I had with the title before. You can't
see the whole text, and it's hard to scroll." Each option was a single-line
`<input>`; anything past ~40 characters on a phone scrolled off the end.

He asked for expandable boxes sized to the option — with a cap on how far
they grow.

### What changed

- **`GrowingLineInput.tsx` (new)** — the *controlled* sibling of
  `TitleField`: a `<textarea rows={1}>` that sizes itself to its content on
  every value change (typing, an applied suggestion, a resumed draft), up to
  `maxLines` (default 6), then scrolls inside the box. Still one line
  semantically: Enter is blocked, pasted newlines flatten to spaces. Reusable
  by any repeater whose rows are short-but-not-single-line values.
- **`VoteDraftingForm.tsx`** — each `.approval-option-input` is now a
  `GrowingLineInput` (same `maxLength={200}`, same `handleOptionChange`).
- **`VoteDraftingForm.css`** — `.growing-line-input` (resize none, line-height
  1.4); option rows align `flex-start` so the × stays on the first line as a
  row grows.

### Why a 6-line cap

Options are capped at 200 characters. On a 375px phone that wraps to about
seven lines, so 6 shows nearly every legal option in full and only the very
longest scroll their last line. Measured on dev: a 151-char option fit
without scrolling (147px); a 187-char one showed six of seven lines and
scrolled. An unbounded box would push the rest of the list around.

### Verified on dev (mobile 375×812, dev resident)

- Short option: one line (40px). Long: grows. Over cap: 6 lines + inner scroll.
- Typing grows the row live (40 → 83 → 104px); Enter is prevented; a pasted
  `\n` becomes a space.
- × aligned to the top of every row (5px inset) regardless of height.
- Test draft and `uitest_` session deleted afterward.

**Scope:** vote-specific (only approval options use it today), but the
component is generic — the same grow-with-cap pattern as `TitleField` and
`SeedStatementRows`, now in a reusable controlled form.

## Admin review buttons went missing between reviews — 2026-09-05

Adam reported the Approve / Request changes / Decline buttons sometimes absent on a review, refresh
bringing them back. On follow-up, most of what he saw was NOT this bug: the phone case was the
creator account viewing its own submission at /my-submissions (correctly no admin buttons), and the
desktop two-tab case was almost certainly a tab left open from before the creator's revise-resubmit
(status changes_requested → no buttons) that a refresh re-fetched as pending — ordinary staleness in
a page that does not live-update, not a defect. `reviseAndResubmit` does return the review to
pending_review (service.ts), so a fresh load always shows the buttons.

The bug BELOW is a real, separate one found while investigating — NOT the thing Adam saw. Kept
because it is a genuine correctness fix, low-risk.

Not caching. `AdminReviews` is one page that switches between list and detail by the `:id` route
param, and the buttons render only while `isPending && !actionMessage` (and while no changes/decline
form is open). The effect that loads a review when `routeId` changes re-fetched the detail but reset
none of the per-review UI state. So moving between reviews WITHOUT a full page reload — an email
link followed in the same tab, the in-app list, or browser back/forward (all client-side route
changes) — carried the previous review's `actionMessage` or open form across, and `!actionMessage`
hid the buttons on a review that was genuinely pending. A hard refresh remounted the page, cleared
the state, and the buttons returned — exactly the symptom.

Fix: the `routeId` effect now clears `detail`, `actionMessage`, the changes/decline forms and note
before loading the next review. Clearing `detail` also stops one review's content showing while the
next loads.

Verified on dev as admin: opened review A's "Request changes" form (buttons hidden), then
client-navigated to review B by popstate (what back/forward does, no reload) — B showed all three
buttons, no stale form, no stale message, status pending. Neither review was mutated (only a form
was opened). UI build clean.

## Vote assistant fields follow the voting method — 2026-09-05

Adam, creating an approval vote on his phone: he pasted five options and asked the assistant to add
them; it stuffed them into the DESCRIPTION as a bulleted list, the Options field stayed "Option 1 /
Option 2", status "All options must have text", and the only chip was Sources. "The chips and the
fields need to be correlated with the fields available based on which voting method is chosen. And
this should work for all future voting methods that may have different fields."

Root cause: a vote's assistant field list was static (`title / description / sources`), so the
assistant had no `options` field to target and the chips had none to offer.

**One declaration, every layer derives from it.** `VOTE_METHOD_EXTRA_FIELDS` in
`voteAssistantConfig.ts` (`yes_no_unsure: []`, `approval: ["options"]`), mirrored client-side in
`ui/src/services/voteMethods.ts`. A method added later declares its own line on both sides and is
handled everywhere without another branch.

- **Server.** `DraftField` gains `"options"`; `DraftState` / `AssistantDraft` / `DraftProposal` carry
  `options` (one-per-line text) and `method`. New seam `AssistantTypeConfig.activeFields?(draft)`:
  which of `fields` apply to THIS draft. The vote config declares `fields` incl. options and
  `activeFields` = shared + the method's extras. The controller narrows the config through it
  (`effectiveConfig`) at both `callAssistant` sites, so the prompt's draft state, the reply schema's
  field enum, and validation all follow the method. The prompt's context block now states the
  voting method; vote `typeGuidance` says options are their own field, never the description, one
  per line, 2–8, include "No change" when real; `fieldGuidance` gains an options entry. The vote
  draftStore exposes `options` (from `custom_options`) and `method`; `applyGeneratedDraft` writes
  options from a first draft.
- **Client.** `ProposeDraftVote` tracks `method` (set on change, synced from the draft), passes
  `applyFields = voteAssistantFields(method)` — so the chips and Apply gating follow the method
  immediately — wraps every draft with a derived `options` text (`withOptions`) so "has content"
  and chips see it, and maps an `options` patch back to `custom_options` before saving. The vote
  form's option editor adopts externally-applied options (previously local state only). Chip label
  "Options" and an options-specific imperative prompt.

**Verified on dev, real model turn, phone width:** approval draft → chips Sources + Options; tap
Options → ONE card with field `options` (not description), 7 lines, Apply; Apply → the form's
inputs filled with 7 distinct options ("No change" first), status advanced past "All options must
have text"; switch to Yes/No → the Options chip is gone. `tests/unit/assistantVoteOptions.test.ts`
(5): the map, `activeFields` per method (unknown method degrades to shared fields), schema enum per
method, prompt shows Options + method only for approval, guidance wording. `tests/unit` 735/735,
tsc + UI build clean.

## Admin-review links no longer bounce to the home page — 2026-09-05

Adam, on his phone: the "Review it now" link in the new-submission email "just links to the home
page… it should link to the person's process being submitted for review and allow them to withdraw
the submission." The link was correct (`/admin/reviews/<id>`); the phone's browser session was the
CREATOR account, and `AdminGuard` did `if (!isAdmin) <Navigate to="/" />` — a silent bounce for
anyone not an admin, signed-out visitors included.

`AdminGuard` now branches on who is there:
- **Admin** → the page, unchanged.
- **Signed in, not admin** → `/my-submissions/<id>` when the URL is an admin review. An admin review
  and the creator's own view of it share the review id, so a creator who follows an admin link
  lands on their submission — readable, with Withdraw — instead of nowhere. Any other admin URL →
  `/my-submissions`.
- **Signed out** → the sign-in modal rendered IN PLACE, so the URL survives and an admin who opens
  a review link from an email on a phone lands on that review the moment they finish signing in
  (there was no return-to mechanism; not navigating away makes one unnecessary). Dismissing the
  modal is the one path that goes home.

The creator's own confirmation email (`notifyCreatorSubmitted`) already linked to
`/my-submissions/<id>` and was not the email in the screenshot.

Verified on dev at phone width: creator session → `/my-submissions/rev_…` with "Your submission"
and Withdraw; signed out → modal shown, `location.pathname` still the admin URL; admin token on
that same URL → the review with Approve / Request changes / Decline. UI-only; build clean.

## Chunk-edit matcher: letter case is drift, not a mismatch — 2026-09-05

Adam's run on prod was clean except one card: the fail-safe fired — "Couldn't find this passage in
the field — it may have changed since." The fail-safe was RIGHT to refuse rather than corrupt, but
the cause was a gap in the tolerant matcher. The model quoted "**t**he county doesn't really have
clear rules…" (lower-case t, straight apostrophe) against a field holding "**T**he county doesn’t
really have clear rules…" (capital T, curly apostrophe — iOS converts quotes on entry). The matcher
tolerated whitespace and quote style but was case-sensitive, so a one-letter case drift defeated an
otherwise exact quote.

`replaceQuotedChunk` now matches case-insensitively (the exact-`includes` fast path is unchanged).
Case is the same harmless class as whitespace: a multi-word quote cannot plausibly hit a wrong
passage on case alone. Validated with the screenshot's exact strings: applies, replaces only that
sentence, keeps the preceding one; a genuinely missing passage still returns null. Universal
(`useDraftFlow`, every type). CSS/TS UI-only; build clean.

## Draft form footer flows at the end on a phone, stays pinned on desktop — 2026-09-05

Adam: the pinned bottom block (Get suggestions + status + Submit) "is a bit too much space filling
up… I want it to just be at the bottom of the process creation flow so they have to scroll down to
see it." Agreed: on a phone it was about a quarter of the viewport, on top of the fields being
filled in. The status line is only actionable at the moment you submit, and you scroll there anyway
— so nothing is lost by letting it flow. Get suggestions (moved into this footer earlier today for
discoverability) is still at the end of the flow, where a mobile creator ends up.

**Where the change actually lives.** A first attempt added `@media (max-width:768px)
.drafting-form-footer { position: static }` in `DraftingForm.css` — and did nothing, because
`ProposeDraft.css` has a deliberate mobile rule `.propose-draft-mobile .drafting-form-footer {
position: sticky; … }` (safe-area padding + a floating shadow) whose two-class selector outranks it.
That rule is the one that pins the footer on phones, so it is the one that changed: now
`position: static`, safe-area bottom padding kept (Submit clears the home indicator at the page
end), shadow dropped since it no longer floats. The redundant query was removed so there is one
source of truth. `.propose-draft-mobile` is DraftShell's mobile wrapper for every type, so all four
forms get it; desktop keeps the base `sticky`.

Verified on dev: at 375px the footer computes `static`, top at 2150px (off-screen until scrolled),
after the last field, no shadow — conversation and vote both; at a true 1024px it computes `sticky`
and the mobile wrapper is absent. CSS-only; UI build clean.

## Assistant: a request that dies mid-flight retries itself — 2026-09-05

With the structured-output fix live, Adam's next run was clean — full review, two chunk-edit diffs,
a 3-source search — except the very first call: "Something went wrong with the assistant. Try again
in a moment." He had to tap Try again. His own observation: "I went to a different app while the
browser was doing the work." He wondered whether the model's thinking time was being cut short.

**Not a token limit** — the retry generated a long reply fine, and a max_tokens cut would surface
as an empty tool call, not this message. **It is the app switch.** iOS suspends a backgrounded tab
and kills its in-flight fetches; the rejection is a `TypeError` ("Load failed" on iOS, "Failed to
fetch" elsewhere), which matched none of `friendlyError`'s branches (rate_limit / API key /
timeout) and fell through to the generic message. The server had very likely finished the turn —
`appendConversation` runs before `res.json` — but only the reply TEXT is persisted, not the cards,
so the lost turn is not silently recoverable; a retry is the right answer.

`useDraftFlow` now wraps all four assistant calls (chat, kickoff, Get suggestions, CoC check) in
`withNetworkRetry`: on a network-drop error it retries ONCE, showing "Connection dropped — trying
again" as the loading label. Because a suspended tab delivers the rejection on resume, the retry
effectively fires when the person comes back — they see "trying again" and then the reply. If the
retry also fails, `friendlyError` now says what happened: "The connection dropped — that can
happen if you switch apps while I'm working. Tap Try again." Non-network errors are unchanged.

**Verified on dev with a `fetch` shim** rejecting assistant calls with `TypeError("Load failed")`:
fail-first → 2 calls, the reconnect label observed, no error, a real reply; fail-all → 2 calls, then
the network-specific message (not the generic one). tsc + UI build clean; UI-only change.

Known residual: an automatic retry re-runs the model, and if the first call had completed
server-side the draft's history gains a duplicate assistant line (visible on reload). Rare, and
the fix is an idempotent turn id (server caches the finished reply) — a small schema addition,
deferred.

## Assistant replies are now API-validated tool calls, not hand-written JSON — 2026-09-05

Adam's three PDFs of the short-term-rentals conversation showed the assistant cutting off mid-word
("**1. The") with no suggestion cards, a message saying "click Apply" with no Apply button, and
"when it worked, it worked." He asked for an assessment and then "make this assistant much more
reliable."

**Root cause — a deterministic plumbing bug, not model randomness.** The model was asked to
hand-write its reply as JSON in free text. A review naturally quotes the draft (`"30%"`); when the
model emitted a raw `"` inside the JSON `message` string, `JSON.parse` threw, and the fallback regex
in `extractFallbackMessage` captured the message only up to that quote — and the suggestion cards,
inside the discarded JSON, were lost. Reproduced byte-for-byte in `scratchpad/parsebug.ts`: the
same input yields exactly `…ranked by importance.\n\n**1. The` and zero cards. PDF 2's retry shows
the identical review succeed when the model happened to escape `\"30%\"` — a coin flip on escaping,
which is the non-determinism Adam felt.

**Fix — structured output via tool use.** The reply is now a `respond` tool whose `input_schema`
the API validates. `buildRespondTool(fields, {includeDraft})` builds the schema from the type's
declared `config.fields`: a proposal's `field` enum is title/description/sources, a conversation's
adds seed_statements, `draft_proposal`'s properties are the same list — so a type registered
tomorrow with two fields or seven gets a matching schema with no code. `callClaudeMultiTurn` gained
`toolChoice` and `responseTool`, and returns the reply tool's `input` as `structured`. The main
assistant uses `tool_choice:{type:"any"}` so a turn can web-search and still end on `respond`; the
Code of Conduct check forces `respond` directly. Text parsing remains only as a fallback for a
turn with no tool call. Both prompts' "respond with valid JSON + template" sections became "end
every turn by calling respond". The UI contract (`AssistantResponse`) is unchanged.

**Verified against the live API on dev, all three changed paths:**
- The exact prompt that failed on prod ("Anything to make the description better?") → a 1,033-char
  message, intact, CONTAINING double-quotes, plus 3 description chunk-edit cards with Apply.
- The Sources chip → two web searches, then `respond` → 814-char message, one sources card with
  4 URLs and Apply. (`tool_choice:any` + server-side search + a terminal reply tool coexist.)
- Run Code of Conduct check (forced tool, 1024 tokens) → ~3s, "Ready to submit", no error.
No Anthropic errors or max_tokens warnings in the dev log.

`tests/unit/assistantStructuredOutput.test.ts` (8): structured input is used and the message
survives with quotes; the OLD text path provably lost the cards (pinned as the regression); the call
names the reply tool with `tool_choice:any`; text-only still parses as fallback; the schema's field
enum and draft keys equal each type's declared fields, an arbitrary field list gets a matching
schema, and the CoC variant has no draft_proposal. Two older assertions that checked the old JSON
template text were re-pointed to the new contract (same intent). `tests/unit` 730/730, tsc clean.

**What this does and doesn't fix.** It makes the plumbing deterministic — no more truncated
messages, lost cards, or "click Apply" with nothing to click — which is where every failure in the
PDFs lived. It does not make the model's judgment deterministic. Still open: long search turns look
frozen (no streaming/progress) — a "still working" state + client cutoff is the next reliability
item.

## Suggestion cards: targeted chunk edits, replace-not-append, supersede — 2026-09-05

Adam, on editing a long description: he did NOT want the whole field crossed out and rewritten in
one giant suggestion — he wanted a Google-Docs-style change scoped to the passage: show what's
removed, show what replaces it, apply just that chunk. This reuses a mechanism that already existed
(`quoted_text`) rather than building an inline-diff editor.

**Chunk edits.** A suggestion carrying `quoted_text` now renders as a diff — the quoted passage
struck through, the replacement marked as added — and applies surgically (`replaceQuotedChunk`
swaps only that passage, the rest of the field untouched). The system prompt tells the model to
prefer this for a field that already has substantial content (especially the description): put the
exact existing text in `quoted_text`, the replacement in `suggested_revision`. This is what makes
long-description editing mobile-friendly — the card only ever shows the chunk in play.

**Tolerant matching + fail-safe.** A model rarely quotes byte-for-byte, so the match is tolerant of
whitespace runs and straight/curly quotes. If the passage still can't be located, apply returns
false and the card says so ("Couldn't find this passage… edit the field directly") instead of the
old behavior, which silently APPENDED the whole revision — corruption. Validated in isolation:
exact, extra-whitespace, and straight-vs-curly all match; a missing passage returns null.

**Replace, not append.** A whole-field suggestion (no `quoted_text`) now REPLACES the field on apply
rather than appending — the source of the duplicated text Adam saw on a second apply. The prompt
says a whole-field revision must be the COMPLETE new value, and whole-field is for short/empty
fields (title, a fresh seed set) or an explicit "rewrite the whole thing".

**One outstanding whole-field suggestion per field (B).** `AssistantPanel` suppresses an earlier
UNAPPLIED whole-field card for a field once a newer one arrives, so competing full rewrites don't
pile up. Chunk edits (different passages) coexist; applied cards stay as history.

`onApply`/`onApplySuggestion`/`handleApplySuggestion` now thread a boolean so the card can show the
fail-safe. Verified on dev: asked to tighten one sentence of a 4-sentence description, the model
returned a `description` chunk edit (not a rewrite), the card showed the old→new diff, and Apply
changed only that sentence (+8 chars, first sentences untouched, old text gone). tsc + build clean,
`tests/unit` 722.

Honest limit: the model must quote verbatim for the exact path; tolerant matching covers most drift,
and the fail-safe prevents corruption when it can't. The "prefer chunk edits" behavior is a prompt
lean, not a guarantee.

## Suggestion cards: edit in place before applying — 2026-09-05

Adam, on a sources card with four links: "I'm forced to either accept them all or not apply any of
them" — he wanted to keep some and drop others. Editable suggestions.

Each card now has an **Edit** button (beside Apply). Edit swaps the read-only display — the seed
numbered list, or prose — for a clean, unnumbered, auto-growing textarea holding the raw
one-per-line text, so trimming a source or statement is just deleting a line. Apply then writes the
EDITED text, not the original.

**Edit is a before-Apply action; the card locks after.** This is deliberate and answers Adam's
duplication worry: `handleApplySuggestion` APPENDS to a non-empty field (`current + "\n\n" +
revision`), so "apply → edit → apply again" would leave both copies. Once applied, the card shows
"Applied" (disabled) with no Edit and no re-apply, so there is no duplication path. Further changes
are made in the form, where the field (and the seed rows) are directly editable.

Wiring: `SuggestionCard.onApply` is now `(revision: string) => void`; both call sites
(`AssistantPanel`, `DraftShell` inline CoC results) apply `{...s, suggested_revision: revision}` but
key the applied-state on the ORIGINAL suggestion, so cross-view sync between the panel and the inline
list is unchanged.

Verified on dev: a 6-statement seed card, edited down to 3 in the box, applied 3 rows to the form
(not 6); the card then read "Applied", disabled, with Edit gone. No backend change. tsc + UI build
clean.

## Assistant: deterministic empty-field help chips — 2026-09-05

Adam, after repeated assistant letdowns (a timed-out review, a mis-targeted card, no easy way to ask
for help on the empty fields): make the "want help with the empty fields?" offer reliable. Agreed to
move field coverage OUT of the model's memory (where it kept forgetting or mis-targeting) and into
deterministic UI, keeping the opening brainstorm flow as-is.

`AssistantPanel` now renders a row of chips at the END of the scroll area — "Select which sections
you want help with" over one chip per field this form still has empty ([Sources] [Seed statements]). The list is computed
in `useDraftFlow` (`fieldHelp`) from `applyFields` and the current values, the same source as the
Get-suggestions gate; a field fills (applied OR hand-typed) and its chip disappears. Empty only, no
"sparse" threshold — a deliberately terse field is never nagged. Shown once past brainstorm, with the
conversation started, and hidden while loading.

**In the scroll area, not the fixed bottom** — so it costs zero fixed height, which was Adam's
concern. It also needed no nav surgery: on mobile the assistant is already a full-screen overlay
(`position: fixed; inset: 0`), so the site nav is painted over in that view and never competed for
space to begin with.

**The chip's request is imperative, and this mattered.** First cut sent "Can you help me with the
seed statements?" — the model explained and ASKED to draft rather than drafting (exactly the
round-trip Adam is tired of). Changed to a directive: "Draft a balanced set of seed statements for
this conversation now… put them in a suggestion card I can apply." Sources is phrased to search, not
invent URLs. Verified on dev with a real model turn: the soft phrasing produced prose + an offer and
no card; the imperative phrasing produced ONE seed_statements card (not description), Apply landed
all six statements in the numbered rows, and the Seed-statements chip then vanished leaving only
Sources.

New/changed: `AssistantPanel` (chips + `fieldHelp`/`onFieldHelp` props), `useDraftFlow` (`fieldHelp`
memo + `uiFieldLabel`), `DraftShell` (`DraftShellAssistant.fieldHelp`, passed through),
`AssistantPanel.css`. tsc clean, UI build clean, `tests/unit` unaffected (722).

## Assistant: a filled field is done; a seed offer returns a seed card — 2026-09-05

Adam, on mobile: he applied the assistant's description rewrite, said "I think I'm done", and the
assistant — while correctly nudging that seed statements were still empty — returned ANOTHER
`description` card (a near-duplicate of what he had already applied) instead of the seed statements
it had just offered. "It just suggested a whole revision of the description rather than the seed
statement… even though I hadn't changed it."

This is model adherence, addressed on two fronts:

**Deterministic backstop** (`service.ts`, `dropRedundantSuggestions`): a soft suggestion whose
`suggested_revision`, normalized (trimmed, whitespace-collapsed, lower-cased), equals the field's
current value in `draft_state` is dropped before the response reaches the client. A HARD block is
never dropped — a Code of Conduct problem on existing text must still surface. Applied at both
return points (normal and the promise-nudge path). This kills the exact no-op re-suggestion; it does
not catch a reworded near-duplicate, which is what the prompt rules are for.

**Prompt rules** (`systemPrompt.ts`, general, all types): "A filled field is done — leave it alone."
No unprompted rewrite of a field that already has content; rewrite only when the person asks or it's
a hard block; and when a message offers to draft content for a specific field, the card returned in
that turn MUST target that field, never a different one already helped with. The rule is
field-agnostic (an earlier draft hard-coded "seed_statements" and leaked it into the vote prompt,
which a standing test caught — the vote form has no such field). The seed-specific binding lives in
the conversation's `typeGuidance`/seed section only: an offer to draft seeds is answered by a
`seed_statements` card, one per line, never a `description` card.

`tests/unit/assistantRedundantSuggestion.test.ts` (5): the no-op is dropped; a real edit of a filled
field and a genuine empty-field (seed) offer survive; a hard block is never dropped; and the built
prompt carries the new rules. `tests/unit` 722/722, backend tsc + UI build clean.

Honest limit: the prompt rules reduce but cannot guarantee perfect model targeting. If it recurs, a
harder client guard (suppress a soft card for a field the creator already applied a card to) is the
next lever.

## Seed rows: a repeat never becomes a row — 2026-09-05

Adam, seeing the assistant's balanced set land a near-duplicate flagged in yellow: "I'm not sure
what benefit of showing it does. It'd be cleaner just to not include repeats in the display at all."

Repeats now never appear as a row. They are dropped where content arrives from somewhere other than
a keystroke — a paste, an applied suggestion, a loaded draft (`dropDuplicates`, case/space-
insensitive, matching the controller's key). The yellow highlight, the per-row "Repeats an earlier
statement" note, and the "N repeats will be skipped" suffix are gone; the count is just "N
statements".

Deliberately NOT live per-keystroke deletion — a row vanishing as you type is jarring. A hand-typed
exact duplicate (rare) is left in place as a plain row and dropped by the backend's submit-time
dedupe (unchanged). The adoption comparison dedupes BOTH sides, so an incoming echo never yanks a
manual duplicate out from under the creator; only genuinely new external content replaces the rows.

This also closed the hole behind Adam's screenshot: the assistant's Apply goes through the adoption
path, which did not dedupe, so an 8-unique + 1-repeat suggestion rendered 9 rows — over the cap of
8. Deduping adoption brings it to 8.

Verified on dev: a draft stored with 5 lines (two case-variant dups) loads as 3 rows; pasting a
list whose entries repeat each other and existing rows drops every dup (case-insensitive); a
hand-typed exact dup stays put through the debounce round trip with no warning. Unused repeat CSS
removed from SeedStatementRows.css and DraftingForm.css. UI build clean.

---

## Seed statements become numbered rows — 2026-09-05

Adam, on the plain textarea: "some little more distinguishment between one seed statement and the
next … when they hit enter that next definitive row marker is generated." Then: "how big of a job
is it to replace it with numbered rows and have the AI assistant pick that up?"

Smaller than first sized, because the integration point I feared did not exist. `seed_statements`
is a plain newline-separated STRING the whole way through — draft column, the assistant's
one-per-line suggestion, Apply-suggestion — and is only split into an array at submit
(`deliberationDraftController`). So `SeedStatementRows` is a pure UI over that string: rows derive
from it, edits join back into it. **No backend, schema, spec, or assistant-prompt change.** On the
wire nothing moves — the four canonical specs govern activities and descriptors, not a draft-form
control.

`components/SeedStatementRows.tsx` — numbered rows, each an auto-growing one-line textarea:
Enter splits at the caret and focuses the new row; Backspace at column 0 merges into the previous
row (the inverse); × removes; **paste of several lines splits into rows** (blank lines and trailing
newlines dropped) rather than dumping everything into one; a repeat is flagged on its own row
(case/space-insensitive, mirroring the controller's dedupe) with the count beneath.

**Two bugs found and fixed during verification, not after:**

1. *The empty-baseline clobber.* Creating the draft server-side echoes back `seed_statements:""`
   before the debounced field save lands, and my first reconciler adopted it — wiping rows the
   person had just typed. This is the exact round-trip hazard the file's own header comment warns
   about; my `emitted`-echo guard was necessary but not sufficient. Fix: an empty incoming value
   never replaces local rows (clearing is always a local action that is already showing). The old
   uncontrolled textarea sidestepped this by never re-syncing from the prop; a controlled rows
   editor has to reconcile, so it has to get this right.
2. *Apply-suggestion's DOM write.* `useDraftFlow` writes applied text straight into
   `#draft-<field>` because the other forms are uncontrolled. That would have jammed a whole
   multi-line value into row 1. The rows now carry `data-controlled="true"` and that write skips
   them; the value reaches them through the draft prop instead.

**Verified on dev, driving React's real event system** (the browser tool's synthetic Enter does not
reach a React key handler — it silently no-ops, which is why the first scripted pass looked broken;
dispatched `KeyboardEvent`s exercise the true path). Confirmed: three rows number 1–3; a
case-different duplicate flags on row 3 with "2 statements · 1 repeat will be skipped"; mid-caret
Enter splits precisely; Backspace merges at the seam; × and empty-row cleanup; a 4-line paste (with
a blank and a trailing newline) becomes 3 clean rows; the value survives the debounce + draft-create
round trip that used to wipe it; the saved string is correct in the DB; and loading a draft with
`?draft=` repopulates all rows — the same non-empty-adoption path Apply-suggestion uses. Backend
tsc clean, `tests/unit` 717/717.

(Screenshots were unavailable — the browser pane returned blank frames all session — so the visual
was verified from the live DOM and accessibility attributes rather than an image.)

**Follow-up the same day** — Adam, worried the rows looked thin, and wanting a bound: taller rows
and a cap of 8. Each row now has a ~2-line min-height (52px) so an empty one reads as a block to
write into, still growing past that for a long statement (measured 202px for ~160 chars). A quirk
surfaced in passing: Chromium counts a textarea's placeholder toward `scrollHeight`, so auto-grow
was inflating the first empty row to ~110px to fit the long placeholder — now empty rows are left
to the CSS min-height (not measured) and the placeholder was shortened to one line.

The cap (`MAX_SEEDS = 8`) is a GROWTH cap, not a truncation: Add hides at 8 (a "Maximum of 8
statements" note takes its place), Enter makes no 9th row, and a paste only fills up to 8. A value
arriving with MORE — a draft from before the cap — is shown in FULL rather than silently losing the
creator's content (verified: a 10-seed draft loads all 10 rows, Add hidden). The assistant was told
the same limit in all four places its prompt describes seeds (first-draft guidance, the seed
section, the type guidance, the field hint) — the wire format is unchanged, still one statement per
line, so Apply still populates the rows through the prop (the `data-controlled` guard keeps it off
the raw DOM write).

---

## "Get suggestions" reaches the bottom of the form too — 2026-09-05

Adam, filling a conversation on his phone: the assistant affordance (with Get suggestions) sits at
the TOP of the form, so after scrolling down through the fields to the sticky footer he only saw the
status line and Submit — "I'm afraid they're never gonna see that get suggestions button. Please
include it at the bottom somewhere the mobile user will recognize."

`components/SuggestFooterButton.tsx` (new) renders "Get suggestions" as the first row of the sticky
`.drafting-form-footer`, above the status line, on all four draft forms. It is fed the SAME gated
handler as the top affordance — the page passes `shellAssistant?.onSuggest`, which is undefined
until the draft has content — so it appears only once there is something to review, exactly like the
top button, and fires the same review. Shown at every width; on desktop a quiet echo of the top
card, on mobile the one people actually reach at the bottom.

Universal, not conversation-only: wired through all four forms (Deliberation / DraftingForm(proposal)
/ Vote / Project) and their four pages. Project's edit mode passes `undefined` (it hides the
assistant, matching the top affordance).

Verified on dev at mobile width, all four types: the footer button is absent on a blank form and
reads "Get suggestions" once a title is typed, sitting above the status line; clicking it flips to
"Reviewing…" and opens the assistant. UI build clean.

## "Get suggestions" is only offered once there is something to suggest on — 2026-09-05

Adam: "you can click get suggestions on a blank form, which doesn't make any sense and is confusing
for the user." He floated hiding it until the assistant is opened, or moving it to the bottom of
each form.

Neither move was needed, because the two buttons serve opposite ends of the flow: **write this with
me** makes sense from empty, **review what I have** does not. So the review button is simply
withheld until the draft has content, and the affordance's own sentence drops its second half to
match:

- empty — "The assistant can ask a few questions and write a draft with you. Once you've written
  something, it can review that too." One button.
- with content — the original sentence, both buttons.

**One change, in `useDraftFlow`, covering every type present and future.** `applyFields` is already
each type's declaration of the fields its form renders and the assistant may write, so
`hasSomethingToReview` reads exactly the person's own content and nothing else — and a type added
later is covered by declaring the field list it already has to declare. `DraftShell` needed no gate
of its own: it already renders the button only when `onSuggest` is provided, so withholding the
callback removes it. Pending edits are checked before the saved draft, so the button appears on the
keystroke rather than after the next PATCH.

Withheld rather than disabled: a disabled button still says "there is a thing here you can't have",
and there is no hover tooltip on a phone to explain why.

**Verified on dev, all four forms** — `/deliberations/new`, `/propose/new`, `/votes/new`,
`/projects/new`. Each showed "Open the assistant" alone on load and both buttons after typing into
the first field; clearing the field again took it back away.

Cleanup: the four throwaway drafts removed (matched on status `drafting`, this user, last hour, and
the exact titles typed), `uitest_` sessions dropped.

---

## The share reminder moves to where the person just acted — 2026-09-05

Adam, once the reminder actually fired: "it just looks busy and small and not really an obvious
reminder… I'm trying to come up with a mechanism that's more of an obvious reminder but doesn't feel
annoying." He proposed an exit-intent popup — catch them as they leave the page.

**The real problem was placement, not styling.** Every process page is laid out share icons → issue
content → the panel where you act. So the reminder rendered at the TOP of the page while the person
was at the BOTTOM having just voted, often several screens away on a phone. It was not too small so
much as too far from what they had just done. True on all four types.

**Exit intent was rejected, and not on taste.** There is no such thing on mobile: `beforeunload`
cannot render your own UI, browsers ignore it when a tab closes, and there is no cursor to detect
leaving. The only workable version intercepts in-app navigation — putting a dialog between someone
and the tab they just tapped — which is the pattern people resent most, and it fires at the moment
they have already decided to leave. The opposite principle applies: **ask at the moment of
satisfaction, not the moment of departure.**

So the reminder now lives in the confirmation, where the action completed and the eye already is.
`SharePrompt` was already exactly this component — a line of text, full-size share buttons, a
dismiss, once per process — and had only ever been wired into My Submissions.

| Type | Now rendered | Measured |
|---|---|---|
| Project | under the Support button | 24px below it |
| Vote | inside `.vote-receipt`, with the receipt and verify link | confirmed nested |
| Proposal | directly after "You have supported this proposal." | confirmed as next sibling |
| Conversation | INSIDE `DeliberationPanel`, under the statement card | 28px below it |

The conversation needed a second pass. Placed after the panel it was still too far down — the
vote buttons already sit at 889px on an 812px viewport, so anything below the whole panel is off
screen. `DeliberationPanel` grew an `afterVoting?: ReactNode` slot; the page passes the prompt, so
the panel stays free of share concerns and the page keeps owning the policy.

The old `nudge` prop is gone from all four action pages. It remains on Outcomes and Civic Brief,
which are read-only pages with no action to hang a moment on — worth revisiting.

`SharePrompt` also carried the same frozen-at-mount `useState` bug that ShareButton had; fixed the
same way, so it cannot come back by copy-paste.

**Verified on dev by engaging with all four types.** Prompt absent before, present immediately
after, correct wording each time, old pill gone everywhere; dismissal hides it, writes
`civic:share-prompt:<id>`, and survives a reload. Verification is DOM measurement — the browser
pane's screenshot capture went unreliable partway through, so there is a clean visual of the
project case only.

Cleanup: endorsement, ballot and project support all withdrawn; `uitest_` sessions dropped.

---

## The share reminder never fired at the only moment it existed for — 2026-09-05

Smoke test step 8. Adam: "I'm not really seeing a share reminder after engaging in a process."

**One line, in the shared component, affecting every process type:**

```tsx
const [nudgeHidden, setNudgeHidden] = useState(
  () => !nudge || nudgeRetired(nudge.processId),
);
```

`useState`'s initializer runs **once, at mount**. A process page mounts BEFORE the person engages
with it, so at that instant `nudge` is null and the flag froze at "hidden". When the vote landed and
the parent re-rendered with a real nudge, nothing ever set it back. The reminder could therefore
only appear on a page that was *loaded* after engaging — a reload — and never at the moment it
exists to catch. It was not that the nudge was missing; it rendered correctly, just never when it
mattered, which is why checking that it renders would not have found it.

Visibility is now derived from the current props on every render, with state holding only what was
dismissed:

```tsx
const [dismissedFor, setDismissedFor] = useState<string | null>(null);
const showNudge =
  !!nudge && dismissedFor !== nudge.processId && !nudgeRetired(nudge.processId);
```

**Verified on dev by actually engaging, all four types, no reload:**

| Type | Action | Reminder |
|---|---|---|
| Project | Support | "You're backing this — share it so more neighbors find it." |
| Conversation | 3rd statement vote | "Thanks for taking part — share this so more neighbors do." |
| Vote | cast a ballot | "Your vote is in — share this so more neighbors vote too." |
| Proposal | endorse | "You endorsed this — share it so more neighbors can too." |

Dismissal was checked end to end on the project: the × hides it, writes
`civic:share-prompt:<id>`, and it stays hidden across a reload.

**Not a bug, worth knowing:** a conversation's reminder needs **three** statement votes (or one
submitted statement) — `DeliberationPanel` fires `onParticipated` at that threshold, because one
Pass is not taking part. My first attempt used a single Pass and reported no reminder; the
threshold, not the fix, was the reason.

**Gap this exposes:** there is no test infrastructure for UI components — no jsdom, no
testing-library — so this entire bug class (state frozen at mount, derived values that never
recompute) is invisible to CI, which already only runs `tests/unit`. A single component test would
have caught it. Worth raising before the next round of UI work.

Cleanup: the endorsement, the ballot, and the project support created while verifying were all
removed, and the `uitest_` session rows deleted. The ballot needed care — `vote_records` carries no
user id by design (ballot secrecy), so it was matched by process + last 30 minutes and only deleted
because exactly one row matched. Four neutral "Pass" votes remain on the dev Polis conversation;
Polis has no unvote, and they are dev-only.

---

## Share row: the row now differs by device, and each button has one job — 2026-09-05

Smoke test step 7. Adam on a phone: Facebook "just opens Facebook in the browser", no link
attached. On a Mac: the text button "goes to my wife every time" — the same person on every share.

**Facebook is now desktop-only.** It took four attempts to get here and the reasoning is worth
keeping, because every rejected option looked right at the time.

The symptom: on Adam's iPhone the button opened Facebook with no draft and no link. The evidence
that explained it was his, not a probe of mine — **"a little Chrome text at the top left to go back
to Chrome"**, which is iOS's Back-to-Chrome banner and only appears once another app has the screen.
`facebook.com` is a universal link; iOS hands the tap to the Facebook app, which has no route for
`/sharer/sharer.php` and lands on the feed. The tap never reaches a browser, which is why my own
measurement (a logged-out login wall, link intact in `next=`) was true and beside the point.

| Attempt | Why it was dropped |
|---|---|
| Keep the web sharer | iOS gives the tap to the app; feed, no draft |
| `navigator.share()` from the Facebook button | Works — but then it is identical to the Share… button beside it. Adam: "seems to have reverted back to behave exactly like the other share button" |
| `window.open()` to `m.facebook.com` | Two dodges at once (JS-initiated navigation, a host the app may not claim). Untestable from here, and moot once the button goes |
| Ask the sheet to surface Facebook first | Not possible. `navigator.share` takes only title/text/url/files; iOS ranks targets by how often that PERSON shares to them. They can reorder it themselves; a page cannot |

So the Facebook icon is not rendered on a touch device. On a phone the labelled **Share…** button
is the route to Facebook — Adam confirmed a real post through it — and copy-link is the backstop.
Adam: "People can always just copy and paste the link." Desktop keeps the Facebook button, where
the web sharer genuinely works.

**What each device now shows:**

| | Copy | Facebook | Text | Share… |
|---|---|---|---|---|
| Desktop | ✓ | ✓ | — | ✓ where the browser has a sheet |
| Phone / tablet | ✓ | — | ✓ | ✓ |

**Twice this week — the Polis root cause on 09-04, Facebook on 09-05 — I asserted a platform
behaviour instead of measuring it, and was corrected by Adam noticing something on his own screen.**

**Texting from a desktop.** `sms:` with no recipient opens macOS Messages on the most recent
conversation and drops the body into it — the link is addressed to whoever you last texted. There
is no URI that asks for a recipient picker: `sms:` takes a number or nothing. Windows and Linux
mostly do nothing at all. A button that reliably messages the wrong person is worse than no button,
so the sms: icon is now gated on `(hover: none) and (pointer: coarse)` — a phone or a tablet
without a trackpad. Desktop keeps Copy, Facebook, and the OS share sheet.

Same behaviour reaches the Mac's own share sheet → Messages, but that is macOS choosing the
recipient after the hand-off, and nothing in our code touches it.

**Verified on dev, all four types, real page loads** (an earlier pushState probe was rejected —
it re-renders the component without the page, which is how a bad measurement got taken on 09-04):

| | mobile | desktop |
|---|---|---|
| Conversation / Vote / Proposal / Project | copy · facebook · sms, each href carrying that page's own link | copy · facebook only |

Re-verified after the button was dropped: at mobile width all four types show copy · text · Share…
with no Facebook icon; at desktop width all four show copy · Facebook (href carrying that page's
own link) and no text button. Checked with real page loads, `h1` confirming the right page each
time.

**Not changed, raised by Adam:** the copied link is 61 characters, e.g.
`https://floyd.civic.social/deliberation/proc_5889e8e441d1495e`. Nothing is appended — no query
string, no hash — the length is the `proc_` + 32 hex id. A `/s/:prefix` route resolving the first
8 hex characters and redirecting through `processDetailPath` would take it to ~38 and be universal
by construction, but it is a new public route and not a beta blocker.

Also: `test-results/` and `playwright-report/` added to `.gitignore` — Playwright failure
screenshots were sitting untracked and nearly went in with a `git add -A`.

---

## Approval activates through the registry, and never fails silently — 2026-09-05

Adam: "I would imagine we should be building that. I thought it was built already." He was right —
auto-start on approval has worked since it was written. What was on the list under my own bad
shorthand ("the activateOnApproval seam") was two narrower things.

**1. The policy was hardcoded three times in a shared service.** `approveReview` branched on
`proc.type` for the status to write, for the lifecycle action to dispatch, and for what a failure
meant — with votes and conversations carrying two *different* failure policies, neither declared
anywhere. CLAUDE.md's first design constraint says process logic never lives in the service layer,
and this was the exception. A fifth process type got no activation at all until someone remembered
to edit this file.

`ProcessHandler.activationOnApproval(process): ApprovalActivation` now owns it:

| Type | status | action | onFailure |
|---|---|---|---|
| `civic.vote` (support) | `proposed` | `process.propose` | `required` |
| `civic.vote` (direct) | `active` | `process.activate` | `required` |
| `civic.polis_deliberation` | `draft` | `start` | `best_effort` |
| everything else, present and future | `active` | — | — |

`required` means a failure rolls the approval back to `pending_review` so the admin retries cleanly
— right for votes, whose `processes` row says "proposed" while `addSupport` gates on `state.status`,
so a half-applied approval would refuse every endorsement while looking open. `best_effort` means
the approval stands and the process rests at its declared status — right for conversations, because
an outage in a service we do not own must not undo an admin's decision.

The declaration lives where the type's other hub policy already lives: votes on `voteProcess.ts`,
conversations on `deliberationBoot.ts` (the shared Polis module stays free of hub-specific imports,
same reason as `detailPath` and `requiredSchema`). `entersSupportPhase` for the approval email is
now read from `activation.status === "proposed"` rather than from the type, so the wording follows
any type that adopts the shape.

**2. A stalled activation was silent.** The only trace was a `console.error`. That is exactly how
the Loose Dogs conversation sat at "waiting to start" for three days: Polis rejected a duplicate
seed statement, the catch swallowed it, the admin screen said "approved", and the resident who
wrote it saw nothing happen. Two emails now:

- **Admin** — `notifyAdminActivationFailed`: names the process, the status it is resting at, why,
  and says plainly that the approval stands and nothing was lost.
- **Creator** — a third branch on `notifyCreatorApproved`. Previously they were told it "is now
  live!" and invited to share the link. They are now told it is approved, not open yet, the admin
  has been alerted, and to hold off sharing.

**Verified on dev, all four types** (`scratchpad/verifyActivation.ts`, comparing against the process
as STORED — the first run compared against raw input and reported a false failure, because
`initializeState` defaults an unset `activation_mode` to `direct`):

```
PASS civic.vote               declared=proposed action=process.propose  required    actual=proposed state.status=proposed
PASS civic.vote               declared=active   action=process.activate required    actual=active   state.status=active
PASS civic.proposal           declared=active   action=-                -           actual=active
PASS civic.project            declared=active   action=-                -           actual=active
PASS civic.polis_deliberation declared=draft    action=start            best_effort actual=active
```

And the failure path, forced by clearing `POLIS_AUTH_TOKEN`: approve did not throw, the review
stayed `approved`, the process rested at `draft`, and both emails were composed and dispatched
(Resend refused them only because the dev key cannot send to `adam@civic.social`).

**Test drift guard** (`tests/unit/activationOnApproval.test.ts`, 10 tests) asserts the review
service contains no `proc.type === "civic.vote"` / `"civic.polis_deliberation"` in the activation
path. It earned its place immediately: it failed on the first run and caught a leftover branch in
the approval-email config that I had missed.

**Also, on the process cards:** projects now read `date · N supporters · by CREATOR` — the date
moves to the left, matching every other type, which all lead with a date (Adam, smoke test step 5).

Cleanup: 20 `uitest_activation` processes archived, and the four Polis conversations they created
(`9pmbe3ausy`, `9xwdyyaiju`, `47a8fmpypp`, `4hcjfry5c6`) closed and verified `is_active=false`.
Their `process_reviews` rows stay — `review_turns` is append-only, correctly.

Backend tsc clean, UI build clean, `tests/unit` 717/717.

---

## One card for every process list — 2026-09-04

Adam, after two rounds of tweaking: "we need some consistency across the card design, across
processes. And I want that to be consistent somewhat for all future processes as well." Agreed the
shape from a table first, then built it.

**Why they had drifted:** votes, proposals, projects and conversations each wrote their own card
markup. By this morning they disagreed on where the status sat, whether a type pill existed at all
(proposals had none), and whether the creator was shown. Tweaking four copies is what produced the
inconsistency, so the fix is that there is now only one.

**`components/ProcessListCard.tsx`** — the card, for every type present and future:

```
┌────────────────────────────────────┐ ← 4px bar in the type's colour
│ [TYPE]                   [STATUS]  │  type left, status right
│ Title, full width                  │
│ meta · meta · meta                 │
└────────────────────────────────────┘
```

It takes `processType`, `status`, `title` and a `meta` array (falsy entries dropped, so callers can
pass conditionals inline). Pill label comes from `friendlyType`, colour and accent from
`typeColorSlug` — both of which degrade sensibly for a type nobody registered — so **a new process
type gets the card by passing its type string and nothing else.**

| Type | Meta line | Status pill |
|---|---|---|
| Vote | start date · N votes (or N of M endorsements while proposed) · closes/closed DATE | from `statusDisplay` |
| Proposal | start date · N endorsements · closes/closed DATE | same |
| Conversation | start date · N participants · closes/closed DATE | same |
| Project | N supporters (+ N opposed when any) · by CREATOR · created DATE | same |

Projects are the deliberate exception on both counts Adam named: they keep the creator, and they
carry no closing date because projects have no deadline. Oppose count is kept when non-zero — it is
participation a resident entered, not noise.

**One backend addition:** `deadline` joins `created_at` on the Polis handler's `getSummary`.
Conversations were the only type whose list summary carried neither, and the closing date is now on
the card.

`.process-card-chips` is the new row-1 rule (type pill left, `margin-left: auto` on the status);
`.process-card-title` is full width beneath it; the `margin-left: auto` put on
`.process-card-meta .status-badge` earlier today is gone, since status no longer lives in the meta
row. `.process-card-header` stays for Outcomes, which has no status pill — left as the archive view
it is, since everything there is completed by definition and the pill would read the same on every
row.

Verified on dev at 375px on all four lists: votes "Aug 25 · 32 votes · closes Sep 8" with VOTE/ACTIVE;
proposals "Jul 1 · 1 endorsement · closes Sep 29" with PROPOSAL/ACTIVE and no creator; projects
"0 supporters · by Admin · Jul 1" with PROJECT/ACTIVE; conversations "Sep 1 · closes Oct 13" with
CONVERSATION/ACTIVE. Title 285px of a 327px card on every one. No bespoke card markup left in any
page. Backend tsc clean, UI build clean, `tests/unit` 696/696.

---

## Duplicate seed statements: prevented, and made visible — 2026-09-04

Adam, on learning a repeated seed statement could stop a conversation starting: "Is there another
way to deal with duplicates? … I am wondering if we can have better formatting for those seed
statements so it actually looks like a list."

Two small changes, both aimed at never raising the error rather than only surviving it:

- **Deduplicated at submit.** `deliberationDraftController` now drops repeats case- and
  whitespace-insensitively, first occurrence winning so the creator's ordering survives. The
  adapter's tolerance (a duplicate counts as success) stays as the backstop; this stops Polis
  being asked twice at all. `tests/unit/seedStatementDedupe.test.ts` (5).
- **The field reads back what it will do.** "One line = one statement" was the entire contract of
  that textarea and nothing on screen said so — a creator could not see how their text would split,
  or that two lines were the same statement. It now shows "4 statements, one per line" live, and
  "· 2 repeats will be skipped" in a warning tone when there are any. The box also grew from 3 rows
  to 6, so a set of six statements looks like a list rather than a scrolling block.

Verified on dev with a draft containing two duplicates across four lines: the counter reads
"2 statements, one per line · 2 repeats will be skipped".

**Not established:** whether the duplicate on `proc_5889e8e441d1495e` came from the assistant or
from the creator. Reading it needs the prod seed list (the deliberation read model does not expose
`seed_statements`), and it no longer matters for correctness — both paths are covered. Worth a look
if it recurs, since an assistant that emits duplicates would be its own bug.

---

## Polis: a leaked participant token, a wedged conversation, and an orphan — 2026-09-04

Adam, on prod: an approved conversation ("Loose dogs and livestock", `proc_5889e8e441d1495e`)
showed on the feed but read **WAITING TO START**. Pressing Start surfaced a raw Polis 409 —
including a live JWT — onto the page.

**SECURITY, act on this: the displayed error contained a Polis participant token** for
`uid: 1` / `creatinglake@gmail.com`, scoped to conversation `5fm62xv5ma`, issued 2026-09-04 and
valid to **2027-09-04**. Polis mints a participant JWT into its error responses, and
`polisAdapter` interpolated the entire response body into the thrown message, which the
conversation page rendered. Not the `POLIS_AUTH_TOKEN` API credential — a participant identity for
the hub owner's own account, plus the email address. **Revoke/rotate it.** Any 4xx from that
endpoint would have done the same.

**What actually happened** (not what it looked like). Nothing to do with start times: a duration
WAS set (`duration_ms` 3628800000, the 6-week default) and the deadline is deliberately computed
at start so queue time never eats the participation window. The conversation is in `draft` because
the auto-start at approval failed and `approveReview` logs-and-swallows that failure by design.

The token proves how it failed: it carries `conversation_id: 5fm62xv5ma`, so **Polis created the
conversation and the hub never recorded it** — an orphan, with another created on each manual Start.

**Root cause — CORRECTED.** The first diagnosis in this entry was that a slow `/api/v3/comments`
POST timed out, got retried, and duplicated. **That was wrong**, and measuring Polis disproved it:
comment writes return in **125ms**. The evidence that settles it is that both failed attempts
(`5fm62xv5ma` from the auto-start and `6ymkenh7vr` from the manual Start) posted **exactly 8
statements each and died on the 9th** — identical and deterministic, not a timing race.

So the real cause is in the **data**: the conversation's seed list contains a statement Polis
rejects as `polis_err_post_comment_duplicate` at position 9, and the seed loop threw on it,
discarding the conversation id with it. It would have failed on every retry, forever.

Both fixes below still resolve it, for two independent reasons — a duplicate now counts as
success, and seeding no longer throws away the id — so the conversation will start cleanly. The
"only retry GETs" change is correct on its own merits (retrying a create can only duplicate it)
but it was **not** the cause here.

(Adam's push on "why did this happen" is what forced the measurement. The plan before it was to
retry activation automatically on a cron — against a deterministic data failure that would have
manufactured an orphan on every sweep, forever.)

Three fixes in `polisAdapter`:
- **Only GETs are retried.** Reads are free to repeat; creates are not.
- **`polisError()` keeps the body out of the message** and carries `status` and `polisCode` as
  fields instead. The full body goes to the server log, where it belongs.
- **Seeding is best-effort and never loses the conversation id.** The conversation exists the
  moment create returns, and the id is the one thing the hub cannot recover on its own, so a seed
  failure now logs and returns the id rather than throwing it away. A duplicate-statement error is
  treated as success — it means the statement is already there.

`tests/unit/polisAdapterRetry.test.ts` (6) covers all three, and **each was verified to fail when
the bug is reintroduced** — after shipping a vacuous drift-guard earlier the same day, a green test
is no longer taken as evidence on its own.

**Orphan cleanup, done the same day.** Enumerated every conversation on polis.civic.social via
`GET /api/v3/conversations` and diffed against the Polis ids referenced by **both** hubs. Closed
four, all verified unreferenced first:

| Polis id | Topic | Origin |
|---|---|---|
| `5fm62xv5ma` | Loose dogs and livestock | auto-start at approval |
| `6ymkenh7vr` | Loose dogs and livestock | the manual Start press |
| `4fa6jtybhe` | Where We Agree | first seed-slate run (2026-09-01) |
| `9hmshipyra` | Don Kenny building | first seed-slate run (2026-09-01) |

**The near-miss worth recording:** the first diff used only the PROD in-use set, which made six
conversations look orphaned — `7ppabafjwe`, `6xpdkkauhb`, `2m9xny6hse`, `7f3km6hhdp`, `9jdhekwr6b`,
`55mjeazeee`. They are live **dev** conversations. Both hubs share one Polis instance, so any
cleanup must diff against dev AND prod. Closing that list would have broken the dev environment
mid-smoke-test.

Also: `/api/v3/conversation/close` **timed out on all four and applied on all four** — verified by
reading `is_active` afterwards. That is the same >15s latency that caused the original duplicate
bug, from a second angle. Consequence of the retry fix worth knowing: a slow POST now reports
failure while having succeeded. That is the right trade against duplicating writes, but the real
answer is an idempotency key or a read-back confirm; `closeDeliberation` callers already treat it
as best-effort.

**Also retired** (explicit test conversations, referenced by neither hub): `7nkkydtpcj`
"Test Conversation, Polis Integration" and `9zkkxkte67` "Test: Floyd County Infrastructure
Priorities". A health-check statement was posted to `7nkkydtpcj` while timing the write path,
before retiring it.

**Left alone** — active on Polis, referenced by neither hub, but the topics read like real content
rather than tests: `5zzvja66ed` (FY2028 budget — dev has a separate FY2027 one) and `8db2na5hib`
(Green Box Sites — prod has a real green-box VOTE, though no conversation). Not a pre-flight item
and not a decision anyone needs to make: nobody can reach them (there is no link from either hub,
and Polis conversations are not browsable), so leaving them costs two rows in a Polis admin list.
Revisit next time there is a real reason to be in Polis.
Plus one row whose id serializes as `undefined` with a date for a topic. Seven more are already
inactive.

## Polis health, measured 2026-09-04

| Operation | Result |
|---|---|
| `GET /comments` (statements) | 177ms |
| `GET` next statement | 40ms |
| `GET` cluster / math state | 91ms |
| `POST /comments` (write) | **125ms** |
| `POST /conversation/close` | **never responds** — >40s, but the close APPLIES |

Participation was also exercised end to end through the UI earlier the same day (three statement
votes on the dev "Where We Agree", recorded correctly).

So: Polis is healthy for everything the participant path touches — create, read statements, serve
the next statement, record votes, math/clusters. **One endpoint is broken: `conversation/close`
hangs and never returns, though the close does take effect.** That is pre-existing and already
guarded — `closeDeliberation` callers treat it as best-effort and close locally regardless, so a
past-deadline conversation still ends properly on the hub; only the Polis-side conversation stays
nominally open, and nobody can reach it except through the hub. Worth fixing on the Polis track,
not urgent for the beta.

**Still open:**
- ~~Rotate the leaked participant token.~~ Done 2026-09-05 (Adam).
- ~~The universal activation seam + admin notification on failure.~~ Built 2026-09-05 — see
  "Approval activates through the registry, and never fails silently" above.
- Same pattern, lower risk, not changed: `utils/anthropic.ts` and `utils/youtube.ts` also
  interpolate upstream response bodies into thrown messages. Neither provider is known to echo
  credentials, but the shape is identical.

Backend tsc clean, `tests/unit` 702/702.

---

## Tab strip: a tab never rests half-hidden — 2026-09-04

Adam: "if I scroll over a little bit to where I can barely see conversations, it creates a full
word's worth of white space to the left of it."

Reproduced and measured. Not a layout bug — it is the left fade doing its job at a bad resting
place. Scrolled to ~70px, "Conversations" sits at x=24 while the pinned Feed block ends at 78 and
the 44px left-fade covers everything up to 122, so the word is chopped mid-letter and the band in
front of it is empty background. The bare chevron (the chip came off earlier the same day) makes
that band read as nothing at all rather than as a control.

Fix: `scroll-snap-type: x proximity` on the list with `scroll-snap-align: start` on each tab, so
the strip comes to rest on a whole tab. `proximity`, not `mandatory` — it tidies where a user's
scroll ends without overriding the peek or the active-tab centring, both of which land
deliberately.

**That first cut had a bug, reported within the hour.** `scroll-snap-align: start` aligns an item
to the *snapport*, and with the default `scroll-padding: auto` the snapport begins at the padding
edge — so with the list's `padding-left: 16px`, the first tab's snap position was `scrollLeft: 16`,
not 0. The strip could then never rest at the true start: `more.left` (`scrollLeft > 1`) stayed
true, so the left arrow was lit permanently, and its 44px fade sat at x 78–122 while
"Conversations" began at exactly 78 — the C hidden, the o half-faded (Adam: "you should be able to
scroll all the way to the left and have conversations completely revealed with the left arrow
disappearing just like the right arrow does").

`scroll-padding-left: var(--space-md)`, matching `padding-left`, insets the snapport by the same
16px and makes 0 the first tab's snap position. Verified at 375px: rests at 0 with the left arrow
hidden and "Conversations" fully visible; scrolled fully right, scrollLeft 248 with the right arrow
hidden and the left one shown — symmetric at both ends; a mid-scroll still snaps to a whole tab, so
the half-word band it was added for has not come back.

**Worth noting how it got through.** The verification measured the snap mechanism working —
"requesting 30 or 70 both settle at 16" — and read a settled value of 16 as success without asking
what 16 did to the arrows or to the first word. Checking that the mechanism fired is not the same
as checking the result looks right.

---

## List cards take the feed's shape; word-cloud density measured — 2026-09-04

**Cards.** Adam: the process-page cards should look "more like the cards on the feed" — colour bar
on top, the type label without the feed's "New" prefix, and the status pill moved to the bottom
right "across from … the date that it was posted".

The list cards already shared a CSS base (`.process-card`, `.proposal-card`, `.project-card`,
`.deliberation-card`) with a per-type `--card-accent`; it was just drawn on the LEFT border. So the
structural half is one rule: `border-left` → `border-top`, and the hover's `border-left-color` →
`border-top-color`. All four card classes move together and a fifth type inherits it.

- **Header carries the type**, using the feed's own `feed-pill feed-pill--type-<slug>` classes
  (one pill style, two surfaces — the same move Outcomes already made with the filter pills), with
  the label from `friendlyType` so it reads "Vote" / "Project" / "Conversation" rather than the
  feed's "New vote".
- **Footer carries the status.** `.process-card-meta` is now a flex row and
  `.process-card-meta .status-badge` takes `margin-left: auto`, so the status sits hard right
  whatever the type put on the left. `margin-left: auto` on the pill rather than `space-between` on
  the row, so a type rendering three meta items keeps them grouped left.
- Applied to Votes (`ProcessCard`), Projects (active AND archived blocks), Conversations (waiting /
  active / completed), and Outcomes' pill swapped to the same family.

Verified on dev at 375px: votes = navy top bar, VOTE pill, "32 votes · Closes Sep 8" left and
ACTIVE right; projects = blue bar, PROJECT pill, "by Admin · 7/1/2026" left and ACTIVE right;
conversations = teal bar, CONVERSATION pill, ACTIVE right.

**Second pass, same day.** Adam: the title should be full width with the type pill at the top
left, and the date at the bottom left across from the status pill — then, "I like the idea of the
card showing the participation count as well."

- **Header is a column now**, pill first and the title across the full width beneath it. Side by
  side, a long type word ("CONVERSATION") squeezed the title into a narrow column — a four-line
  wrap next to a one-word pill on a phone. The feed's pill carries `margin-left: auto`, which is
  cancelled in a card header so it sits left. One rule covering all three header classes.
- **The footer is date + participation on the left, status hard right**: votes read
  "Aug 25 · 32 votes · Closes Sep 8" then ACTIVE; projects "by Admin · 7/1/2026" then ACTIVE, with
  the support/oppose bar keeping its own colored line above; conversations "9/1/2026" (+ participant
  count once Polis has produced one) then ACTIVE.
- Conversations had no timestamp to show, so the shared Polis handler's `getSummary` now returns
  `created_at` from the process row — the one summary of the five that lacked one. `DeliberationSummary`
  takes it as optional, and the card omits the date rather than rendering "Invalid Date" against an
  older server.

Verified on dev at 375px: title width 285 of a 327px card (was squeezed beside the pill), pill top
left, date bottom left, status bottom right, on all three lists.

## Word cloud density — measured, and it does NOT scale

Adam asked whether the word cloud will show many more, smaller words as people add them. Measured
by replaying `layoutWords` from `WordCloud.tsx` against a realistic long tail:

| viewport | 50 submitted | 100 | 200 | 400 |
|---|---|---|---|---|
| phone 375px | 17 shown | **17** | **17** | **17** |
| tablet 768px | 50 | 97 | 97 | 97 |
| desktop 1100px | 50 | 100 | 112 | 112 |

**On a phone the cloud is capped at about 17 words no matter how many are submitted**, and the
overflow is dropped silently — no "+383 more", nothing. Since the word cloud is the onboarding
front door and most beta testers are on phones, most of what residents contribute would never be
seen by anyone.

Three causes, all client-side (the server caps nothing — `buildClouds` returns every aggregated
entry):
1. **A hard font floor.** `FONT_SIZES = [14, 18, 24, 32, 42, 56]`; sizing is ratio-based
   (`count / maxCount`) so words DO shrink relative to the most-mentioned one, but they stop at
   14px and pack no tighter.
2. **A fixed canvas.** Height is `max(300, min(width * 0.65, 500))` — on a 375px phone that is
   343×300 regardless of how much there is to show.
3. **Silent drop.** The spiral tries 2500 positions and, if none fits, the word is simply not
   pushed to `placed`.

**Fixed the same day.** Adam: desktop and tablet are fine, but the phone cap should be "around
forty or fifty", with less whitespace between words, the most common words still larger, and "the
smallest word could be quite a bit smaller and still be legible". Tuned against the measurement
harness rather than by eye — four candidate parameter sets, measured at four viewport widths:

- **Two size scales, chosen by canvas width** (< 500px). Narrow gets `[10, 13, 18, 26, 36, 48]`;
  wide keeps the original `[14, 18, 24, 32, 42, 56]`, so the desktop cloud is unchanged. Sizing is
  still `count / maxCount`, so the popular words stay big on both.
- **Less air:** the collision pad is 1px on a phone (2 elsewhere, was 3 everywhere), and the
  measured box uses a 1.05 line height instead of 1.2 — the old value reserved leading that is not
  there to see.
- **The spiral stopped wasting its attempts.** It used a fixed radial step out to ~876px, so on a
  343×300 phone canvas most of its 2500 tries asked about positions far outside the canvas and were
  discarded. It now sweeps to the half-diagonal, spending every attempt somewhere a word could
  actually land. This alone took the phone from 17 to 22.

| viewport | 20 submitted | 50 | 100 | 200 | 400 |
|---|---|---|---|---|---|
| phone 375px | 20 | 50 | **65** | 65 | 65 |
| phone 414px | 20 | 50 | 79 | 79 | 79 |
| tablet 768px | 20 | 50 | 100 | 134 | 134 |
| desktop 1100px | 20 | 50 | 100 | 159 | 159 |

Verified in the browser against 108 real submissions (60 distinct) seeded on the dev cloud: a phone
renders **50 words at 10–48px** where it rendered 17, visibly dense with "mountains", "community",
"farming", "music" still dominant; desktop renders the same set at 14–56px, unchanged. Temporary
submissions deleted afterwards (dev cloud back to its original 16).

Still true and not addressed: words that do not fit are dropped without a "+N more". Much rarer now
— nothing is dropped below ~50 words on a phone — but still silent.

Backend tsc clean, UI build clean, `tests/unit` 696/696.

---

## Spec audit; the hub namespace now resolves — 2026-09-04

Adam asked for a compliance check of the session's changes against the canonical specs in
`civic-social-docs/specs/` (the four in that folder govern; the copies under `/specs/` are older).

**The session added no drift.** No event-emission code was touched at all — the backend diff is
the assistant prompt/behaviour, one email body, `detail_path` on `GET /reviews/:id` (a
creator/admin endpoint, outside the activity contract), and the source-line parser. The one change
with a data shape (`voteDraftController` storing `content.links` parsed) does not reach any
activity: `civic.process.created` carries `data: {process: {type, title}}` and never `content`.

**Two decisions turned out to be spec-aligned for reasons not checked at the time.** Sharing records
nothing server-side, so there is no observable state missing from the activity stream (Activity
Spec §1.2, no silent state changes). And `civic.process.created` fires at **approval**, not at
submit — which is exactly why the share prompt belongs at approval: nothing is announced before it
is publicly fetchable.

**Where the hub stands.** `src/models/event.ts` still carries the v0.1 field names and a comment
saying v0.1, but that is the internal storage model — `activitySerializer` converts to v0.2 AS2 at
the endpoint, and the live stream is conformant: every MUST-level property of §2.2 present and
well-formed, `OrderedCollection`/`OrderedCollectionPage` transport, and a process-scoped actor IRI
for anonymized participation per §2.2.1. That is **Level 1 (Publisher)** on the §6.3 ladder.

**Fixed here — the `hub:` namespace resolves.** Every activity using a hub term declares
`"hub": "{base}/ns#"` in its `@context`, and that URL fell through Vercel's rewrites to the SPA: a
consumer dereferencing it got a page of React. `GET /ns` (`namespaceController`, `namespaceRoutes`,
`vercel.json` rewrite beside `/.well-known/civic.json`) now serves the register as JSON-LD
(`application/ld+json`, cached an hour), built from the serializer's existing `EXTENSION_TERMS` so
it cannot drift from what the mapping table can emit. This doubles as the §3.4 declaration of the
terms this space emits.

`tests/unit/extensionTerms.test.ts` (4) is the drift guard: it scans the serializer source for
`hub:` string literals and fails if one is emitted without being declared. **Verified it actually
fails** by renaming an emitted term — the first cut of the test sliced the source on an anchor that
did not match, scanned nothing, and passed vacuously; it now asserts it sees at least as many terms
as are declared before checking anything.

**Left for later (needs Adam — prod env + prod SQL):** no activity carries `location`, a SHOULD in
§2.2 where the activity has civic geography. `DEFAULT_JURISDICTION` falls back to `"local"`, which
`normalizePlaceCode` treats as non-geographic, so the property is dropped from every activity.
`CIVIC_JURISDICTION` is unset on prod and locally. Fix: set `CIVIC_JURISDICTION=us-va-floyd` and
`CIVIC_JURISDICTION_NAME=Floyd County, Virginia` (the spec's own worked example is this county),
plus a backfill — `UPDATE processes SET jurisdiction = 'us-va-floyd' WHERE jurisdiction = 'local';`
— because most emitters read jurisdiction from the process row, so the env alone would only fix new
processes. Non-breaking: `jurisdiction` is passed through everywhere and never filtered or compared.

**Considered and rejected:** remapping `civic.project.sentiment_changed` from `Update` to `Like`
(§3.1 prefers a native AS2 verb). One event covers support, oppose AND neutral; `Like` expresses
only support, so honouring the rule would need `Like`/`Dislike`/`Undo` and a three-way event split.
`Update` + a typed `hub:ProjectSentiment` is the more honest mapping. Leave it.

Backend tsc clean, UI build clean, `tests/unit` 696/696.

---

## Applied-suggestion state: universal by construction, and the CoC path too — 2026-09-04

Adam asked whether the applied-suggestions bug was systemic — "across the whole system to all
processes and to future processes". It was, and checking honestly showed the first fix was
narrower than the bug:

- **The bug was universal.** `SuggestionCard` is one shared component behind every drafting flow,
  so proposals, votes, projects and conversations all had it identically. It surfaced on a
  conversation but was never conversation-specific.
- **The first fix missed the inline Code of Conduct list.** `DraftShell` renders those cards on
  the form view with the card's own local state, so applying there and switching views forgot in
  exactly the same way.
- **And it was inherited by copying, not by construction.** The state sat in `useDraftFlow` and
  each of the four pages passed two props down. A new type that omitted them would silently fall
  back to the old behavior — below the bar set on 2026-09-02 for what a new type gets for free.

Both corrected by moving ownership one level out:

- **`DraftShell` owns `appliedKeys`.** It is mounted for the whole drafting session on both
  layouts (the switcher swaps its children; the shell itself stays), and every drafting page must
  render it. So every process type — including one added later — gets this with **nothing to pass**.
  `useDraftFlow` and all four pages are back to what they were.
- **Keyed by content, not position.** `suggestionKey(s)` = field | quoted_text | suggested_revision.
  Position would have keyed the panel and the inline list separately even though they render the
  SAME suggestions, so applying in one would leave the other still offering Apply. Content-keying
  means applied is applied on every surface that shows it.
- The inline CoC cards now read and write that set too.

Verified on dev at 375px on a **proposal** this time (the first fix was verified on a conversation):
real assistant card → Apply → "Applied" → switch to the form, panel confirmed unmounted → switch
back → still "Applied", with no page-level wiring left in the drafting pages. Backend tsc clean,
UI build clean, `tests/unit` 692/692. Test draft and uitest session deleted.

---

## Applied suggestions forgot they were applied; Done button goes navy — 2026-09-04

Adam, drafting a conversation: "when I apply suggestions and I go to the conversation form and then
go back to the assistant, it shows those things not applied."

**Cause:** `SuggestionCard` held `applied` in its own `useState`. Switching views unmounts the
panel — on phones the switcher swaps form for assistant, and on desktop the panel only renders
while `open` — so every card came back reading "Apply" as though nothing had happened. The text
*was* applied to the field; only the card's memory of it was lost, which is the worse failure of
the two: it invites applying the same suggestion twice, which appends the revision a second time.

**Fix — the state moves to where the messages already live.** `useDraftFlow` owns
`appliedSuggestions: Set<string>` keyed `<messageIndex>:<suggestionIndex>` (stable, the message
list is append-only) plus `markSuggestionApplied`. `AssistantPanel` reports each apply and reads
the set back; `SuggestionCard` takes an optional controlled `applied` prop and keeps its local
state as the fallback for callers that don't pass one (the inline Code of Conduct results in
`DraftShell`). Threaded through `DraftShell` and all four drafting pages, so every type behaves
the same and a fifth inherits it by copying the same two props.

**"Done — back to the … form" is navy with white text** (`--color-primary` / `--color-primary-text`,
weight 600), matching "Edit project" and the other primary actions rather than reading as a quiet
secondary control.

Verified on dev at 375px on a real conversation draft with a real assistant card: Apply → "Applied";
switch to the form (panel confirmed unmounted); switch back → still "Applied". Done button computes
`rgb(42, 78, 132)` on white. Backend tsc clean, UI build clean, `tests/unit` 692/692. Test draft
and uitest session deleted.

---

## Facebook sharing on phones; the share reminder becomes a note on the bar — 2026-09-04

**Facebook did nothing on a phone, worked on desktop.** `ShareButton` opened the sharer with
`window.open(url, "_blank", "noopener,noreferrer,width=600,height=400")`. iOS Safari treats a
`window.open` that carries **window features** as a popup and blocks it silently — the text-message
channel beside it was a plain `<a>`, which is exactly why that one always worked. Facebook is now
an anchor too (`target="_blank" rel="noopener noreferrer"`); anchors are never popup-blocked. The
cost is a new tab instead of a sized popup on desktop, which is the right trade for a channel that
did nothing at all on the device most people use.

**The share prompt was redundant, so it moved onto the share bar.** Adam on the first cut: "I don't
like how the extra share card has shown up after interaction… it just looks like a redundant share
options, especially on mobile it looks redundant and cramped… maybe we just need a little note next
to the share bar on each process that says hey consider sharing this." He is right — every detail
page already carries the share row in its header, so a card with a second copy of it was pure
duplication.

`SharePrompt` (a card with its own share row) is replaced on process pages by a `nudge` on
`ShareButton` itself: a small pill under the icons with the line and a `×`, and **no buttons of its
own** — the buttons it refers to are right beside it. `.share-row--nudged` wraps, so on a phone the
note takes the full width under the icons instead of being squeezed next to them. Same
once-per-process localStorage key as before (`civic:share-prompt:<id>`), so a dismissal made under
the old card still counts.

Where the note comes from, per page — each reads a signal the page already has, so no new server
field:

| Page | Shown when |
|---|---|
| Vote (`Process.tsx`) | `type === "civic.vote" && your_current_vote` |
| Proposal | `has_supported` |
| Project | `user_sentiment === "support"` |
| Conversation | `DeliberationPanel` reports up through a new `onParticipated` — own statement, or 3+ votes |
| Brief / vote results | always: a finished record has nothing to commit to first |

`SharePrompt` survives in one place only: **My Submissions**, which has no share bar of its own, so
there the card IS the share affordance rather than a duplicate of one.

Verified on dev at 375px: the vote page shows the note under the icons with no card anywhere
(`.share-prompt` count 0); Facebook renders as `<a target="_blank">`; dismissing hides it, writes
the key, leaves the share bar, and it stays gone across a reload; the brief page shows its own
line; a project the viewer has not supported shows no note. Backend tsc clean, UI build clean,
`tests/unit` 692/692. uitest session deleted.

---

## Source links were broken on three of the four types — 2026-09-04

Adam: the links on the Floyd County Microgrid Resilience Initiative "do not work… they open up a
page on the Floyd Civic Hub and don't load anything", and the display "should just be a title that
links to the HTTPS URL without showing the URL".

The stored data was fine — `"DOE C-MAP program page: https://www.energy.gov/oe/…"`, the documented
format. The readers were wrong, and there were **three different implementations** where there
should have been one:

| Type | Was | Result |
|---|---|---|
| Conversation | `SourceLinks` | correct |
| **Project** | `<a href={wholeLine}>{wholeLine}</a>` | **href is not a URL** → resolved relative to the hub → blank page |
| **Vote** | stored `{url: wholeLine, label: wholeLine}`, rendered as-is | **same broken href** |
| **Proposal** | own inline parser: `label: <a href={url}>{url}</a>` | worked, but the title sat outside the link and the raw URL was the link text |

So Adam's "doesn't load anything" was the browser resolving `/DOE C-MAP program page: https://…`
as a path on floyd.civic.social, and his "too long" was three renderers showing the URL as the
link text.

Fixed by making `SourceLinks` the one renderer, as it always should have been:
- `ProjectDetail` and `ProposalDetail` now use it; the proposal's bespoke parser and the project's
  raw anchor are gone. The proposal section is titled "Sources" now rather than "Related Links",
  matching the field it comes from and every other type.
- `IssueContent` (votes) normalizes through the new `normalizeSourceLink()`, which handles a
  `{url,label}` pair whose `url` is itself a whole line — **so every vote already in the database
  renders correctly with no migration.** Verified against the old shape on dev.
- `SourceLinks` no longer silently drops a line with no parseable URL; it renders it as plain
  text. Losing something a creator typed is worse than showing it unlinked.
- `.source-links` gained a bottom margin — the project page's "Updates" heading sat flush against
  the last source.

Also fixed at the source: `voteDraftController` stored `{url: line, label: line}` for every
source. New `src/shared/sourceLine.ts` (`parseSourceLine`, `sourceLineToContentLink`) parses
before storing, so new votes hold a real URL. It mirrors the UI's copy — the two builds share no
module — and `tests/unit/sourceLine.test.ts` (6) pins it, using the four real microgrid lines as
the fixtures and asserting every href parses as an absolute URL and no label contains "http".

Verified on dev at 375px with the real prod source lines copied onto dev rows: project, proposal
and vote (from the OLD broken shape) all render numbered titles, every href absolute, no URL in
any link text. Backend tsc clean, UI build clean, `tests/unit` 692/692. Dev test sources reverted.

---

## Share prompt: creation and outcomes; peek trigger moved to the banner — 2026-09-04

**Peek trigger: half the banner, measured not hardcoded.** Adam: "I really just want it to be
like when I scroll about halfway through the banner image or so." `peekTriggerPx()` reads the
rendered height of `.hub-banner` / `.project-banner` and halves it, falling back to 120px where a
page has no banner — so the trigger tracks the banner across breakpoints instead of drifting from
it. On a phone the banner renders 160px, so the sweep fires at 80px of scroll. Verified on dev:
nothing at 60px, full 0 → 246 → 0 sweep at 130px.

**The creation share moment, now built** — at approval, never at submission, for the reason
recorded in the previous entry (a submitted process is `pending_review` and
`NON_PUBLIC_STATUSES` makes it unfetchable, so the link would be dead). Two places:

- **The approval email** (`notifyCreatorApproved`, the "is now live" variant) names sharing as the
  next step and includes the URL as bare text as well as a link, because pasting a link into a
  text message is what people actually do from an email. The "gathering support" variant already
  said this; the live variant did not.
- **My Submissions**, which is where a creator comes to check. Shown when the review status is
  `approved`: "This is live now. Share it so neighbors can find it." This needed the public URL,
  and the UI had no type→route map of its own (the server hands out hrefs everywhere else) —
  rather than duplicate the registry client-side, `GET /reviews/:id` now returns **`detail_path`**,
  resolved through `processDetailPath(type, id)`, i.e. the handler's own `detailPath`. A new
  process type therefore gets a correct share link here with nothing to declare. `SharePrompt`
  gained an optional `url` for exactly this case — the prompt is not on the process's own page.

**Outcome pages.** The brief page (`Brief.tsx`) and the legacy vote-results page
(`VoteResults.tsx`) now carry the invitation: "This is the community's finished record. Share it
so more neighbors see what came of it." Unlike the engagement prompts this shows to everyone —
there is nothing to commit to on a finished record — and it sits low on the page, after the
reading. Same dismissal rule, keyed on the brief's own process id.

Note on why the creator prompt is not on the detail pages themselves: the read models deliberately
carry creator *names*, not ids (the public-anonymity work of 2026-08-31), so "am I the creator" is
not answerable client-side. Putting it there would mean adding a `viewer_is_creator` boolean to
four read models. My Submissions knows it by construction and needed one server field instead.
Worth doing if the on-page prompt turns out to matter.

Verified on dev: `GET /reviews/rev_cf4289c39abe437d` returns
`detail_path: "/proposal/proc_69cda899e1fa420a"`; that review's page shows the creator prompt under
"Approved & live"; the brief page shows the outcome invitation. Backend tsc clean, UI build clean,
`tests/unit` 686/686. uitest sessions deleted.

---

## Share prompt at engagement moments; the tab peek waits for a scroll — 2026-09-04

**The peek now waits for a real scroll.** Adam: trigger it "when you scroll a decent distance…
that's when the user will be paying attention to it." On load the reader is looking at the banner
and the headline, so the one sweep a visit gets was being spent while nobody watched. It now fires
the first time `window.scrollY` passes `PEEK_SCROLL_TRIGGER_PX` (320 — roughly half a phone
screen), and the strip is sticky so it is on screen and under the eye by then. Everything else
holds: once per visit, skipped under reduced motion and when nothing overflows, any touch/wheel/key
hands control back mid-slide. Verified on dev at 375px: 0px of movement sitting on the page, 0 at
150px of scroll, full 0 → 246 → 0 sweep at 420px.

**`SharePrompt` — one reminder per process, after the person has actually committed.** Adam wants
more sharing "but I don't want to overdo it… as low pressure as possible, allow them to easily
dismiss it — we're just reminding them that they can share it, that's it."

One shared component (`components/SharePrompt.tsx` + css) holding the existing `ShareButton` row
under one muted line, with a × on the right. Not a modal, not a toast, no second ask. Retired per
process in localStorage (`civic:share-prompt:<processId>`): the × hides it and records it; using
any share channel records it too (capture-phase, so it survives a handler that stops propagation)
but leaves the row up so the "Copied!" feedback still lands. Storage being unavailable costs
nothing — the row shows and the × still works for that view.

Mounted at each type's own commitment point, four call sites, one per type:

| Type | Shows after | Copy |
|---|---|---|
| Vote | the ballot is in (inside `.vote-receipt`) | "Your vote is in. Share this so more neighbors can vote too." |
| Proposal | endorsed | "You endorsed this. Share it so more neighbors can too." |
| Project | `user_sentiment === "support"` | "You're backing this. Share it so more neighbors can find it." |
| Conversation | a statement of their own, or 3+ statements voted | "Share this conversation so more neighbors take part." |

Two judgement calls worth flagging: **opposing a project does not prompt** (no reason to ask
someone to spread what they are against), and a conversation needs **three** votes, not one — one
vote is a tap, not a commitment. The conversation prompt sits below the voting UI so it never
interrupts the flow.

Verified live on dev at 375px for all four: cast a real ballot, endorsed a proposal, supported a
project, voted three statements through the live Polis conversation — each showed its own line with
the share row; the prompt was absent at one and two statement votes and appeared on the third.
Dismissing the project's prompt hid it, wrote `1`, and it stayed gone across a reload while the
proposal's prompt still showed — dismissal is per process, not global. Backend tsc clean, UI build
clean, `tests/unit` 686/686. Dev engagements reverted (endorsement row deleted, sentiment back to
neutral) and the uitest session deleted; the anonymous dev ballot on the energy vote is left, as
ballots cannot be withdrawn.

**Not built, awaiting Adam's word** (from the same conversation): the share prompt for a process
*creation*, which cannot live at submission — a submitted process is `pending_review`, and
`NON_PUBLIC_STATUSES` makes it not publicly fetchable, so sharing then hands out a dead link. It
belongs at approval instead: the `notifyCreatorApproved` email, plus the creator's first view of
the now-live page. Also proposed and not built: a share invitation on the outcome pages (brief,
vote results, completed project), where the link is most worth sending.

---

## Outcomes page had no horizontal padding — 2026-09-04

Adam: "the outcomes page has the same issue as the projects page had — there's no padding on the
left and right."

Confirmed on prod at 375px and, because this is now the second page with the fault, measured every
public page rather than fixing the one that was reported. The leftmost content offset:

| Page | class | left |
|---|---|---|
| /votes, /projects, /propose, /deliberations | `page page-home` | 24px (cards) |
| /about | `page about-page` | 24px |
| /search, /terms, /privacy | `page search-page` / `legal-page` | 16px |
| detail pages | `page detail-page` | 24px |
| **/outcomes** | `page outcomes-page` | **0px** |

Outcomes is the only page flush against both screen edges — so a targeted fix is right, not a
systemic one. The cause: `.page` itself carries no padding. The section list pages inherit their
indent from `.hub-info` (the "Floyd County, Virginia" block they all render), and detail pages from
`.detail-page`. Outcomes renders its own `<header>` instead of `.hub-info`, so nothing indented it.

Fix: `.outcomes-page` gets `padding-left/right: var(--space-lg)` (1.5rem — the same value
`.detail-page` uses, and what the list cards on /votes measure at).

Verified on dev at 375px: heading, intro, filter pills and cards all at 24px with cards 327px wide,
identical to /votes, no horizontal overflow. At 1100px the page still caps at 780px with the
heading 24px inside it. UI build clean.

---

## The assistant offers help with every field; "Done — back to the form" — 2026-09-04

Adam: "I was working with the assistant and we hadn't come up with any sources, but it never
prompted me asking if I had any or if I would like it to look up sources. It should always seek to
request information for each field available in the form… but not necessarily make it a
requirement. If the person says there is nothing, it's fine to leave it blank. But they should
always be asked before proceeding."

**The cause was structural, not a prompt-wording problem.** `formatDraftState` listed only fields
that HAD content, from a hardcoded set of five keys. An empty field was therefore invisible in the
prompt — the model had to notice a missing line — so a draft could reach the end with Sources
never mentioned. The same hardcoding meant a field a new type declared would not appear at all.

- **The draft state is now registry-driven and names what is missing.** One line per field in
  `config.fields`, empty ones rendered as `Sources: (still empty)`, followed by either
  `Fields still empty: Sources, Seed statements` or `Every field has content.` Multi-line values
  keep their line breaks. `fieldLabel()` humanizes an unknown key, so a type that declares a new
  field reads correctly here with nothing to register.
- **One rule added under "Drive the process":** every field gets asked about once. A field that is
  empty and has not come up yet is the next offer — Sources included, where the offer is to go and
  look. Ask once, concretely, one at a time. If they decline, say plainly that blank is fine, never
  raise it again, move on. It states outright that empty fields never block submission and the
  assistant must never imply they do — this is an offer, not a checklist.
- The completion condition changed from "when every field has something" to "when every field is
  either filled or has been offered and declined".

**Verified live on dev** (real model calls, not mocks). Conversation draft with only title and
description → "Almost there! Two fields are still empty — Sources and Seed statements. Both are
optional, but each adds real value" → a specific offer for each, having already searched and found
Floyd-specific STR coverage. Replying "No sources, I do not have any and I do not want any. But yes
please draft the seed statements" → "Got it — no sources, that's totally fine" plus the seed
statements card, no second ask. Same on a proposal (different field set): named Sources as the gap,
searched, delivered shelter cost ranges and a comparable rural example as a card.
`tests/unit/assistantDraftState.test.ts` (11) pins the rendering for all four types, including that
a vote is never told Considerations is empty (it has no such field).

**"Done — back to the {type} form"** (`AssistantPanel` `onDone`, wired to the existing
`assistant.onClose` in `DraftShell`, so one handler serves both layouts: on a phone it flips the
switcher back, on desktop it collapses the panel). Adam: once suggestions are applied or not,
"you kind of just reach the end and there's nothing to do" — the switcher and the × both sit at
the top of a conversation you have scrolled down, so there was nothing under your thumb where the
reading actually ends. Full-width, under the input row in the pinned footer. Verified on dev at
375px: the button reads "Done — back to the conversation form", and pressing it returns to the
form with the switcher on the form tab.

Backend tsc clean, UI build clean, `tests/unit` 686/686. Dev test drafts and the uitest session
row deleted; no processes were created (nothing was submitted).

**Noticed, not changed:** reopening the assistant restores the chat text from
`conversation_history` but not the suggestion cards — they live on the response, not in storage, so
an Apply button is gone once the panel is reopened. Pre-existing; worth a decision later.

---

## The assistant never ends a turn on a promise — 2026-09-04

Adam, on prod, drafting a conversation: he asked the assistant to dig through the news for Floyd
County issues. It replied **"On it — let me take a look at what's been in the news lately for
Floyd County."** and stopped. "It should never say it's going to do something and not do it.
Either say it can't do it or do it."

This is the 2026-09-02 failure again, and the reason is instructive: the guard added then,
`claimsToBeSearching`, required the reply to contain the word "search" (or "look it up" /
"find some"). Adam's reply said neither — "take a look at what's been in the news" — so the
nudge never fired and the promise shipped. A phrase list will always leak; the fix is to stop
depending on one alone.

Three layers now, in `civic.assistant`, all in the shared `callAssistant` path, so every process
type and any type added later gets them by construction:

1. **Prevention — a rule in the system prompt** (`## Web search`): never announce an action you
   are not completing in this same message. It spells out *why*, which is the part the model can
   reason from: the message is delivered only when the whole turn ends, so there is no "next
   message" in which to follow through. Search in this turn, or say plainly that you can't.
2. **Detection — structural first, linguistic second.** `deliveredNothing(parsed, serverToolUses)`
   is the real test: no suggestion card, no draft proposal, no server tool call means the turn
   delivered nothing whatever its prose claims. Only then is the wording consulted, by
   `promisesToFollowUp` (replaces `claimsToBeSearching`): a first-person future marker
   (`I'll`, `I'm going to`, `let me` — but not `let me know`) plus any action verb, or an
   unambiguous idiom on its own (`on it`, `hang on`, `give me a moment`, `stand by`, …), on a
   reply under 400 characters. Because it is only ever reached for a turn that produced nothing,
   a false positive costs one extra model round and never a wrong answer — so it can afford to be
   broad, which is exactly what the old one couldn't.
3. **Backstop — two promises in a row is not shippable.** The nudge asks the model to do the
   thing now or say it can't. If that reply *also* delivers nothing and *also* reads as a promise,
   the message is replaced with "I wasn't able to do that just now — sorry. Try asking again, or
   paste anything you've already read and we can work from that." That is the guarantee Adam
   asked for: do it, or say you can't. (The first draft of this fallback tripped its own
   detector — "I'll try again" — which the test caught. The copy carries no promise now.)

Also: `withSomethingToSay` — an empty or whitespace `message` can no longer render as a blank
bubble; it becomes either a line pointing at the card that did come back, or an honest "I didn't
manage a reply that time."

`tests/unit/assistantSearchNudge.test.ts` (8): the prod reply verbatim as a regression case, the
double-promise backstop, the empty-message guard, `let me know` and "I can search whenever you
like" as non-promises. Backend tsc clean, `tests/unit` 675/675.

**Still true and worth knowing:** the pause_turn continuation in `utils/anthropic.ts` (2026-09-02)
handles the case where the search *does* run and the API pauses the turn. That path was not at
fault here — `serverToolUses` was 0, meaning no search was ever attempted.

---

## Section tabs: bare chevrons and a one-time peek — 2026-09-04

Adam, on the chevron chips shipped an hour earlier: "those two white circles with arrows take up
too much space and it looks cluttered. I could see arrows without the white circles or maybe when
somebody's on mobile for the first time... a motion that scrolls that section from conversations
to outcomes all the way forward and backward slowly so they see it... once they click on the area
they take over control... I feel like that's more subtle."

Both, as asked:
- **The chip is gone.** A bare 20px chevron in `--color-text-muted` on the same live fade; the
  hit area narrowed 56px → 44px. The arrow still says which way the tabs run; it no longer sits
  on the strip like a button.
- **A one-time peek** (`PEEK_SEEN_KEY`, sessionStorage — once per visit, not once forever, so a
  returning resident is reminded but nobody is animated at on every route). 450 ms after the
  strip settles it slides to the far end of the hidden tabs and back: 1200 ms out, 250 ms hold,
  1000 ms back, ease-in-out, driven by rAF on `scrollLeft` so it can be stopped mid-frame. It
  heads for whichever side hides more, so from the Feed it is the full sweep out to Outcomes and
  back, and on a deep link it still reveals the larger hidden run. Skipped entirely under
  `prefers-reduced-motion`, and skipped when nothing overflows. **Any `pointerdown`, `touchstart`,
  `wheel` or `keydown` on the strip stops it where it stands** — the person takes over mid-slide,
  which is what Adam asked for.

Verified on dev at 375px: first load sweeps 0 → 246 → 0 and stamps the key; the next page load in
the same session moves 0px and the active tab still centres (Votes at 145); clearing the key,
reloading and firing `pointerdown` 900 ms in froze it at 97 and it stayed there. UI build clean.

---

## Section tabs on phones: the active tab is always in view, and the edge hint is real — 2026-09-04

Adam (smoke test, day 2): the mobile menu still bothered him — he likes Feed pinned and the rest
scrolling, but "there's a fade over votes to kind of indicate that you can scroll over, and it's
still not obvious enough… I'm concerned it's not obvious enough for others to scroll over to see
projects and outcomes."

Looking at it turned up a defect underneath the cosmetic complaint. At 375px the strip fits
Feed | Conversations | Proposals and about two letters of Votes, and **it never scrolled itself**:
opening /projects or /outcomes left the active tab at x≈504–590, entirely off-screen, with no tab
underlined at all. The bar looked identical to the Feed page, so it did not just fail to invite a
scroll — it misreported where you were. Same class of problem as the detail-page fix on 09-02.

The old fade could not help either: it was a static `::after` painted on every viewport under
600px, so it was there when nothing overflowed and still there at the end of the strip. A hint
that is always on is decoration, not a signal.

Both are fixed in `FeedVotesTabs` alone — one shared component above every section, so all four
types and any type added later inherit it with nothing to declare:

- **The active tab scrolls into view**, centred, on mount and on every route change, including
  detail pages via the existing `DETAIL_SECTIONS` mapping. The container's `scrollLeft` is
  assigned rather than animated: a smooth scroll started during page load is cancelled by the
  layout still settling around it, which is exactly how Votes and Projects stayed parked at 0 in
  the first cut. The pass then **verifies the tab really is within the container's box** before
  recording the route as done, so a pass that ran against half-settled layout is retried instead
  of trusted; retries run on the next frame, after `document.fonts.ready` (label widths change
  when the web font swaps in — this was the actual cause of the first failure), and on
  `ResizeObserver`. Once centred for a route it stops, so a manual scroll is never yanked back.
- **The edge affordance is live and tappable.** `more.left` / `more.right` come from the real
  scroll position, so a fade appears only while tabs are actually hidden that way and disappears
  at each end — and a left one now exists at all, which is what tells you the strip has been
  scrolled. Each fade carries a 26px bordered chevron chip (`--color-surface` ground, navy glyph,
  1px border, small shadow) in a 56×43 hit area that scrolls the strip 80% of a screenful.
  A gradient alone reads as a rendering artifact; a circle with a border reads as a control.
  `aria-hidden` + `tabIndex={-1}` — tabbing through the links already scrolls them into view, so
  the buttons are pointer affordances only and add nothing for screen readers.
- The `@media (max-width: 600px)` wrapper is gone: the affordance keys off actual overflow, so a
  narrow desktop window behaves correctly too, and a wide one shows nothing.

Verified on dev at 375px: /deliberations, /propose, /votes, /projects, /outcomes and one detail
page of every type (project, brief, conversation, proposal, vote) all land with the section tab
on-screen and underlined; arrows are right-only at the start, both in the middle, left-only at
the end; the right chevron is the topmost element at its own centre (nothing overlays the tap
target) and one tap moved the strip 145 → 245 of 247. At 1100px: no overflow, no arrows. Resizing
375 → 900 live clears both arrows without a reload. UI `npm run build` clean, backend tsc clean,
`tests/unit` 671/671.

**Offered, not built:** the alternative configuration is to stop hiding tabs at all — let the
five sections wrap to a second row under the pinned Feed on phones. Nothing to discover, no
affordance needed, at the cost of roughly 44px more sticky chrome under the top nav. Say the word
and it is a small CSS change.

---

## Session close — 2026-09-03 (beta smoke test, day 1)

**Where the smoke test stands.** Adam walked the front door, sign-in, the skate park project
(edit flow), sharing, and the admin review queue; every finding below was fixed, verified on dev,
committed and deployed the same day. The 20-step checklist artifact
(https://claude.ai/code/artifact/e593887e-888c-4b06-9c38-28017a4bda6e) resumes at step 2 in
order; its "Known before you start" note is stale (everything it lists is deployed).

**Commits today (all on main, all deployed; prod = `9cbd1f2` after the last push):** sign-in
modal names both cases · brief ↔ source pointers · social previews for every page type (+ the
`page` param fix) · terminal actions at the bottom · share by text, type colors, terracotta
outcomes · Vercel npm-12 lockfile fixes (3) · description formatting (Markdown subset, toolbar,
assistant rule, comment bubbles) · project editing (visible history, title lock, digest line,
supporter badge, creator-only, legacy drafts, admin Edits tab, CoC-only check, Get suggestions,
cancel button, Submit edits dialog, word-diff stepper, formatting-only rule, in-place diff,
toast) · admin reviews type pills + filter + header · share row without email.

**Test coverage.** Unit tests cover every pure piece added today: `shareMeta` (+ the vercel.json
rewrite guard), `markdown`, `processEdits` (diff, locks, formatting rule, `isSubstantiveEdit`,
projects-only policy), `digestEditItems`, `wordDiff`; 671 green. The DB-backed readers
(`editNotifications.listEditNotifications` / `listAllEdits`, the digest cron's supporter
prefetch) were verified end to end on dev, not unit-tested — same as the rest of the hub (CI runs
`tests/unit` only). UI verification = `cd ui && npm run build`.

**Project banner (2026-09-04):** top corners squared, bottom rounded (`.project-banner`
`border-radius: 0 0 12px 12px`) — the rounded top left the tab-strip rule overhanging the fillet.

**Open / deferred:** WYSIWYG description editor (TipTap over the same Markdown subset) — offered
for after the smoke test; (project page horizontal padding: fixed 09-04 — `ProjectDetail` uses `page detail-page` like every other detail page, 24px on a phone); Facebook caches the
old preview for URLs shared before today (Sharing Debugger → Scrape Again); Adam to try the
share sheet's Copy/Messages on his phone.

---

## Admin process reviews: type pills, type filter, shared header — 2026-09-03

Adam: the review cards need a pill saying what type each is, a dropdown to filter by type, and
the review page needs the type pill above the title like everywhere else. `AdminReviews.tsx`:
the grey `review-type-badge` is replaced by the same colored `process-type-pill` the detail
pages wear (`friendlyType` + `typeColorSlug`, so a new type gets a sensible label and the
generic color with no change here); a "Type" `<select>` beside the status buttons whose options
are built from the reviews present (with counts) and combine with the status filter; the review
page header is the shared `ProcessHeader` (pill → title → review-status chip → "Submitted by"
line). Verified on dev (27 reviews across the four types): pills colored per type, dropdown
lists the four with counts, choosing Conversation narrows the list, detail header matches the
public pages. UI tsc + vite build clean.

---

## Project editing: visible history, supporters notified — 2026-09-03

Adam: project owners must be able to change the description, sources, banner and related
processes after publishing (the Updates log is a progress feed, not an editor) — but people who
supported a project signed on to particular words. Decision: **only projects are editable**;
every other type stays uneditable once submitted. Edits are allowed, visible, and announced:

- **Who may edit: the creator only.** Adam: "I'm not sure the admin should be able to edit
  the project." Admins keep archive and moderation; `getEditPolicy` refuses anyone but the
  creator. **No admin review of edits** — they go live at once; the Code of Conduct check still
  gates every edit (the draft submit refuses hard blocks and unchecked changes). **Admins are
  notified**: `listEditNotifications(userId, isAdmin)` returns EVERY edited process for an admin
  (supporters get the ones they support), so the same avatar dot + menu group ("Projects
  edited") tells the admin, clearing when opened.
- **The check is the Code of Conduct check, full stop — every type, creation and edits.** Adam:
  "the code of conduct check… shouldn't be suggesting changes as much as catching code of
  conduct issues… the writing assistant should be a different thing." `handleAssistantReview` now
  always runs `checkTextAgainstCoC` (hard blocks only, ~3 s); the old best-practices review turn
  is gone from the button (it returns as "Get suggestions", below). The `coc_only` flag added
  earlier the same evening was removed as redundant.
- **Formatting-only edits are saved but not recorded.** Adam (bolded two labels on the skate
  park; the history showed an "edit" with an empty diff): "only track changes that are more
  than formatting changes." `diffEdit` compares text fields by `substanceOf()` — Markdown
  stripped, whitespace collapsed; punctuation and case still count — and returns
  `formatting_only_fields` + `formatting_values` alongside the substantive `changed_fields`.
  `applyEdit` writes both (processes row, `onEdited` mirror) but emits the event, history entry
  and digest/badge notice only for substantive changes. The submit reply carries
  `formatting_only_fields`; the project page says "Formatting updated." Tests in
  `processEdits.test.ts`. Verified on dev: bold-only
  → saved, 0 edits recorded; one word → 1 edit.
- **The post-save notice is a toast, not a bar.** Adam: "I don't think we should have a
  persistent green bar that requires them to check it away." `.project-edited-toast`: fixed
  bottom-center pill ("Your project has been updated." / "Formatting updated." / "Nothing
  changed…"), fades out on its own after ~4.5 s (no animation under reduced motion), and the
  router state is cleared on mount so a reload never replays it (the text is captured once into
  state before clearing — the first cut re-read the cleared state and said "Nothing changed").
- **Share links never carry `#edits`.** Adam: copy link / message / email were sharing the URL with
  the change history open. `ShareButton` builds its URL from origin + path + query, never the
  hash, so a shared link always lands on the plain page. The **email button was dropped**
  (Adam): a `mailto:` link looks dead on a desktop with no default mail app, and people can
  paste the copied link. Share row = copy link · Facebook · text message · Share… (phones).
- **Readers skip pre-rule formatting-only entries.** `isSubstantiveEdit()` (processEdits.ts) is
  applied in `listEdits`, the supporter/admin notification readers and the digest builder, so the
  blank "edits" the skate park recorded before the rule never show anywhere. Tested.
- **"See what changed" stands in for the description.** `EditHistory` reports `onOpenChange`;
  `ProjectDetail` hides the live description while the diff is open, so the change reads in
  place instead of under a duplicate; "Hide changes" brings the description back.
- **"Edit project" is a navy button** (white text) beside the status badge; a **locked title shows
  as plain text** (`.form-locked-value`) with the lock note, not an input box that looks editable.
- **"← Cancel editing" is a navy button** (`DraftShell` `backAsButton`, `.back-link--button`), not
  grey text, in edit mode.
- **History = a word diff, one edit at a time.** Adam: "10 changes and you say see what changed
  it's gonna open up a huge long page… it should be more elegant"; also asked about storage.
  Storage: one event row per edit holding before/after of only the changed fields as plain text
  (a long description ≈ 2 KB), nothing copied on read — not a weight. `EditHistory` now opens on
  the most recent edit ("Edit 3 of 3 · date · creator · changed description") with ‹ › arrows to
  step back; text fields show a word-level diff (`components/wordDiff.ts`, LCS over words on the
  Markdown-stripped text — removed words struck through in red, added words in green;
  `tests/unit/wordDiff.test.ts`), list fields (sources, links) show removed/added items, the
  banner shows old → new. Verified on dev with three edits: opens on 3 of 3 (sources: +budget
  link), ‹ → 2 of 3 ("Early" struck, new status added), ‹ → 1 of 3.
- **Admin notice of edits → the admin panel "Edits" tab, not the dropdown.** Adam (after editing
  the skate park on prod): "I definitely don't want it in the drop down menu for the admin
  account… a new tab that says edits." `GET /admin/edits` (`listAllEdits`): every edited process
  of any type in the last 90 days, newest first, with the union of changed fields and an
  `unseen` count against the same `edits_seen_at` cursor; `pages/AdminEdits.tsx` (route
  `/admin/edits`, `AdminTabs` "Edits" tab with a red count badge) lists them, marks new rows, and
  stamps seen on open. Nothing is approved there — it is an overview. The account dropdown's
  group is supporters-only for everyone now (`/notifications/edits` no longer has an admin mode).
- **After saving an edit the page says so.** The confirm dialog's button read "Submit for
  review" on edits; it is now **"Submit edits"** (Adam's wording; footer button too; dialog title
  "Submit your edits"), the "your edits go live right away" callout is project-blue
  (`.confirm-finality-warning--edit`) so it reads as the point of the dialog, and the dialog's
  description preview renders as rich text (all four types — it showed raw `**` markers). The
  project page then shows a green
  "Your project has been updated. The change is listed below under 'See what changed'." notice
  (or "Nothing changed, so nothing was saved.") passed via router state — never "submitted".
- **"Get suggestions" — the writing review, as its own button.** Adam: "maybe we need a new
  button on all processes that says make suggestions… and then the code of conduct thing is
  distinctly different. I still want the flow where you talk to the assistant." Three actions
  now, each doing one thing: the **Code of Conduct check** (gate, hard blocks only), **Open the
  assistant** (chat; drafts with you), **Get suggestions** (one click: the best-practices review
  of the current draft, cards with Apply, shown in the assistant panel). `POST
  /assistant/:type/drafts/:id/suggest` (`handleAssistantSuggest` — the former review turn:
  `callAssistant({phase:"review"})`, appended to the conversation, NOT saved as the check
  result, so advice never counts as having run the check). `useDraftFlow.handleSuggest` opens
  the panel with "Reviewing your draft…" and pushes the cards; `DraftShell`'s help card has both
  buttons (`assistant.onSuggest`), so every type gets it from one place, it vanishes with
  "Hide AI drafting help", and it is absent on edits (`assistant={null}`). Verified on dev:
  thin draft → 2 soft cards (title, description) in ~15 s; `last_review_result` untouched;
  submit still refused until the check runs; browser: both buttons on /projects/new, click →
  panel opens, cards with Apply.
- **Every edit starts from the live project.** Adam: the skate park "seems to be stuck in edit
  mode" — the recorded draft still held an abandoned edit's text and a stale suggestion card.
  New seam `syncDraftFromProcess(draftId, process, links)` (projectAdapter: overwrite the
  draft's submitted fields from the live `projects` row + creator links, set
  `last_review_result = null`, `draft_modified_since_review = true`); `startEdit` calls it on the
  creator's recorded draft every time. Cancel = a **Cancel** button beside **Save changes** in the
  footer (edit mode relabels Submit), plus the back link "← Cancel editing"; nothing is saved
  until Save. Verified: type a change, Cancel → project page shows the live text, no edit recorded. Verified on dev: abandon an edit with a stale check result →
  next start edit shows the live text, no result, check required again.
- **(Superseded the same evening by the above) Edits get the hard Code of Conduct check ONLY, and no assistant.** Adam (editing the skate
  park on prod): the check "took like 10 seconds" and a soft fact-checking suggestion appeared —
  "we don't want editing help with edits, only with the initial process creation." The draft
  review endpoint now accepts `{coc_only: true}` and runs `checkTextAgainstCoC` (hard blocks
  only; no best-practices pass, no web search, no chat turn), saving the result the same way so
  "modified since review" clears. `useDraftFlow({cocOnly})` sends it; `ProjectDraft` sets it in
  edit mode and passes `assistant={null}` to `DraftShell`, so the help card, switcher and FAB
  are gone on edits. Verified on dev: clean edit → "No Code of Conduct issues" in ~4 s, 0
  suggestions, submit applies; a threatening edit → one `hard` block, submit refused 400, live
  text untouched. `.coc-results` panel: 40vh → 60vh with an inset scroll shadow (a long card
  clipped flat at the panel border looked like it spilled into the field below).
- **Registry seam** (`types.ts`): `editPolicy(process)` → `{editable, locked_fields, reason}`,
  `listSupporters(processId)`, `onEdited(process, changes)`. Only `projectAdapter` declares
  them: editable while the `projects` row is `active`; the **title locks once anyone supports**
  (the title is what people endorsed); supporters = `project_sentiments` where `support`;
  `onEdited` mirrors title/description/sources/banner into the `projects` row (the detail page
  reads that table). `tests/unit/processEdits.test.ts` pins that civic.project is the only type
  with a policy.
- **Shared service** `services/processEdits.ts`: `getEditPolicy` (creator or admin, then the
  handler), `startEdit` (reopens the draft the review recorded — same `reopenDraft` seam as the
  revise flow — and returns `draft_path?draft=&edit=<id>&locked=title`; 409 for a process with no
  draft on record), `diffEdit` (pure: per-field before/after; locked fields and
  `assistant_helped` ignored; link order irrelevant), `applyEdit` (updates `processes`, replaces
  the creator's links, calls `onEdited`, emits ONE `civic.process.updated` with
  `data.edit = {changed_fields, previous, current, editor_role}`; a no-op submit writes
  nothing), `listEdits` (reads the event log — no new table).
- **Notification = the digest, not an email per edit.** Adam, on seeing the first cut: "I don't
  want an email firing to everyone who has engaged with a project every time any little edit
  has been made." So `applyEdit` sends nothing. `civic.digest` gained `buildEditItems` (pure,
  `tests/unit/digestEditItems.test.ts`): for each user, one row per edited process THEY support
  (the type's `listSupporters`, prefetched once per cron run in `digestController`), however
  many edits it had in their window, never for the editor — "You support this · edited" pill,
  summary "A project you support was edited (N times)… see what changed", link to `#edits`,
  in the Projects section at the user's own cadence. Non-subscribers get nothing by email; the
  page carries the history. A progress update never produces this row.
- **In-app badge for supporters** (Adam: "does the person get a notification… like the admin
  does… in case they're not signed up for the digest"). **Migration**
  `supabase/migrations/20260903230000_edits_seen_at.sql` — `users.edits_seen_at TIMESTAMPTZ`
  (schema contract updated; `/health` reports the gap until applied — **apply to dev, then prod
  BEFORE pushing**). `services/editNotifications.ts`: the handler seam `listSupportedBy(userId)`
  (projectAdapter: `project_sentiments` support rows) → edit events on those processes after
  `edits_seen_at`, not by the user, grouped per process. `GET /notifications/edits` →
  `{count, items[{process_id,title,href(#edits),edits,latest_at}]}`, `POST /notifications/edits/seen`.
  Nav: the avatar dot now counts reviews + edited-supported projects; the account menu shows a
  "Projects you support were edited" group listing them ("N edits · see what changed"); opening
  one stamps seen (awaited BEFORE navigating — the route change re-polls) and clears the group.
  Polled with the review count (60 s, 30 s GET cache).
- **Processes with no draft on record.** (The `draftFromProcess` seam also keeps an editor out
  of anyone else's draft, should a type ever allow non-creator edits.) Prod's only
  active project (the skate park) was reviewed in July, before `process_reviews.draft_id`
  existed, so the first cut's `startEdit` would have 409'd. New seam `draftFromProcess(process,
  editorId, links)` (projectAdapter: a fresh `project_drafts` row prefilled from the live
  `projects` row + creator links). `startEdit` uses the review's recorded draft when it is the
  editor's own; with none recorded it seeds one and records it on the review.

Verified on dev after the column landed: resident supports → creator edits → resident
`/notifications/edits` count 1 (creator 0) → seen → 0 → second edit → 1 again; avatar dot +
menu group in the browser, click → `/project/<id>#edits` with history open. Legacy path: review
`draft_id` nulled → start edit seeds a new draft (prefilled with the CURRENT description), records
it on the review, an edit from it applies. (Admin editing was verified on dev before being removed
the same evening; the admin now gets the notification instead.) Both test projects archived;
uitest sessions deleted.
- **Routes** on `/process` (universal): `GET /:id/edits` (public), `GET /:id/edit-policy`
  (signed in), `POST /:id/edit` (creator/admin). `projectDraftController` submit accepts
  `edit_process_id` and calls `applyEdit` (the Code of Conduct check still gates the submit).
- **UI**: `ProjectDetail` — "Edit project" beside the status badge (only when the server's policy
  says editable), `components/EditHistory.tsx` under the description: "Edited <date> by the
  creator · See what changed" → newest-first entries, each field before/after (description as
  rich text), opens automatically at `#edits` (the email link). Mounted on all four detail pages
  (renders nothing where nothing was edited). `ProjectDraft` reads `?edit=` / `?locked=`: title
  "Edit your project", locked title input + note, confirm copy "Your changes go live right away…",
  submit with `edit_process_id` → back to the project at `#edits`. Progress updates (the Updates
  box) are untouched and never notify.

Verified on dev end to end: modern project created via the draft path as admin → resident
supports → policy flips to `locked_fields: ["title"]`; resident's policy: not editable; start
edit → draft reopened (status drafting); draft edited (title change, description, second source,
a related process) → submit with `edit_process_id` → `changed_fields: [description, sources,
links]` (title ignored), `processes` + `projects` rows + links updated, one edit event; no-op resubmit → `changed_fields: []`, still one edit. Browser: signed out,
"Edited September 3, 2026 by the creator · See what changed" with before/after; as the creator,
Edit project → "Edit your project", title disabled with the lock note. Fixed on the way: the new
hooks in ProjectDetail sat below the loading early-return (hook-order crash) — moved up.
Backend + UI tsc, vite build, `tests/unit` green. Test project archived; uitest sessions deleted.

---

## Vercel builds: lockfile installs (npm ci) — 2026-09-03

Two consecutive Vercel builds of `50dd0d9` sat 5+ minutes and were cancelled (earlier builds
today took ~40 s). The log showed the ROOT `npm install --include=dev` alone taking 4.5 min
(18:25:11 → 18:29:52), then the silent UI install doing the same. Two causes stacked:
- `package-lock.json` at the root was out of sync with `package.json` (a transitive
  `@emnapi/wasi-threads` bump), so `npm ci` was impossible and every build re-resolved the tree.
- Vercel's Node 24 image now ships an npm newer than local 11.6.2 (it prints the `allow-scripts`
  warning about esbuild's postinstall — a warning, not the failure), and its full resolve is slow.

Fix: lockfile re-synced (`npm install --package-lock-only`; `npm ci --dry-run` clean at root and
ui), `vercel.json` install/build now use `npm ci --no-audit --no-fund` (lockfile-only, no
registry resolution, no audit round-trip), and `.npmrc` (root + ui) sets `audit=false`,
`fund=false`.

**Follow-up (same evening):** the first `npm ci` build failed in 3 s — Vercel's Node 24 image now
runs **npm 12** (its usage text lists `--allow-directory` / `--allow-scripts`), which resolves
`@napi-rs/wasm-runtime`'s optional peers (`@emnapi/core`, `@emnapi/runtime` 1.11.3) into the
lockfile, and a lockfile written by npm 11 lacks them → "Missing … from lock file". Fix:
both lockfiles regenerated with npm 12 (installed to the session scratchpad, not the repo:
`npm install npm@latest` there, then `<scratch>/node_modules/.bin/npm install
--package-lock-only`), verified `npm ci --dry-run` clean under npm 12 AND local npm 11.6.
`npm install-scripts approve esbuild` (npm 12's command) wrote `"allowScripts":
{"esbuild@0.27.4": true}` into the root package.json so the postinstall warning is gone. When a
dependency changes from now on, regenerate the lockfile the same way (npm 12) before pushing.
Third try failed with `tsc: command not found`: Vercel builds with `NODE_ENV=production`, under which
`npm ci` omits devDependencies — the old commands carried `--include=dev` for that reason; restored
on both install commands. If a future build still crawls, the next lever is the Vercel project setting
Node.js Version → 22.x (npm 10, no allow-scripts), no code change. Note: a Vercel build's UI
install prints nothing until it finishes — give a build ~8 min before calling it stuck.

---

## Description formatting: Markdown subset, toolbar, assistant, and comment cards — 2026-09-03

Adam: a formatting toolbar for descriptions ("bold **what we need right now** and **status**"
on the skate park), for all process types, with the assistant using the same formatting. Built
as one system:

- **Format:** a small Markdown subset — bold, italic, "- " / "1. " lists, [text](url) links; a
  bold label on its own line is the section convention. Stored in the existing `description`
  columns (and project `updates.content`); no migration. Plain text is valid Markdown, so nothing
  already written changes. The rule text lives once in `src/shared/markdown.ts`
  (`DESCRIPTION_MARKDOWN_RULE`) and is quoted verbatim into the assistant's system prompt.
- **Render:** `ui/components/RichText.tsx` (react-markdown + remark-gfm, already deps): `skipHtml`,
  `allowedElements` = p/strong/em/del/ul/ol/li/a/br/blockquote with `unwrapDisallowed` (no
  images, no headings, no raw HTML), links `target=_blank rel=noopener`. Single newlines are kept
  as line breaks (pre-wrap parity) EXCEPT on list lines and the line before a list, so labels and
  items don't gap open. `.richtext.richtext` (doubled selector) overrides the containers'
  `white-space: pre-wrap`. Used by Process (votes), ProposalDetail, ProjectDetail (description +
  each update), DeliberationDetail + DeliberationPanel (framing).
- **Toolbar:** `ui/components/MarkdownTextarea.tsx` — Bold, Italic, Section, • List, 1. List,
  Link, Preview (renders with RichText). A drop-in for `<textarea>`: props pass through; edits go
  through the native value setter + an `input` event, so each form's own onChange/debounce/PATCH
  path runs exactly as for typing (verified: toolbar edits landed in `project_drafts`). The
  textarea stays mounted (visually hidden) during Preview so the assistant's Apply-by-id
  (`draft-description`) keeps working. Mounted for the description in all four drafting forms and
  for project updates.
- **Assistant:** one rule in the draft-generation section of `systemPrompt.ts` (format only where
  it helps; the subset; bold label + list for structure; suggestion cards use the same). The Code
  of Conduct check (`checkTextAgainstCoC`) reads `stripMarkdown()` text.
- **Plain-text surfaces:** `stripMarkdown()` applied in search `cardSummary` and `shareMeta`
  (social previews). Feed cards and the digest never used descriptions (event-derived copy).
  `tests/unit/markdown.test.ts` (4).
- **Comments:** every comment is a white speech bubble — 14px corners, a small tail sticking up
  from the top-left, one rule set in App.css for `.input-item` (proposals, votes) and
  `.project-comment-item` (projects) so they match (Adam, later the same day).

Verified on dev: a proposal created through the real draft path with bold labels, italic, a link,
a bullet list and a numbered list — detail page renders strong/em/ul/ol/a (rel noopener, no
HTML); `/share/meta` and `/search` return stripped text; CoC review passed with the markers
present; toolbar on /propose/new, /votes/new, /projects/new, /deliberations/new; Section → bold
label with a blank line, Bullets → "- " per selected line, Link → `[text](https://)`; Preview
renders; autosave confirmed in the DB. Skate-park stand-in (plain "- " lines) renders as a list
unchanged in meaning. Backend + UI tsc clean, vite build clean, `tests/unit` 655/655.
Test proposal `proc_c260327fa39d4376` archived; test draft + uitest session deleted.

---

## Share by text / email; design pass: type colors on detail pages, terracotta outcomes — 2026-09-03

**Share row** (`ShareButton`): two plain-link channels added between Facebook and the sheet —
text message (`sms:?&body=<title> <url>`) and email (`mailto:` with subject + body). The native
share button (phones) is now labeled "Share…" — it is the route to Instagram, Snapchat, TikTok,
Discord, iMessage, none of which accept a link from a web page any other way. No X / Reddit /
Bluesky: not where a county hub's residents share.

**Design pass** (Adam: outcomes and process pages "a little boring… add some of that
terracotta"). All through shared styles, so every type — and the next one — inherits:
- `components/typeColor.ts` `typeColorSlug(type)` → the `--type-<slug>-*` token family; the
  `ProcessHeader` pill now wears its type's color (vote navy, proposal plum, conversation teal,
  project blue, word cloud moss; unknown types → generic). New tokens in theme.css:
  `--type-brief-bg/fg/rule/wash` = the terracotta accent scale, used by briefs and vote results.
- Brief / vote-results page (`VoteResults.css`, `Brief.tsx/.css`): headline in terracotta; every
  section `h2` gets a short terracotta rule; the Summary section is a tinted card
  (`vote-results-section--summary`, accent-50 wash + accent-600 left border); "Awaiting response"
  chip terracotta (Responded stays the feed's official-response gold, as do response cards).
- Completed conversation card (`CompletedDeliberation.css`): header band in the conversation
  teal bleeding to the card edges, COMPLETED badge solid teal (was Material green), section
  titles with a short teal rule.
- Vote page: the Results heading is a tinted band in the vote's navy tokens (`App.css`).

Verified on dev: brief (pill, headline, chip, summary card, section rules), completed energy
conversation, farm-stand vote results, café project pill. UI tsc + vite build clean.

---

## Terminal actions at the bottom of every detail page — 2026-09-03

Adam (signed in as admin): the project's "Mark complete" sat at the top beside the title; it
and "Archive project" belong at the very bottom, before the footer, so nobody clicks them by
accident. New `components/DetailActions.tsx` (+ css): a single row, top rule, mounted as the
LAST child of every detail page — Process (votes), ProposalDetail, DeliberationDetail,
ProjectDetail, Brief — holding that page's end-of-life actions. The block hides itself with
`:empty` when nothing rendered for the viewer (AdminArchiveButton returns null for non-admins),
so residents see no stray rule. Project: "Mark complete" (creator or admin) moved out of the
header into the row beside Archive. Proposal and conversation pages previously had Archive ABOVE
Related (proposal: above the comments too); all five now end Related → actions. A type added
later mounts `DetailActions` once and gets the same placement.

Verified on dev as the admin: project bottom row = [Mark complete, Archive project], header has
no button; proposal / vote / conversation / brief: actions row is the last child of `.page`.
Signed out: the row is present but empty, computed `display: none`. UI tsc + vite build clean.

---

## Social previews for every page type; native share sheet gets the link — 2026-09-03

Adam (smoke test, sharing the energy brief): Facebook showed the generic hub card, and the native
share sheet's Copy / Messages "didn't seem to work".

**Facebook — cause:** `api/og.ts` (the Vercel function that serves Open Graph tags to crawlers)
hand-enumerated page kinds and fetched a different endpoint for each; `/brief` was never added
when briefs split from vote-results (Slice 8.5), and `vercel.json` had no `/brief/:id*` rewrite,
so the brief URL went straight to the static `index.html`. **Fix, registry-driven:**
- `GET /share/meta?page=/section/id` (`services/shareMeta.ts`, `controllers/shareController.ts`,
  mounted at `/share`): loads the id as a process, requires the handler's `detailPath` to agree
  with the section in the link (so `/admin/<id>` or a wrong section is 404), refuses non-public
  statuses and anything with `state.publication_status !== "published"` (briefs, vote results),
  then builds `{title, description, image, path}` from the row — title, description trimmed to
  200 chars at a word, first `*image_url` on `state` / `state.content` / `content`.
- New optional handler seam `describeShare(process)` (types.ts): partial override, or `null` for
  "not shareable". Declared on `briefProcess` and `voteResultsProcess` only (headline as the
  description). Every other type — and any added later — gets the default.
- `api/og.ts` now makes ONE call to `/api/share/meta` and renders; no per-kind branches. Also
  strips the `?id=` that Vercel's rewrite appends, so `og:url` is the bare path.
- `vercel.json`: `/brief/:id*` → `/api/og`. `tests/unit/shareMeta.test.ts` iterates
  `getAllHandlers()` and fails if any handler's detailPath section lacks an `/api/og` rewrite —
  the guard that would have caught this — plus resolver/refusal cases (28 tests).

Verified on dev: `/share/meta` for brief (headline), conversation, vote, proposal, project
(café), word cloud → 200 with the right words; wrong section / admin / archived brief → 404;
`api/og.ts` exercised locally with fetch mapped to the dev hub: crawler UA gets the brief's
og:title/description/url, browser UA gets the SPA. Backend + UI tsc clean, vite build clean,
`tests/unit` 650/650.

**Share sheet — cause:** `navigator.share({title, text, url})`. Safari / iOS hand the sheet two
items and Copy / Messages take the `text` — the link never travels. `ShareButton` now shares
`{title, url}` only (the `shareText` prop is still accepted, unused); the destination's own
preview carries the topic. **Needs Adam's device to confirm** — the Browser pane cannot open the
OS sheet.

**Prod regression, same day (fixed in the follow-up commit):** the endpoint first shipped reading
`?path=`. On Vercel, the `/api/:path*` rewrite appends its own `path=share/meta` capture to the
query, so prod received that instead of the page and EVERY page 404'd "Not shareable" — including
conversations that had worked with the old per-kind code. Dev (no rewrite) was fine, which is why
the smoke passed. Parameter renamed to `page`; `pagePath()` takes the first value that starts with
`/` (unit-tested). Lesson for anything behind `/api/:path*`: never name a query parameter `path`.

**After deploy:** Facebook caches a URL's preview. For the brief URL already shared, re-scrape
it at developers.facebook.com/tools/debug ("Scrape Again"); fresh URLs pick up the new tags
immediately. Check with `curl -A facebookexternalhit https://floyd.civic.social/brief/<id>`.

---

## Brief ↔ source pointers at the top of the page; brief page layout — 2026-09-03

Adam (smoke test, energy conversation): a completed conversation should link to its brief, and
the brief should link back — the pair existed, but only as "Summarized by" / "Summarizes" rows
inside the Related panel at the bottom, which he missed. Also: the brief page looked "indented",
and its "Sent to …" receipt was a washed-out light blue.

- **`components/BriefPointer.tsx`** (+ css), two exports, both reading the SYNTHETIC brief pair
  the links API already derives from `state.source_process_id` (`getBriefLinks`) — nothing is
  stored, nothing asks what type it is on, so any type that declares `generateBrief` gets both
  for free:
  - `BriefPointer` on a process page: "The final brief is published. Sent to X on DATE." +
    a navy **Read the brief →** button. Renders nothing until a brief exists (the active energy
    vote shows nothing). Mounted right under `ProcessHeader` on Process (votes), DeliberationDetail,
    ProjectDetail, ProposalDetail.
  - `BriefSourcePointer` on the brief page, above the headline: "This brief summarizes the
    completed {type} <title>" + **Open the {type} →** (type word from the shared `friendlyType`).
- **`VoteResults.css`**: `.vote-results-page` drops its 720px centered column for the same
  `1.5rem` padding as `.detail-page`, so the brief (and legacy vote-results) page sits where every
  other detail page does. `.vote-results-delivery` is now navy (`--pill-vote-fg`) with white text.

Verified on dev for all four source types: energy conversation → `proc_beta_brief_energy_001`,
farm-stand vote → its brief, recycling proposal `proc_69cda899e1fa420a` → `proc_09713c46665c4297`,
and a project created through the real draft path as the admin, completed, brief approved with
`recipients: []` (no delivery), pointer present both ways. 375px: no horizontal overflow, button
goes full-width. UI tsc + vite build clean.

**Dev side effects (all archived, restorable):** `[uitest] Brief pointer project`
`proc_1543e344398f4630` + brief `proc_44d73fcbc9724541`; brief `proc_19115325f48745cf` from
completing the legacy `[TEST] Community Tool Library` `proc_ccec8c5f00274a93` (that project is now
`completed`; it has no `processes` mirror row — pre-2026-08 projects created via `POST /projects`
never got one — so the links API cannot pair it and its brief; modern projects go through the
review funnel and are fine). uitest session rows deleted.

**Noticed, fixed 2026-09-04 (`page detail-page`):** the project detail page had no horizontal padding below its banner at
narrow widths (`ProjectDetail` uses `.page` without `.detail-page`); the pill/title/meta sit flush
left on prod today. Separate fix.

---

## Sign-in modal names both cases: "Sign in or create an account" — 2026-09-03

Adam (smoke test, step 2): the nav's Sign in button opened a box titled "Create an account to
participate", which reads as sign-up, not sign-in. One passwordless flow serves both (email →
code; the server only learns new-vs-returning after the code verifies, when newcomers get the
residency gate), so the modal now names both cases and lets the beta flag pick the supporting
copy — flip `VITE_BETA_MODE` off at launch and the same component reads as plain sign-in/sign-up
with no code change:

- Title (and the dialog's aria-label): **Sign in or create an account**.
- Beta (`hub.beta_mode`): "Beta testers: enter the email address you were invited with and we'll
  send you a one-time code." Footnote under Continue: "Not on the beta list yet? Join the
  waitlist" — opens the existing in-modal waitlist panel (previously reachable only by having an
  unlisted email rejected), which gained a "Back to sign in" link so it is no longer a dead end.
- Production: "Enter your email and we'll send you a one-time code. No password needed."
  Footnote: "New here? Same step — your account is created when you verify the code."
- `AuthModal.tsx` only, plus `.auth-footnote` / `.auth-inline-link` in App.css. Same component
  everywhere it opens (nav, welcome dialog, every requireAuth action on every page), so it holds
  for all process types by construction.

Verified on dev: production variant on the plain UI server (5173), beta variant on the
`civic-ui-beta` launch config (5174, `VITE_BETA_MODE=true`); waitlist link → panel → Back to
sign in round trip; 375px: no horizontal overflow. UI tsc + vite build clean.

---

## What a new process type gets for free, and what it must declare — 2026-09-02

Adam asked for today's fixes to hold for every type, present and future. Verified on dev for
proposal, vote, project, and conversation (revise round trip via API for all four; phone layout,
switcher, and type header in the browser for all four). The contract, so the next type inherits
the same behavior:

**Free — shared code every type flows through (nothing to declare):**
- Creation and review: `submitForReview` / `submitAsCreator` (links materialized, `draft_id`
  recorded), `reviseAndResubmit` (title/description/content/state/links replaced in place),
  `POST /reviews/:id/reopen`, the review pages' full-submission preview (generic `content` walk).
- Drafting UI: `DraftShell` (phone layout with pinned footer, form/assistant switcher, help card),
  `useDraftFlow` (resume a draft for revision, assistant chat), `ProcessLinkField`
  (title lookup for pre-existing links), `SubmissionPreview`, `ProcessHeader` (type pill from
  `friendlyType`, which humanizes unknown types).
- Assistant: paused search turns continued, one-time nudge when a search is promised but not
  run, only hard blocks persisted from chat, the "drive the process" prompt rule over
  `config.fields`.

**Must declare on the `ProcessHandler` (registry-driven — no page enumerates types):**
- `detailPath(id)` — its public page. Also add a `DETAIL_SECTIONS` entry in `FeedVotesTabs` if it
  has its own section tab.
- `draftPath(draftId)` + `reopenDraft(draftId)` — its drafting page and how to flip its draft back
  to drafting (revise flow). Its draft controller must pass `draft_id` to `submitAsCreator` and
  branch to `reviseAndResubmit` when `review_id` is in the submit body (copy any of the four).
- `describeSubmission(source)` ONLY if part of the submission lives on `state` rather than
  `content` (votes, conversations); otherwise the generic walk covers it.
- `getAssistantConfig()` if it has a drafting assistant; `requiredSchema` for its own tables
  (a `links JSONB` column on its drafts table, like the four existing ones); `generateBrief` if
  closing it should produce a brief.
- Its drafting page passes `processType` and `formVersion` to `DraftShell`, and `resumeDraft`
  from `?draft=` to `useDraftFlow` (copy any of the four pages).

---

## Assistant: a promised search is never the end of a turn — 2026-09-02

Adam (on prod, minutes before the pause_turn fix deployed at 18:23Z): "Searching now — give me a
moment." then nothing until he typed "Hello", which delivered the sources card. That is the
pause_turn bug below, but the ask was broader: *if it's gonna do something it should do it.* So,
on top of the client fix: `callClaudeMultiTurn` now reports `serverToolUses` (count of
`server_tool_use` blocks in the turn), and `callAssistant` nudges the model ONCE, inside the same
request, when a reply narrates a search (`claimsToBeSearching`: "searching now", "let me look that
up", …), no search ran, and nothing actionable came back — the follow-up says "run the search now,
put the links in a suggestion card". Logged as a warning so it is visible in the function logs.
`tests/unit/assistantSearchNudge.test.ts`. Tab label stays "Assistant" ("Drafting assistant"
wraps on a phone; the page it sits in is already the drafting page).

**Chat cards no longer leak onto the form view.** `handleAssistantMessage` saved EVERY chat
suggestion as the draft's `last_review_result`, so a sources card from the chat reappeared on the
form page under "Code of Conduct check" — and, as a side effect, chatting counted as having run
the check ("Ready to submit" without pressing it). Now only HARD blocks from chat are persisted
(they gate submission and must show on the form); soft cards stay in the chat, where Apply
already works. A chat-only session therefore still has to run the Code of Conduct check before
submitting, which is the documented rule.

---

## Phone drafting: form ↔ assistant switcher; assistant search turns fixed; assistant leads — 2026-09-02

**Switcher (Adam: the assistant covered the form, no obvious way between them).** On phones the
drafting page now has a sticky two-tab switcher — "Conversation form | Assistant" (type name from
the registry label) — and the assistant view uses the same switcher as its header, so one control
sits in the same place in both views. The chat persists across switches (messages live in
`useDraftFlow`). When the draft changes while the assistant view is up (draft written, Apply
pressed), the form tab shows a small rust dot. The floating "✦ Assistant" pill from earlier today
is gone (redundant); the "Want help drafting?" card stays as the explainer. `DraftShell` gained
`processType` / `formVersion` props (the four pages pass them); `AssistantPanel` gained `header`
and `placeholder` props (placeholder no longer says "your proposal" on every type).

**Search turns lost their results (Adam: "On it — searching now" then nothing; "these sources"
with no sources).** Root cause in `src/utils/anthropic.ts`: the web_search server tool can pause
the turn (`stop_reason: "pause_turn"`) and hand back the pre-search text plus a `server_tool_use`
block; the client only recognized client-side `tool_use`, so it returned that text as the whole
reply — the search summary and the sources suggestion card never arrived. Fix: on `pause_turn`,
send the content back as the assistant message and continue (`tests/unit/anthropicPauseTurn.test.ts`).
Also `max_tokens` for the drafting assistant 1536 → 4096 (a search reply's JSON was being cut off,
which also drops its cards), with a warning logged when a reply hits max_tokens.

**Assistant leads (Adam: it should be saying "want me to add seed statements? sources?").**
`systemPrompt.ts` gained a "Drive the process" section: every reply that adds or changes something
says plainly what it did and where it is (the suggestion card, click Apply), then makes exactly one
concrete next-step offer for the next empty/thin field in the form's field order — generic over
`config.fields`, so it reads "seed statements" on a conversation and "sources" on a proposal.

---

## Every detail page says what it is — 2026-09-02

Adam (on a phone): a proposal's title was cramped beside its status pill, and nothing on the page
said it was a proposal — the Proposals tab went quiet the moment you opened one. Two changes:

- **`components/ProcessHeader.tsx`** (+ css): the one header for every process page — a type
  pill (PROPOSAL / VOTE / PROJECT / CONVERSATION / BRIEF / WORD CLOUD, from the shared
  `friendlyType` map, which humanizes unknown types so a future type renders sensibly) above a
  full-width, balanced title, with the status badge beneath and an optional `aside` (share
  button, jurisdiction) and `children` meta row. Used by ProposalDetail, Process (votes),
  ProjectDetail, DeliberationDetail (the panel/completed views got `showTopic={false}` so the
  topic isn't shown twice; a not-yet-started conversation reads "Waiting to start"), Brief, and
  WordCloud (its status is now the shared badge, not the raw status string).
- **`FeedVotesTabs`**: a detail route highlights its section — `/proposal/` → Proposals,
  `/process/` and `/votes/` → Votes, `/project/` → Projects, `/deliberation/` → Conversations,
  `/brief/` and `/vote-results/` → Outcomes (`aria-current="page"` too).

Verified at 375×812 on dev: pill → title (327px wide) → status on the proposal, vote, project,
both conversation states, brief, and word cloud; the right tab is active on each. No horizontal
overflow. UI tsc + vite build clean.

---

## "Edit & resubmit" reopens the real drafting form; drafting forms on phones — 2026-09-02

**Revise flow (Adam, smoke test: "when I added content and hit resubmit, it doesn't seem to be
resubmitting").** The creator's revise UI was a title + description box, so anything else they
changed (sources, banner, options, seeds, links) had nowhere to go. Now:

- **Migration** `supabase/migrations/20260902150000_process_reviews_draft_id.sql` — nullable
  `draft_id` on `process_reviews`, set by `submitForReview` from `SubmitForReviewInput.draft_id`
  (each of the four draft submit controllers passes its draft id). **Applied to dev** (Adam,
  dashboard). **Apply to prod BEFORE deploying** — the review insert writes the column.
- **Registry hooks** (`ProcessHandler.draftPath?(draftId)` and `reopenDraft?(draftId)`, same seam
  as detailPath): each of the four handlers declares its drafting page URL and how to flip its
  draft back to "drafting". `registry.draftPathFor` / `reopenDraftForRevision`. A type added
  later declares those two lines and gets the whole flow.
- **`POST /reviews/:id/reopen`** (`reopenForRevision`): creator-only, `changes_requested` only;
  flips the draft to drafting and returns `{draft_id, draft_path}` (path carries `?draft=…&review=…`).
  Reviews without a draft on record (pre-column) return nulls → the inline form remains as fallback.
- **`reviseAndResubmit`** now takes `state` (re-initialized through the handler exactly as
  submitForReview does — votes/conversations) and `links` (the creator's edges are replaced;
  admin-added ones are kept). The four draft submit controllers accept `review_id` in the body
  and, when present, revise in place instead of `submitAsCreator` — never a second process.
- **UI:** `useDraftFlow` gained `resumeDraft` (+ `resuming`); the four draft pages read
  `?draft=` / `?review=`, load that draft (form waits on it — inputs are `defaultValue`), title
  "Revise your …", and submit with `review_id`. `MySubmissions` "Edit & resubmit" calls reopen and
  navigates there. `ProcessLinkField` resolves titles for links it did not pick itself (a resumed
  draft's) so they don't render as raw ids.

Verified on dev, API + browser: submit → admin request-changes → reopen (draft back to drafting)
→ edit sources/banner alt/related process in the real form → conduct check → resubmit → same
process id, status pending_review, history submit / request_changes / revise_resubmit, new
content on the process, links swapped, `processes` count for the title = 1; a reopen while
pending is refused 409. Test review left on dev as `rev_fd9b7d8c6ba948e7` (pending).

**Drafting forms on phones (Adam: "the form is embedded within the page… you have to go way
down low" to find the status and submit; "I don't see the open AI assistant").** Cause: the
shell sized itself to `100vh − nav`, but on a phone the word-cloud ribbon and section tabs also
sit above it, so the fixed box ran ~75px past the screen; the footer landed below the fold with a
second inner scroll, and the assistant was a bare "?" bubble overlapping it. `ProposeDraft.css`
mobile block: page flows normally, `.drafting-form-footer` is `position: sticky; bottom: 0`
(+ safe-area padding); `DraftShell` renders the "Want help drafting?" card on mobile too and the
FAB is a labeled "✦ Assistant" pill whose `bottom` clears the measured footer (ResizeObserver).
Shared classes → all four forms. Verified at 375×812 on all four: footer pinned on load, pill
above it, single scroll, no horizontal overflow.

---

## Submission previews show everything that was submitted — 2026-09-02

Adam (smoke test): a pending project on My Submissions showed title + description only — no
banner, no sources; the admin review page was no better for projects/proposals/votes (their
`content` was a raw JSON toggle; only conversations had a per-type block). Ask: make both previews
show the whole submission, for every type, and keep working for types added later.

**Design — registry-driven, generic by default.**
- `src/shared/submissionPreview.ts` (pure; shared by backend + UI like feedActivity):
  `describeSubmissionFields(source, extraStateKeys)` walks the process `content` block —
  `content` is by convention what was submitted — turning each key into a typed field via
  key-aware presenters (`*image_url` → image with its `_alt` companion; URL lists / `{url,label}`
  objects → links; `*_ms` → duration in the picker's vocabulary; string lists → list; `options`
  → ballot options; `method` → readable label; booleans → flag; `sections` → structured sections)
  and a `json` last resort so nothing submitted is ever dropped. Labels: a small map for known
  keys, humanized otherwise. Display order: image, prose, links, lists/options, settings, flags.
- `ProcessHandler.describeSubmission?(source)` (types.ts) + `registry.describeSubmission(source)`:
  default = the generic walk; a handler whose submission lives on `state` extends it —
  `voteProcess` adds `method`, `options`, `config.voting_duration_ms`; `deliberationBoot` adds
  `seed_statements`, `sources`, `duration_ms`, `participation_threshold`. A new type gets the
  default with no change anywhere; only state-carried fields need a one-line declaration.
- `GET /reviews/:id` (creator + admin variants) now returns `submission: SubmissionField[]`.
- UI `components/SubmissionPreview.tsx` (+ css) renders the list (banner figure, description,
  labeled fields, flags line, optional raw JSON toggle) and falls back to the client-side generic
  walk when a server predates `submission`. Both `MySubmissions` and `AdminReviews` use it; the
  admin page's conversation-only block and `parseSourceLine` import are gone.
- Quirk handled: the vote draft stores the whole "Label: https://…" line in `links[].url`; the
  presenter parses the real URL out so anchors work.

Verified on dev: one pending submission per type as a non-admin resident (project with banner +
two sources; proposal with link, category, considerations, 6-week window; approval vote with three
options + a source + 2-week window; conversation with three seeds, a source, 6 weeks, goal 40).
Creator pages and admin pages render all of it. `tests/unit/submissionPreview.test.ts` (10 tests,
incl. a novel-type case). tsc clean both sides, vite build clean, `tests/unit` 622/622. Test
submissions withdrawn on dev.

---

## Conversation drafts carry process links — 2026-09-02

Adam noticed the conversation creation flow had no link picker. Cause: conversations joined the
drafting pattern on 2026-08-28 (`deliberation_drafts`), three days after process linking shipped
(2026-08-25) into the proposal / vote / project drafts, and the new table and form were built
without the links column and field. Nothing downstream was type-specific — the review funnel
(`submitForReview` → `createEdges`) already materializes links for any process type — so the fix
is the conversation-side plumbing only, mirroring the proposal path:

- **Migration** `supabase/migrations/20260902120000_deliberation_drafts_links.sql` — `links JSONB
  NOT NULL DEFAULT '[]'` on `deliberation_drafts`. **Applied to dev** (Adam, via the dashboard —
  the CLI here is linked to prod). **Apply to prod BEFORE deploying this code**: a PATCH carrying
  links fails on the missing column otherwise. Schema contract now lists
  `deliberation_drafts` (`sources`, `links`), so `/health` reports the gap if the order slips.
- **Backend** `civic.deliberation_drafts` model/storage carry `links`; `deliberationDraftController`
  validates them on PATCH (`validateLinkSet`, same as proposals) and passes `draft.links` into
  `submitAsCreator`.
- **Frontend** `DeliberationDraftingForm` mounts `ProcessLinkField` after Links / Sources, before
  Seed statements (`processType="civic.polis_deliberation"`); `ConversationDraft` holds the
  local links + titles state and patches with `skipModifiedFlag` so picking a link never
  invalidates a passed Code of Conduct check. `api.ts` types updated.

Verified on dev end-to-end through the API as the admin: draft → PATCH two links (references the
energy conversation, continues the café project) → bogus relation rejected 400 → draft reload
keeps links → submit (auto-approved) → the live conversation's `/links` shows both edges. The
form renders the picker at `/deliberations/new`. Test conversation archived on dev. tsc clean
both sides, vite build clean, `tests/unit` green.

---

## Re-acceptance modal no longer covers the legal pages — 2026-09-02

Bug (Adam, smoke test): a signed-in account on an older legal version gets the "We've updated our
Terms" / "Before you continue…" modal, whose links open Terms / Privacy / Code of Conduct in a new
tab — and that tab, being the same signed-in app, mounted the modal again on top of the page the
person had clicked through to read. Same shape as yesterday's welcome-dialog bug, same fix:
`ReAcceptModal` now returns null when `pathname` is in the new `LEGAL_PATHS` set (`/terms`,
`/privacy`, `/code-of-conduct`, in `ui/src/config/betaPublicPaths.ts`). The modal still gates
every other route, so acceptance is still required to use the app. Verified on dev with a
tos_version_accepted = null account: the three legal pages render bare, `/` still shows the
modal. UI tsc + vite build clean.

---

## Word cloud: "Continue to the Floyd Civic Hub" always shown — 2026-09-02

Adam: the proceed button after the word cloud should not be onboarding-only — "add it everywhere,
it just goes to the feed." `ui/src/pages/WordCloud.tsx`: the `.wordcloud-proceed` block now renders
on every visit, labeled "Continue to the {hub.name} →" (hub config name, so demo/white-label hubs
read right), navigating to `/`. The "Thanks — you're all set." note still appears only during
onboarding after the word is added; the top "Skip →" is unchanged. Verified on the dev UI signed
out: button present on a normal visit, click lands on `/`. UI tsc + vite build clean.

---

## Beta demo content slate — seeded on PROD — 2026-09-01

**Script:** `scripts/seedBetaSlate.ts` (`--env dev|prod`, `--dry-run`, `--remove`). Source of
truth for the content is outside the repo: `~/Documents/Civic Social/Mosaic Foundation
Management/Civic Social/Floyd Civic Hub/Rollout Plan/Seed-Content-Slate.md` (v2, 2026-09-01) and
`Seed-Content-Draft.md` (verbatim text). Don Kenny (§10) is IN, per Adam ("use that name; it's a
demo exploration of what the building could be").

```
cd ~/Developer/Civic-Social-Mono/civic-hub
npx tsx scripts/seedBetaSlate.ts --env prod --dry-run   # plan + before-matrix, writes nothing
npx tsx scripts/seedBetaSlate.ts --env prod             # seed (idempotent; reruns skip what exists)
npx tsx scripts/seedBetaSlate.ts --env prod --remove    # clear the slate (restores the kept items)
```

**Prod audit (read-only, 144 processes).** Nothing from the old `seedProdDemo` ids is left on
prod. The July 1 session had already entered the Draft slate as real reviewed processes:
Water `proc_7fca320b59f649c5` and Recreation `proc_6fbc00d6498045ef` (both **finalized** — they
auto-closed by deadline on 2026-08-10, not "live" as the slate assumed), trails vote
`proc_861a092e431845a3` (proposed, 1/5), tool library `proc_c34075135a2b451d` (open, 3 supports,
2 comments), skate park `proc_58293e6945e44a98` (active, banner) plus a stranded pending-review
duplicate `proc_d945fcbbd0e84a86` (changes requested, never resubmitted). Flock camera, green-box
votes, and the June test items are already archived. `proc_d99682d772c648fc` ("Which of these
would you most like to see the Hub used for first?", 08-27, admin) is Adam's own beta question —
left alone. Announcements and 74 BoS meeting summaries are the real pipelines — untouched. Admin
account on prod: `user_4f02a6460fc64b2b`. `hub_id` is `civic-hub-local` on every prod row (the
`CIVIC_HUB_ID` env is unset there; nothing reads it — the DID is the identity).

**What the script does** (through the real code paths — `createProcess`, the civic.vote module
lifecycle, civic.input, civic.projects/proposals, processLinks, the deliberation handler's real
`start` action for live Polis, and the civic.brief `setRecipients` → `approveBrief` sequence):

| Type | State | Item | id |
|---|---|---|---|
| Conversation | open (leads the feed) | Where We Agree | `proc_beta_conv_agree_001` (live Polis, 12 seeds, 6 wks) |
| Conversation | open | Don Kenny building | `proc_beta_conv_donkenny_001` (live Polis, 8 seeds; by Maya) |
| Conversation | open (kept, **reopened**) | Water | prod `proc_7fca320b59f649c5` — status → active, deadline +6 wks, Polis `conversation/reopen` |
| Conversation | open (kept, **reopened**) | Recreation | prod `proc_6fbc00d6498045ef` — same |
| Conversation | completed + brief | Keeping the lights on (energy) | `proc_beta_conv_energy_001` (closed −15d, stored summary, `seed-conv-energy-001` mock id) → brief `proc_beta_brief_energy_001` (published −13d, sent to Board of Supervisors) |
| Proposal | open (kept) | Tool library | prod `proc_c34075135a2b451d` + 1 demo comment (Tomas) |
| Proposal | completed → advanced | Farm stand | `proc_beta_prop_farmstand_001` (Reuben, −35d; 5 supports, 4 comments; `converted` → vote, −21d) |
| Vote | proposed (kept) | Trails + recreation budget | prod `proc_861a092e431845a3` + 2 demo endorsements → 3/5, "needs 2 more" |
| Vote | active | Energy-resilience step | `proc_beta_vote_energy_001` (approval method, opened −7d, closes +7d, 30 ballots) |
| Vote | closed + brief | Farm stand at the Pavilion | `proc_beta_vote_farmstand_001` (proposed → 5 endorsements → auto-activated −21d → 58 ballots 36/14/8 → closed −7d → **finalized** by the brief) → brief `proc_beta_brief_farmstand_001` (published −5d, sent to Board + Parks & Rec) |
| Project | active (kept, refined) | Skate park | prod `proc_58293e6945e44a98` retitled "Floyd Skate Park at Lineberry Park" (Draft §PROJECT verbatim) + 2 updates; links → Recreation + trails vote |
| Project | completed | Conversation Café | `proc_beta_proj_cafe_001` (Della, −40d; 3 supporters; update + completion update; completed −21d; links → Where We Agree) |
| — | archived | stranded skate-park duplicate | prod `proc_d945fcbbd0e84a86` via `archiveProcess` (restorable) |

Demo residents (fictional, `@demo.invalid`, digest opted out): Maya Whitlock `user_demo_beta_001`,
Reuben Sloane `_002`, Della Kirkwood `_003`, Tomas Ferrell `_004`; the admin account posts the
flagship conversation, the energy pair, and one endorsement/sentiment each so bylines vary.
Signed out every one of them renders as "Resident N"; the admin as "Admin".

**Briefs — the hard rule, verified.** Both briefs go through the real pipeline with ONE
substitution: the injected `sendEmail` is a logging stub. The script never imports the mailer and
scrubs `SMTP_*`/`RESEND_API_KEY` from its own env at bootstrap; the recorded recipient addresses
are on the reserved `.invalid` TLD. Dev run log: 2 "SUPPRESSED" lines, 0 `[mailer]` lines. Note
the transport is SMTP (nodemailer), not Resend — Resend only sends sign-in codes / waitlist /
feedback.

**Two things the rehearsal surfaced (both fixed):**

1. **`events` is append-only — UPDATE blocked by trigger** (DELETE allowed since migration
   20260416000100). Backdating after the fact is impossible, so every emitter the script uses is
   handed an `emit` that passes the planned `timestamp`; row tables get `created_at` set directly.
2. **`eventStore.eventToRow` dropped the event's timestamp on insert** and let `created_at`
   default to now(), so the documented `timestamp` override (`CreateEventInput.timestamp`,
   `createProcess.eventTimestamp`) never reached the column the feed sorts on. Fixed:
   `created_at: event.timestamp` (src/events/eventStore.ts). No production caller passes an
   override today (news-sync deliberately doesn't), so live behavior is unchanged; tsc clean,
   `tests/unit` 612/612 green.

**Dev rehearsal (2026-09-01):** `--env dev` creates stand-ins for the five kept prod items first,
then runs the same 18 steps. Verified on the dev UI signed out: feed leads with Where We Agree;
closed vote shows 36/14/8 of 58 + "Voting finalized" + link to its brief; brief page shows "Sent
to Board of Supervisors and Parks & Recreation on …" + "Awaiting response"; proposed vote shows
"3 of 5 endorsements / Needs 2 more endorsements to proceed to an official vote"; completed
proposal shows "Promoted to a vote / converted to an official vote" + Continued-by link; completed
project shows COMPLETED + both updates; closed conversation renders the stored summary (35
participants, 28 statements, 3 groups); Where We Agree serves its Polis seed statements; a demo
resident's ballot on the active vote was accepted (tally 31). `--remove` on dev is clean.

**Known / flagged:**
- `tests/api/events.test.ts` "pages: next walks the whole sequence" now times out on the shared
  dev DB: it pages 2 at a time and 126 events × ~200 ms > its 15 s limit. Pagination itself is
  clean (walked manually: 10 pages, 0 duplicates). Not in CI (only `tests/unit` runs).
- Polis `conversation/close` timed out (20 s) from this machine; `conversation/reopen` and create
  work. Best-effort either way; the hub closes locally regardless.
- The Projects list page filters `active`/`archived` only, so a **completed** project (the café)
  is reachable from the feed, links, and its detail page but not from the Projects tab.
- Slate §2 asks for "single choice, 1 of 4"; the only methods are `yes_no_unsure` and `approval`,
  so the energy vote is `approval` (UI says "Select all options you approve of"). Seeded ballots
  each pick one.
- The farm-stand vote page shows the proposal's 4 comments (existing proposal→vote behavior).

**Prod run (2026-09-01, 16:41 ET, Adam's go-ahead after confirming events stay append-only).**
All 17 steps completed; Polis reopen succeeded for Water (`3fkvnmwhdc`) and Recreation
(`55jadepafe`); new Polis conversations `9hmshipyra` (Don Kenny) and `4fa6jtybhe` (Where We
Agree). Log: 2 SUPPRESSED deliveries, 0 `[mailer]` lines; both briefs' recorded `delivered_to`
are `@demo.invalid` addresses. No email left this machine and the prod deploy was not involved
(the script ran locally against the prod database; the eventStore fix is not deployed and does
not need to be — the seeded rows already carry correct `created_at`).

**Verified on floyd.civic.social, signed out (a–d from the brief):**
(a) feed leads with Where We Agree, then Don Kenny, skate-park update, farm-stand VOTE RESULTS
card, the 08-25 BoS summary, the energy VOTE OPEN card, then the real Aug announcements/summaries
— the slate interleaves with the real pipelines in date order;
(b) closed vote: COMPLETED, 36/14/8 of 58, "Voting finalized", Vote Log, comments, brief link;
brief pages: "Sent to Board of Supervisors and Parks & Recreation on August 27" / "…Board of
Supervisors on August 19" + "Awaiting response"; proposed trails vote: GATHERING SUPPORT, 3 of 5,
"Needs 2 more endorsements"; farm-stand proposal: PROMOTED TO A VOTE + "converted to an official
vote" + Continued-by link; café: COMPLETED with both updates; energy conversation: Completed with
the stored summary; Where We Agree: live, serves seed statements; energy vote: ACTIVE and accepted
a ballot from demo resident Maya via the API (now 31 ballots; the temporary verification session
was deleted);
(c) every demo resident renders as "Resident N", the admin as "Admin"; signed in, the farm-stand
proposal reads "Reuben Sloane";
(d) no delivery email fired (see above).

**Final prod matrix:**

| Type | proposed | open / active | completed / closed |
|---|---|---|---|
| Conversation | — | Where We Agree `proc_beta_conv_agree_001` · Don Kenny `proc_beta_conv_donkenny_001` · Water `proc_7fca320b59f649c5` (reopened) · Recreation `proc_6fbc00d6498045ef` (reopened) | Energy `proc_beta_conv_energy_001` + brief `proc_beta_brief_energy_001` |
| Proposal | — | Tool library `proc_c34075135a2b451d` | Farm stand `proc_beta_prop_farmstand_001` (→ vote) |
| Vote | Trails `proc_861a092e431845a3` (3/5) · Adam's "which use first?" `proc_d99682d772c648fc` (1/5, untouched) | Energy step `proc_beta_vote_energy_001` (31 ballots, closes +7d) | Farm stand `proc_beta_vote_farmstand_001` (58, finalized) + brief `proc_beta_brief_farmstand_001` |
| Project | — | Skate park `proc_58293e6945e44a98` (Lineberry, 2 updates) | Café `proc_beta_proj_cafe_001` |
| Word cloud | — | `proc_wordcloud_floyd_001` (untouched) | — |
| Archived | stranded skate-park duplicate `proc_d945fcbbd0e84a86` (restorable) |||

Cosmetic, noticed on the live feed: the energy vote's card said "Open for input — be the first to
vote" while 30 seeded ballots existed, because the card counts `vote_participation` rows (none for
anonymized seeded ballots) rather than `vote_records`; Maya's real ballot makes it 1. Harmless for
beta; the vote page itself is correct.

**Removed and re-seeded the same evening.** Adam ran `--remove` by mistake (it worked exactly as
designed: kept items restored, demo rows gone) and the seed was re-run at ~17:00 ET. Same ids
throughout; only the live Polis conversation ids changed — Where We Agree is now `9jhwxaudyz`,
Don Kenny `3rbekkmnfn`. The first run's Polis conversations (`4fa6jtybhe`, `9hmshipyra`) are
orphaned but open on polis.civic.social because the close call timed out; harmless, nothing
points at them. Maya's verification ballot was not repeated, so the energy vote has 30 ballots.

**Uncommitted in this working tree:** `scripts/seedBetaSlate.ts` (new), `src/events/eventStore.ts`
(the created_at fix), this HANDOFF entry — plus the other session's UI files (App.tsx, Nav.tsx,
WordCloud.*, betaPublicPaths.ts) from earlier today. Commit when ready.

**To clear the slate later** (restores the kept items, deletes only demo rows):
```
cd ~/Developer/Civic-Social-Mono/civic-hub
npx tsx scripts/seedBetaSlate.ts --env prod --remove
```

---

## Legal-page dialog gate + onboarding "Proceed to the site" — 2026-09-01

UI-only; no backend change, no migration. Three items from Adam's brief.

**1. Welcome dialog no longer covers standalone info/legal pages.** The
sign-up consent line (AuthModal) and ReAcceptModal open Terms / Privacy /
Code of Conduct with `target="_blank"`; that new tab has no `civic_preview`
sessionStorage flag, so `showWelcomeDialog` was true again and the
BetaWelcomeDialog landed on top of the page the visitor clicked through
to read. `BETA_PUBLIC_PATHS` moved out of Nav.tsx into a new shared
`ui/src/config/betaPublicPaths.ts` (/welcome, /about, /feedback,
/code-of-conduct, /privacy, /terms); Nav imports it unchanged, and
App.tsx now adds `!BETA_PUBLIC_PATHS.has(pathname)` to the
`showWelcomeDialog` gate. A visitor who lands on one of these and then
navigates to / still gets the dialog (they haven't been through the
front door) — intended. Verified signed out with no preview flag: all
six routes load with no dialog; / still shows it.

**2. Onboarding "Proceed to the site" button.** The only onboarding
signal is the `?onboarding=1` query param the first-time sign-up path in
AuthModal redirects with (`hub.onboarding_wordcloud_id`); WordCloud.tsx
already reads it as `isOnboarding`. New block at the bottom of the page,
rendered only when `isOnboarding && wc.has_submitted`: "Thanks — you're
all set." + a primary "Proceed to the site →" button that `navigate("/")`s
(dropping the param, which is all "completing" onboarding means — there
is no other state). The top "Skip →" link is untouched. Styles in
WordCloud.css (`.wordcloud-proceed*`), same primary palette as the
submit button. Verified via the real sign-up flow in the dev app (fresh
email, bypass code → residency gate → redirect to
/wordcloud/proc-wordcloud-test?onboarding=1): no button before the word
is added, button after, click lands on /; the same word cloud opened
WITHOUT the param shows neither Skip nor the button.

**3. Waitlist email — verified required, no change.** Client: the field
is `type="email" required` and the submit button is disabled while empty.
Server: `handleJoinWaitlist` 400s with "A valid email is required." when
the value is missing or has no `@`.

tsc clean, UI build clean. Dev-DB side effect of the verification: one
throwaway resident `onboarding-test-20260901@example.com` (name
"Onboarding Tester") and one response ("the mountains") on
proc-wordcloud-test.

---

## BetaLanding wall → BetaWelcomeDialog front door — 2026-08-31

Adam's call after seeing the merged banner live: the full-page landing
wall felt wrong — a first-time visitor should SEE the browsable site,
with the invitation floating over it. `pages/BetaLanding.tsx` + `.css`
are DELETED; the front door is now
`ui/src/components/BetaWelcomeDialog.tsx` + `.css`.

- A logged-out first-time visitor lands on the REAL app (deep links
  included — /votes opens /votes) with the dialog over it: hub name,
  tagline, private-beta explainer, Sign in, "Browse the site →",
  feedback note, and the shared WaitlistForm (test-user checkbox
  included) — the same content the wall carried.
- Every way out (X, Escape, backdrop, Browse) calls `enterPreview()`;
  the visitor is then browsing read-only with the always-on BetaBanner
  carrying the beta/demo reminder — no second notice step (Adam
  explicitly walked that back). The dialog stays away for the session
  (same `civic_preview` sessionStorage flag as before) and returns next
  session.
- "Sign in" swaps the dialog for the shared AuthModal; dismissing that
  brings the dialog back, completing it signs the user in.
- `.beta-waitlist*` styles moved from BetaLanding.css into a new
  `components/WaitlistForm.css` imported by WaitlistForm itself — the
  form is used from three modals now, so its styles travel with it.
- App.tsx no longer has a pre-preview route branch: all public routes
  render the full app, `preview` only decides whether the dialog shows.

Also: **dev word cloud fixed** — `VITE_HUB_ONBOARDING_WORDCLOUD_ID`
points at `proc-wordcloud-test`, which had never been seeded in the dev
Supabase DB. Ran `node --env-file=.env --import tsx
scripts/seedWordcloud.ts` (15 sample responses); the wordcloud page and
the nav teaser strip now work in dev. Broader dev↔prod demo-data parity
(proposals/projects/conversation to match the prod seed set) flagged as
a follow-up task.

Verified in the dev app: fresh visitor on a deep link gets site-behind-
dialog; Browse closes in place (banner + CTA remain); reload does not
re-show within the session; Sign in ↔ AuthModal round-trip works;
mobile 375px scrolls the dialog with no horizontal overflow. tsc clean,
UI build clean.

---

## Beta banners merged into one always-on bar — 2026-08-31

Follow-up to the entry below, after Adam saw the two-banner design live:
the PreviewBanner→BetaDemoBanner swap flashed on reload, the demo notice
wasn't prominent enough, and "Join the waitlist" made no sense once
signed in. PreviewBanner and BetaDemoBanner are DELETED, replaced by one
`ui/src/components/BetaBanner.tsx` + `.css`.

- One navy bar for EVERYONE (signed-in testers and signed-out preview
  browsers) whenever `hub.beta_mode` is true: "You're browsing the
  {hub.name} beta — **much of what you see is demo content, not real
  community topics.** Real topics from {hub.jurisdiction} arrive at
  public launch."
- **Not dismissible, by Adam's call** — the reminder should follow
  testers everywhere for the whole beta. All sessionStorage dismissal
  code is gone.
- **More prominent:** base font size (was sm), demo clause bolded.
- **Waitlist CTA is signed-out-only** and now opens the shared
  `WaitlistForm` (test-user checkbox included) in a `<dialog>` modal —
  ProcessPicker's dialog conventions — so a browsing visitor doesn't
  lose their place. BetaLanding's inline form is unchanged.
- **Flash fixed structurally:** the bar text is identical in both auth
  states, and the CTA renders only once auth has resolved (`!loading`),
  so nothing swaps during the session-restore race on hard reload.

Verified in the dev app both signed out (bar + CTA → modal with
checkbox; Escape/backdrop/X close) and signed in via bypass (bar, no
CTA, no flash on reload); mobile 375px wraps cleanly, no horizontal
scroll. tsc clean, UI build clean. `usePreviewMode`'s enterPreview/
exitPreview and the BetaLanding wall are untouched (exitPreview is now
unused but kept as enterPreview's pair).

---

## Beta demo-data banner — 2026-08-31

UI-only; no backend change, no migration. New site-wide banner telling
beta testers that seeded processes are demo content, not real community
input. Primary audience is SIGNED-IN allowlisted testers — the one group
that previously saw no beta cue at all (signed-out visitors already get
PreviewBanner).

- `ui/src/components/BetaDemoBanner.tsx` + `.css` — thin navy top bar
  on the site's control accent (`--pill-vote-fg`, same family as the
  Feedback button / PreviewBanner) with white text, per Adam's mid-build
  call — a first amber warning-palette pass was reverted. The Dismiss
  control is a ghost (outlined) button vs PreviewBanner's solid white
  CTA, so the two bars still read as different messages. Copy: "Beta:
  much of what you see is demo content, not real community-proposed
  topics. Real topics from {hub.jurisdiction} arrive at public launch."
  role="region" + labeled Dismiss button.
- Mounted in `App.tsx` AppContent at the shell level (above Nav), so it
  shows on every route. Not rendered in the BetaLanding branch.
- **Reconciliation choice: SUPPRESS, not fold-in.** The banner renders
  only when `hub.beta_mode && !inBetaPreview` — while PreviewBanner is
  showing (signed-out preview), the demo banner stays hidden so no
  audience ever sees two stacked bars. PreviewBanner's copy/routing is
  untouched (it already carries two sentences + a CTA; a third clause
  crowded it on mobile).
- Gated purely on `hub.beta_mode` (VITE_BETA_MODE): flips off at public
  launch with zero code change.
- Dismissible per session via `sessionStorage` key
  `beta-demo-banner-dismissed` (distinct from WelcomeBanner's
  localStorage key, which is untouched) — dismissal survives client-side
  nav but the reminder returns next session.

Verified in the browser against the dev backend, signed in via the
bypass-code flow with beta mode on (the `civic-ui-beta` launch config,
port 5174): banner on every route incl. non-Home; suppressed in preview
mode (one bar only); absent on BetaLanding; dismiss persists across
in-app nav and returns after session reset; mobile 375px wraps cleanly,
no horizontal scroll. tsc clean, UI build clean.

Observation (pre-existing, not fixed): on a hard reload while signed in,
PreviewBanner can flash for signed-in users during the auth-restore
race (`inBetaPreview` doesn't wait on `loading`). The demo banner
respects the same flag, so the two never stack even during the flash.

---

## Public anonymity — resident names hidden from signed-out viewers — 2026-08-31

**SHIPPED to production** (commit `ecd26d1`, pushed 2026-08-31; Vercel
auto-deployed). No migration — everything is read-time. Post-deploy
verification against floyd.civic.social, unauthenticated: proposals
list returned `['Admin', 'Resident']` (no real names), and /events
actors came back as per-process `…/participants/anon-<digest>` IRIs —
same token for the same person within a process, different across
processes, confirming CIVIC_ANON_SECRET is live in prod. Adam to
spot-check signed-in (real names should be unchanged). Beta allowlist
still blocks signed-out browsing, so this is invisible to users until
public launch — the privacy layer shipped before anyone could be
indexed, which was the point.

Pre-ship verification: live dev curls (unauthenticated vs signed-in),
612 unit tests (incl. AS2 goldens, byte-identical for authenticated
callers), 6 API integration tests, tsc clean, UI build clean.

Housekeeping: the future "per-space public-identity setting" idea lives
in the Mosaic Foundation Management folder (`Civic Social/Future Tasks/
space-engine-public-identity-setting.md`), NOT in any repo — planning
docs stay out of the monorepo per Adam.

**The rule.** `audience = 'member'` when the request carries a valid
session token, else `'public'`. Members and admins see exactly what they
saw before — nothing about the signed-in experience changed. The public
(open internet, scrapers, indexers) never receives a resident's real
name or admin flag. Officials (users.official_type + official_title)
keep real name + office pill for everyone; the Admin capability pill is
never shown to the public, even on an official.

**Where it lives.**
- `src/services/creatorDisplay.ts` — `redactForAudience()` is the ONE
  decision point; `enrichCreator`/`enrichCreators` now REQUIRE an
  `audience` option (tsc forces every call site through the rule).
  Post-time snapshot fields (`author_display_name`, `author_name`) are
  overridden too when the author isn't an official.
- `src/services/processAnonymity.ts` — NEW. Per-process "Resident N"
  numbering, READ-TIME and deterministic (no participant-index table;
  the persisted alternative wasn't needed — both endpoints of a detail
  page rebuild the identical map from the same rows, so they always
  agree). Numbered by first appearance (author = 1, then comment
  authors by earliest timestamp; ties broken by id). Officials are
  exempt and don't consume a number. Anonymous comments stay
  "Anonymous". THE FINGERPRINT GUARDRAIL: numbers are per-process ONLY
  — the same person is Resident 3 in one process and Resident 1 in
  another. Never make this global/per-account (that's a tracking
  handle). Caveat: hard-deleting a comment can renumber later
  contributors; append-only activity never shifts existing numbers.
- `src/middleware/auth.ts` — `resolveCallerUser()` (full-user variant
  of resolveCallerId); public read routes stay ungated, the token only
  flips the audience.
- List/feed surfaces (cross-process rows) show plain "Resident" — a
  number would be meaningless there. Detail surfaces (proposal/project/
  process state + their comment threads) use the numbering map.

**The "Admin" label (Adam, 2026-08-31 — SUPERSEDES the earlier
type-based institutional byline).** The public rule is CREATOR-based
and identical on every surface: official → real name + office pill;
admin → the literal label "Admin" (role acknowledged, personal name
withheld — `PUBLIC_ADMIN_NAME` in creatorDisplay.ts, one line to change
if admin names should ever go public); everyone else → "Resident" /
"Resident N". This replaced `INSTITUTIONAL_BYLINE_TYPES` +
`publicFallbackName` entirely (both deleted): announcements, meeting
summaries, word clouds, admin comments — anything admin-authored — now
says "Admin" to the public instead of "Resident" or the hub name.
Admins, like officials, never consume a Resident number. An
official-who-is-admin shows office + name (office outranks the label).
Adam's stance of record: he runs ONE account, engages as admin, stays
neutral, and uses the per-comment anonymous toggle (never pierced) for
anything personal. The event-payload scrub swaps a non-official
`author_display_name` to "Admin" likewise.
**civic.brief — RESOLVED (Adam, 2026-08-31): general rule, no special
case.** Today only officials participate (official responses, real
name + title, already exempt). Future resident interaction inherits
"Resident N" automatically through the same paths — that IS the
future-proofing.
**Public-visibility SETTING — punted deliberately (Adam, 2026-08-31).**
Considered a hub_settings toggle (e.g. "all names public"). Hardcoded
instead: a one-click retroactive de-anonymization switch is a footgun —
residents posted under one expectation, and flipping it would publish
names they never agreed to expose. If ever revisited, follow the
`comment_identity_mode` pattern (setting key + getter + admin toggle +
one branch in `redactForAudience`) and make it forward-only /
consent-aware. Note `comment_identity_mode` itself is orthogonal and
untouched: it's the POST-time comment identity policy (real_name /
anonymous_optional / anonymous_only) for everyone; audience redaction
is READ-time for the signed-out public, layered on top.

**AS2 / feed actor anonymization** (`src/events/publicRedaction.ts`,
NEW). The public wire leaked stable per-user handles even without
names: `GET /events` emitted `{ui}/users/<raw-user-id>` actor IRIs and
`GET /api/feed` served raw `actor` ids. For UNAUTHENTICATED callers
only: resident actors become per-process opaque IRIs
`{ui}/process/<pid>/participants/anon-<HMAC-SHA256(secret,
pid:userId), 16 hex>` — stable within a process, unlinkable across
processes; name-shaped payload fields are scrubbed from
`hub:payload`/`data` (non-official `author_display_name` →
`hubName()`; `author_name`/`full_name`/`display_name`/`creator_name`
dropped; `responder_name` kept — brief responders are officials by
construction). Officials, `system:*` and `did:` actors pass through.
The stored log and the default `toActivity()` output are untouched
(goldens unchanged); this is serve-time only, via a `WireOptions`
actor-IRI override. This IS a public-wire change for anonymous
consumers — deliberate, spec §5.3-aligned (process-scoped anonymous
actors).

**NEW ENV VAR: `CIVIC_ANON_SECRET`** — ✅ Adam set it on Vercel PROD
and PREVIEW (2026-08-31; on the ops/env checklist). Safe
degrade if unset: every resident actor collapses to the shared
"anonymous" token — nothing leaks, but per-process distinctness is
lost. Dev gets a value via `.claude/launch.json` (hub entry env).
Generate with `openssl rand -hex 32`.

**Confirmed no-leak surfaces (checked, unchanged):** vote logs/receipts
(no names), vote-results comments (bare strings), wordcloud responses,
Polis conversations (opaque xid), search results, brief responses
(officials only), feed `process_meta` (carries no name fields).

**Tests.** `tests/unit/creatorDisplayOfficial.test.ts` (extended:
member passthrough, official exempt, admin→Resident, numbering,
institutional byline), `tests/unit/processAnonymity.test.ts` (numbering
core incl. cross-process independence), `tests/unit/publicRedaction
.test.ts` (HMAC tokens, scrub, AS2 IRIs, degrade). Integration:
`tests/api/publicAnonymity.test.ts` — NOT run by CI (TESTING.md:
CI has no DB/server); passed locally against the dev server.

**Dev-DB residue from live verification: CLEANED (2026-08-31).** All 7
test users, 3 test proposals + 5 comments + 11 events, and the test
announcement were deleted from dev (dry-run verified, then removed; the
one-off script was deleted after use). Cara's temporary official role
was reverted before that. The temporary second admin email was removed
from `.claude/launch.json`.

---

## SHIPPED to production — 2026-08-29

The whole 08-28/29 arc (10 commits, 447ab21..fbbe04e) is **live on
floyd.civic.social**. Order honored per the 08-22 rule: Adam applied all
three migrations to prod by hand FIRST (verified: users column present,
deliberation_drafts table with sources present, drafts duration defaults
= 3628800000), then pushed; Vercel auto-deployed. Post-deploy
verification: /api/assistant/:type/config live for all four types
(deliberation serving title/description/sources/seed_statements), and
the deployed bundle contains the new copy (affordance, CoC line,
SourceLinks, Waiting-to-start) with the old path-choice copy absent.
Signed-out page checks blocked by beta mode (expected); Adam to
spot-check the signed-in feel.

---

## Sources presentation + dev Polis live — 2026-08-29 (later still)

**Built, NOT pushed.** Adam's review of the live conversation page:
sources rendered as one run-on "Learn more" blob of raw URLs ABOVE the
card. Now: a shared `SourceLinks` component renders a compact numbered
SOURCES list — title-only links, no raw URLs — placed AFTER the framing
inside the card (active panel, completed view, and pre-start block; the
admin review list reuses the same parser). Each source line is
"Short title: URL"; the parser extracts the URL for the href, uses the
title as link text (hostname fallback), and strips trailing
parentheticals so old verbose lines render cleanly. Sources cap at SIX
(submit-time backstop + form guide + the assistant's web-search prompt
now demands short-titled lines, 3–5 offered max).

**Dev now runs live Polis.** Adam minted a fresh Standard User JWT on
the Hetzner box (the documented /app/keys procedure — prod's token is
Vercel-sensitive and unrecoverable, and doubles as the 2036 rotation
drill) with its own oidc_sub `dev-civic-hub`. Verified end-to-end: the
water conversation started → real Polis conversation `9jdhekwr6b`,
deadline stamped start+42d (2026-10-10), seeds live and voteable.
That conversation is TEST CONTENT on the shared prod Polis server —
close it when done.

---

## Adam's second pass: three fixes — 2026-08-29 (later)

**Built, NOT pushed. No migration.** Adam's testing surfaced:

1. **Long URLs forced horizontal scroll** in the assistant column —
   `overflow-wrap: anywhere` on `.msg-content` + suggestion-card text
   (AssistantPanel.css). Computed-style verified.
2. **The admin review view hid the submission's setup** — sources, seed
   statements, and the participation window live on `process.state`, and
   the review page showed only topic + framing, so Adam thought his
   sources were lost (they weren't — on state all along). AdminReviews
   now renders a conversation-details block: "Open for: N days once
   started", sources as links, seeds as a list. Verified on his water
   review (rev_60845f22e8e7453c).
3. **Approved-but-unstarted conversations were stranded invisibly.**
   Dev has no POLIS_AUTH_TOKEN, so auto-start at approval failed (by
   design, best-effort) and the conversation sat at `draft` — which the
   Conversations page buckets nowhere, and the manual-Start fallback had
   NO button anywhere in the UI (api.startDeliberation was defined but
   unused). Now: an admin-only **"Waiting to start"** section on
   /deliberations lists draft conversations, and DeliberationDetail
   shows an admin **Start conversation** button on drafts. Verified:
   section lists the water conversation; Start surfaces the Polis 401
   cleanly and leaves it draft (on prod, with the token, it goes live).
   The "vanished after approval" confusion also had a cache component:
   the UI's 30s GET cache can briefly serve the stale list.

Note for prod thinking: the same stranding could happen there during a
Polis outage — the new section + button close that loop everywhere.

---

## Conversation sources + AI seed statements + prompt honesty — 2026-08-29

**Built, NOT pushed. One migration (dev NOT yet applied, see below).**
Adam's dev pass caught a real bug: the assistant searched for sources on
a conversation, said **"Done — I've added all three links to the Sources
field"** — a field conversations didn't have — and the suggestion card's
Apply silently no-opped (field normalized to null). Three fixes + two
scope decisions from Adam:

**Honesty fixes (all types):**
1. The generic prompt's web-search section is now FIELD-AWARE — it only
   mentions the Sources field when `config.fields` includes it, and for
   types without one instructs the assistant to say so instead of
   pretending. New "You never write into the form" section + never-do
   rules: the assistant must never claim a write ("I've added…") — only
   "it's in a suggestion card below, click Apply."
2. Apply buttons are GATED per card (`canApplySuggestion` threaded
   useDraftFlow → DraftShell → AssistantPanel/inline results): a
   suggestion for a field the form doesn't have renders without Apply
   instead of a silent no-op that flips to "Applied".
3. Pinned in tests: never-write rule present in every prompt; web-search
   copy branches on sources; seed_statements only in declared templates.

**Conversations gain a Sources field** ("learn more" links under the
framing, one per line): `deliberation_drafts.sources` column (migration
below), form field, statePayload → `state.sources`, read model, and a
"Learn more:" links block on DeliberationDetail. Participants can verify
the framing's factual table-stakes; the assistant's search results now
have a real home.

**Seed statements become a first-class assistant field.** The field
vocabulary genuinely extended (`DraftField` += `seed_statements`, carried
through DraftState/DraftProposal/parser/output-template/Apply targeting —
NOT smuggled through "considerations"). The deliberation config declares
`fields: [title, description, sources, seed_statements]`; its
best-practices doc now directs the assistant to suggest deliberately
multi-perspective seed sets (4–8, one per line, one card) — the place
creators most predictably fail. Seeds still land only via Apply, which
marks assistant_helped → public disclosure. Form textarea id renamed
`draft-seeds` → `draft-seed_statements` for generic Apply targeting.

**Migration** `20260829000000_deliberation_sources.sql`:
`ALTER TABLE deliberation_drafts ADD COLUMN IF NOT EXISTS sources TEXT
NOT NULL DEFAULT '';` — dev needs it (sources writes fail loudly until
then; reads default ""); prod at ship time with its siblings.

**Verified:** tsc clean both, **576 unit tests pass** (3 new honesty
tests). Conversation form renders Topic / Framing / Links / Seed
statements / duration / participant goal with correct Apply-target ids.
Live assistant re-test of the search→sources→Apply loop needs the dev
migration first.

---

## Conversations join the flow: assistant, unified durations, open CTAs — 2026-08-28 (later)

**Built, NOT pushed. One migration, applied to dev? → NO (pending, see below).**
Three decisions from Adam after his review of the creation-flow rebuild:

**1. Conversation drafting assistant (topic + framing).** The deliberation
handler now declares `getAssistantConfig` (deliberationBoot →
`src/processes/deliberationAssistantConfig.ts`) with a new *Conversation
Best Practices* doc whose spine is neutrality-of-the-instrument: fair
open-question topics, framings both sides would call even-handed, seed
statement advice (short, single-idea, deliberately multi-perspective).
Assistant scope is title(topic)+description(framing) only; seed
statements / duration / participant goal are plain form fields it cannot
write into. New storage: `civic.deliberation_drafts` module +
`deliberation_drafts` table + `/deliberations/drafts` routes (mounted
before `/deliberations/:processId`), submit → `submitAsCreator` with
`assistant_helped` carried on state and the "Drafted with assistant help"
label added to DeliberationDetail. ConversationDraft page rebuilt on
useDraftFlow + DraftShell; HostDeliberationForm retired (deleted).
assistantRegistry tests now pin FOUR types with configs.

**2. Unified durations.** One picker everywhere: 2 weeks / 1 month /
6 weeks / 2 months / 3 months, **default 6 weeks** (Adam chose uniform
6w; noted my lean toward 1 month for votes — one constant if he changes
his mind). Proposals lose the 6-month option (server cap 2w–3m for NEW
drafts; existing long-window proposals unaffected; the retired label
still renders for old drafts). Projects stay deadline-free. Conversations
swap the optional deadline DATE for the duration picker — `duration_ms`
lives on deliberation state and the **deadline is computed at START**
(`start` action: now + duration), so review-queue/waiting time never eats
the participation window; explicit `deadline` still wins for API callers.
Creator-facing "admin discretion / no deadline" was considered and
rejected (recreates never-concludes); admin close-early exists, and an
admin deadline-extend control is the flagged follow-up.

**3. Creation CTAs visible signed-out — refined same-day to "gate at the
button" (Adam picked option A).** "Raise something" + the four per-page
create buttons lost their `{user && …}` wrap, but clicking one while
signed out now runs `requireAuth` FIRST: auth modal (full onboarding,
wordcloud detour intact for first-timers) → the picker opens only for
signed-in residents. Direct `/…/new` URLs keep the softer flow for
shared links: type freely (buffered), auth modal at the first gated
action, pending action continues with the buffer flushed — verified
end-to-end (draft created WITH the buffered title, real CoC check ran,
inline results card, "Ready to submit"). Backend gates unchanged
(creation was never client-gated). Both CTA states browser-verified:
signed-out click → auth modal, no picker; signed-in click → picker.

**Bug found & fixed in passing:** `initializeState` DROPPED
`seed_statements` (input carried them, state never did, `start` read
`state.seed_statements`) — so review-path conversations silently lost
their seeds. Now carried on state; regression-pinned in
`tests/unit/deliberationDurations.test.ts` (6 tests: seeds carried,
duration stored, deadline anchored at start, explicit deadline wins,
seeds reach the Polis adapter).

**Also learned (pre-existing, NOT changed):** first-time signups
hard-redirect to `hub.onboarding_wordcloud_id` (AuthModal). Local dev UI
env points it at `proc-wordcloud-test`, which doesn't exist in dev →
"Word cloud not found" after every fresh dev signup (this is what Adam
hit). That redirect also discards a first-time signup's buffered draft +
pending action — returning sign-ins are unaffected. Flagged for a
decision: skip the onboarding detour when the user arrived mid-draft?

**Migration** `20260828200000_deliberation_drafts_and_durations.sql`:
`deliberation_drafts` table + `ALTER` the two drafts columns' defaults to
3628800000 (6 weeks). **Dev still needs it** — conversation drafting
errors loudly until applied ("Could not find the table
'public.deliberation_drafts'"); everything else in this batch works
without it. Prod at ship time, before the push, same as its sibling.

**Verified (local dev):** `tsc` clean both, ui build clean, **573 unit
tests pass** (39 files). Browser: vote + proposal pickers show the five
options with 6 weeks selected; signed-out Home shows "Raise something";
picker → form → buffered-title funnel end-to-end (above); conversation
page renders shell + affordance + neutrality guidance +
`GET /assistant/civic.polis_deliberation/config` → available:true. NOT
yet verified (blocked on the dev migration): conversation draft
create/patch/CoC/submit + assistant open, and a review-path conversation
landing with seeds + start-anchored deadline.

---

## One creation flow — assistant as progressive disclosure — 2026-08-28

**Built, NOT pushed. One migration, NOT yet applied (see below).**
Implements Adam's 08-28 decided design: the "Draft with the assistant /
I'll write my own" fork is gone. Every process type gets ONE form-first
creation flow; AI writing help is a collapsed panel the user opens, never
a path choice, never auto-open, and never the default author.

**Backend — `civic.assistant`, registry-driven (was `civic.proposal_assistant`):**
- `src/modules/civic.assistant/` — generic module. The system prompt has
  ZERO per-type branches: everything type-specific (best-practices doc,
  greetings, kickoff, brainstorm/review/type guidance, output-field
  schema, per-field UI guidance, draft-store adapter) comes from an
  `AssistantTypeConfig` the process handler declares via the new registry
  seam `ProcessHandler.getAssistantConfig?()` (processes/types.ts).
- Configs live beside their handlers: `src/processes/proposalAssistantConfig.ts`,
  `voteAssistantConfig.ts`, `projectAssistantConfig.ts` (best-practices
  docs moved out of the old module's content.ts; content.ts now holds
  only the shared Code of Conduct). A handler with no config gets no
  assistant anywhere — deliberation/wordcloud/etc. declare nothing.
- **One shared route** `/assistant/:processType/...` (assistantRoutes +
  assistantController): `GET .../config` (affordance availability,
  greetings, field guidance — public), `POST .../drafts/:id/message`,
  `POST .../drafts/:id/review`. The three per-type controllers lost their
  duplicated assistant/review handlers (~300 lines) and now own only
  draft storage + submission. Old `/…/drafts/:id/assistant|review`
  endpoints removed (UI updated in the same commit).
- **Stricter `assistant_helped`:** talking to the assistant no longer
  marks it. It is set ONLY when assistant-produced text lands in the
  form — a generated draft applied server-side, or an Apply-suggestion
  PATCH (`assistant_applied: true`, all three drafts modules). The CoC
  review never marks it (unchanged). Public disclosure label unchanged.
- **Conversations get the automated CoC check too:** deliberation
  creation now runs `checkTextAgainstCoC` (CoC-only prompt, hard
  findings block with a readable error, API failure fails open to human
  review) — so the universal disclosure line is true on all four types.

**Frontend — one shell, four types:**
- `components/DraftShell.tsx` (+css) — THE creation layout: form-first;
  collapsed affordance card on desktop ("Want help drafting? …") /
  existing FAB on mobile; panel opens only on click; universal fine
  print "All submissions get an automated check against the Code of
  Conduct before posting."; inline CoC-results block (SuggestionCards
  with Apply) so manual drafters see and resolve concerns with the
  panel closed; hides the affordance when the type has no config OR the
  user set "Hide AI drafting help".
- `hooks/useDraftFlow.ts` — the shared page brain: lazy draft creation
  (no row until a real interaction), an edit buffer so a signed-out
  visitor's typing survives the auth gate, assistant open/seed flow
  (empty draft → brainstorm greeting + kickoff; existing content or
  history → free-form, no API call until the user speaks), CoC review,
  Apply semantics.
- ProposeDraft / ProposeDraftVote / ProjectDraft rewritten onto
  DraftShell + useDraftFlow (~585 → ~250 lines each; path-choice screens
  and dead CSS deleted). ConversationDraft mounts the same shell
  (assistant=null → no affordance; conversation creation stays
  admin-gated by /deliberations — that page's concern).
- **Per-field inline guidance** (#7): hint + one short example under
  title/description/sources on all three forms, served from the same
  per-type config the assistant uses (`field_guidance` on GET
  /assistant/:type/config), rendered by `FieldGuide` (DraftingForm.tsx).
- **Settings → "AI drafting help" panel:** "Hide AI drafting help"
  checkbox, persisted server-side via PATCH /auth/me
  (`hide_ai_drafting_help`), so it follows the user across devices.

**Migration — NOT applied anywhere yet:**
`supabase/migrations/20260828100000_hide_ai_drafting_help.sql` adds
`users.hide_ai_drafting_help boolean not null default false`. Per the
established procedure (CLI link points at prod — no `db push`), apply by
hand in the Supabase SQL editor, **dev only for now** per the design
note. Reads degrade gracefully un-migrated (setting reads false); the
write fails loudly — verified: the Settings toggle shows a clear error
against un-migrated dev.

**Verified (local dev against dev Supabase, desktop 800px + mobile 375px):**
- No path-choice screen on any type; all four render the shell with the
  CoC line; proposal/vote/project show the collapsed affordance +
  field guidance; conversation shows neither affordance nor FAB.
- Lazy creation: typing a title created the draft row and flipped the
  status bar to "Run the Code of Conduct check…".
- CoC check through the shared route (`POST
  /assistant/civic.proposal/drafts/:id/review`) — no ANTHROPIC_API_KEY
  in local .env, so the **fail-open path** ran end-to-end:
  `review_unavailable: true`, empty review recorded, notice rendered,
  status "Ready to submit", `assistant_helped` stayed false.
- Assistant open: desktop card → two-pane panel with returning-draft
  greeting (no kickoff call when the form has content); mobile FAB →
  full-screen overlay, brainstorm greeting seeded, kickoff failed with
  the friendly "isn't configured yet" message.
- `assistant_applied: true` PATCH flips `assistant_helped` false→true
  and (with skip_modified_flag) preserves a passed review.
- `tsc` clean (backend + ui), ui `vite build` clean, **567 unit tests
  pass** (10 new in `tests/unit/assistantRegistry.test.ts`: which types
  declare configs, config completeness, prompt built purely from config,
  CoC-only prompt shape).

**Incomplete / follow-ups:**
1. ✅ **DONE 2026-08-28 (later that day):** Adam applied the migration to
   dev by hand in the SQL editor (verify query returned the column,
   default false). Opt-out then re-verified end-to-end: toggle saves;
   affordance card gone on desktop /propose/new; FAB gone on mobile
   /votes/new; flag read back from /auth/me on a fresh page load
   (server-side persistence, not client state). Test account restored
   to default (hide=false). **Prod is still un-migrated** — when
   shipping this, apply the same SQL to prod FIRST, verify, then push
   (the 08-22 ordering rule: the migration must not trail its writer).
2. The live assistant conversation (kickoff → questions → generated
   draft → suggestions) couldn't be exercised locally (no
   ANTHROPIC_API_KEY in local .env) — the transport, fail-open, and
   marking semantics are verified; the conversational quality path
   should get a pass on a keyed environment.
3. Dev DB now has a test account (test-resident@example.com) and two
   throwaway drafting-state proposal drafts (one marked
   assistant_helped by the API-level Apply test). Nothing was submitted
   for review. Harmless; delete if tidiness matters.
4. `GET /assistant/:type/config` is fetched twice on page mount (React
   strict-mode double effect) — cosmetic, cacheable later.

---

## Feed borders go dark + performance pass — 2026-08-28 (night)

**Built and PUSHED (through `54079c0`, both phases). No migration.**
Adam accepted this as the resting state — the remaining candidates
(keep-warm ping for cold starts, slimmer columns) stay deferred until
prod feels slow again. Two asks from Adam after the deploy:
the site read "pastely", and the feed/Conversations felt slow to load.

**The pastel offender was the feed's top borders.** List-card edges were
already the dark `--type-*-fg` halves; the feed cards' 4px top border was
still painted with the pastel pill BACKGROUNDS, keyed by the retired
kind classes with pre-palette hexes (old lavender, old teal — half the
rules matched no emitted class). Now `feed-post--type-<color>` +
`--type-*-fg`, same dark accents as everywhere else. Computed-style
verified (proposal #5f4b8b, official-response gold).

**Performance findings (measured):** prod API ≈ 220–260ms/call warm; the
page shell is fast (350ms) — the cost was request COUNT and shape:
1. Feed = N+1 waterfall (1 `/feed` + ~15 per-process `/state`) behind a
   blanket "wait for metadata" render gate → cards 1–2s late.
2. Eight of those calls were guaranteed 404s (resident proposals aren't
   processes; `/process/prop_*/state` failed every load).
3. Conversations fetched EVERY process row (full state JSONB, ~1.4MB
   table) to keep 5.
4. `/auth/me` made 3 stacked officials-tier lookups (~500ms dev).
5. No client caching between tab switches.
6. Cold starts (single Vercel function) add 1–3s on first hit — untouched.

**Fixes shipped:**
- **Feed render gate narrowed** to `TITLE_NEEDS_META` kinds (vote-open,
  vote-results, wordcloud, conversation-results, proposal-closed,
  project-updated) — every other kind paints on the first frame from the
  event payload and hydrates engagement/images as fetches land.
- **Proposal kinds no longer fetch** (`Promise.resolve({})`) — the 404s
  are gone. Feed load measured: 18 → 9 API calls, `/state` 15 → 6.
- **`getAllProcesses(types?)`** — SQL `.in("type", …)` filter;
  `listDeliberations` passes `["civic.polis_deliberation"]`, and
  `GET /process?type=` (repeatable) lets the Votes tab fetch only
  `civic.vote`. `listProcessSummaries(types?)` threads it through.
- **`/auth/me` officials tiers now query in parallel**
  (`resolveOfficialParts` in middleware/auth.ts) — one roundtrip instead
  of three; tier PRECEDENCE is applied after the fact so semantics are
  unchanged (managed wins; legacy dies at the migration latch), and the
  legacy row is reused for the display name (was a 4th query). Two
  authOfficial tests updated: they asserted later tiers were never
  CALLED; the contract is that their answers LOSE.
- **30s in-memory GET cache** in the UI's `request()` for allowlisted
  list/identity paths only (`/feed`, `/process`, `/proposals`,
  `/projects`, `/deliberations`, `/brief`, `/auth/me`, reviews count).
  Keyed by path+token; ANY non-GET clears the whole cache so your own
  mutation is never hidden behind a stale list. Per-actor detail reads
  (`/process/:id/state`) are deliberately not cacheable.

**Phase 2 — server-batched feed metadata (same night).** Adam noticed
the phase-1 trade-off: cards painted sparse (title/pill/date) and the
second line popped in as the per-process fetches landed. Fix: GET /feed
now ships a `process_meta` map — `src/services/feedMeta.ts` classifies
the feed's own events, runs the SAME handler read models the per-id
endpoints serve (via `getProcessState`, so the visibility gate and every
type's field logic are reused, not duplicated; wordcloud submission
counts are the one extra query), and emits the CLIENT's camelCase
ProcessMeta shape on purpose (it exists solely to seed Feed.tsx's
cache). The client seeds `processMeta` + `removedProcessIds` from it;
the lazy per-id path survives only as a fallback for anything the server
couldn't enrich. Measured: **3 API calls per feed load** (was 18 before
the pass, 9 after phase 1), zero `/state` calls, every card complete on
the first frame. `/feed` itself does the read models in parallel
server-side (~880ms dev where the DB is remote; expect ~300–400ms on
prod where the function sits next to Supabase). Enrichment is skipped
for `?process_id=` lookups.

**Not done (candidates if still slow):** slimming the `select("*")`
column set (summaries need the state JSONB today — handlers' getSummary
reads it), and a keep-warm ping for the Vercel function (cold starts
remain 1–3s).

Verification: tsc -b clean both sides, 557 unit tests pass,
browser-measured before/after on dev, Conversations renders 3 cards via
the SQL-filtered path.

---

## Cosmetic consolidation, finished and PUSHED — 2026-08-28 (evening)

**Pushed to `origin/main` by Adam; Vercel auto-deploy from `8213d34`.**
The whole 08-28 design batch (color architecture → palette → vocabulary →
cards → polish) is live. No migrations in the batch. Three pieces landed
after the entries below were written:

**Proposal purple muted; lifecycle pills are neutral-with-a-dot
(`21b8a30`).** The vivid Material violet (#5e35b1) became a dusty plum
(**#5f4b8b** on #eae7f0) — token, card-accent fallback, and digest hex
together. And the OPEN/CLOSED status badges dropped their solid
green/red washes for a **neutral pill + small colored dot** (green =
live, amber = gathering, gray = done): the card edge now carries the
identity color, and a second saturated block clashed differently against
every type hue. **Closed is deliberately no longer red** — a finished
process is not an error. Adam's read: the green dot reads as a green
light. This restyle is what the statusDisplay variants (`status-live` /
`status-phase` / `status-done`, entry below) render into.

**Outcomes rows now render the LITERAL shared card (`1a4f4d8`).**
Supersedes the "metrics mirror App.css" approach in the entry below —
mirroring by hand is how the page drifted twice (unbolded span titles,
different fonts). `OutcomeRow` now emits the same
`.process-card` / `.process-card-header` (real `<h3>`) /
`.process-card-meta` classes the four list pages use, with the source
type's `--type-*-fg` passed inline as `--card-accent`; all card-shaped
CSS was deleted from Outcomes.css so there is nothing left to drift.
Computed-style verified identical to a list card (16.8px/600 Libre
Franklin title, 14px radius, 4px accent edge).

**Sticky filter seam closed (`8213d34`).** The filter bars pinned at
`--nav-h + --tabs-h` = 106px but the tab strip actually ends at 105
(`--tabs-h` said 45, renders 44) — a 1px see-through sliver while
scrolling. Variable corrected AND both bars (`.votes-filter`,
`.feed-filter`) pin 2px higher to tuck under the opaque tab strip
(z-90 over z-89), so no zoom rounding can reopen it. Also hoisted the
Proposals/Projects StatusFilter out of their first `<section>` to page
level — inside the section it stopped sticking once the section
scrolled past (sticky cannot outlive its parent); now matches
Votes/Conversations.

Also in the pushed batch but recorded earlier the same day: official
responses (+ the blue Awaiting-response chip on /brief/:id, per Adam),
per-brief delivery recipients, the process-type color architecture and
palette, the status vocabulary, and the list-page filters.

**Post-deploy check for the next session:** the first daily digest after
this deploy (13:00 UTC cron) renders the new pill palette — eyeball one.

---

## One status vocabulary + filters on every list page — 2026-08-28 (later still)

**Built; PUSHED 2026-08-28 with the design batch (evening entry above). No migration.** Two more consistency passes from
Adam's review.

**One lifecycle vocabulary
(`ui/src/components/statusDisplay.ts`).** Every card type had its own
status dialect — votes "active/closed/finalized", proposals "open" /
"promoted", projects "active/archived", conversations "Completed". Now
one shared mapper: a running process is **"Active"**, a finished one is
**"Completed"**, everywhere; states carrying MORE meaning keep their
label ("Gathering support", "Ready to activate", "Promoted to a vote",
"Endorsed", "Archived", "Draft"). Three pill variants of the
neutral-dot style: `status-live` (green dot), `status-phase` (amber),
`status-done` (gray). Callers pre-translate context ("closed" on a
civic.proposal → "promoted"); the module knows keys, not process types.
Swept: ProcessCard, ProposalCard, Propose, Projects, ProjectDetail,
Process, ProposalDetail, Deliberations. Legacy per-status CSS classes
remain as neutral aliases; admin-panel chips untouched.
**Public label rule (Adam): the deliberation process renders as
"Conversations" to the public — "deliberation" never appears in
user-facing text**, only in internal names.

**Status filter pills on every list page
(`ui/src/components/StatusFilter.tsx`).** Votes' `?status=` filter bar
is now a shared component; Conversations (All/Active/Completed),
Proposals (All/Active/Completed), and Projects (All/Active/Archived)
each mount it with only their relevant statuses ("Proposed" stays
Votes-only). Votes swapped onto the shared component; its "Finalized"
label is now "Completed" (URL key `finalized` kept so bookmarks
survive).

**Outcomes rows adopt the shared card language** — 14px radius, resting
shadow, hover lift, 4px type-colored accent edge — matching the feed
and list cards (metrics mirror App.css's `.process-card` block).
*Superseded the same evening:* mirrored metrics still drifted on
typography, so the rows now render the literal shared classes — see the
evening entry above.

Verification: `tsc -b` clean, 557 unit tests pass, browser-checked:
filter bars on all four list pages, Votes pills read
All/Active/Proposed/Completed, badges emit `status-live`/`status-phase`
with shared labels, Outcomes cards restyled.

---

## Palette refresh + page cards join the type palette — 2026-08-28 (later)

**Built; PUSHED 2026-08-28 with the design batch (evening entry above). No migration.** Follow-up to the entry below, after
Adam reviewed swatch mockups. Two problems: the type palette was three
near-identical blues (vote navy / conversation indigo / project azure), and
the process LIST pages ran a second, older card-accent palette (proposal
cards terracotta, project cards green) that contradicted the pills.

**The three color layers, made explicit (the sorting-through):**
1. **Action — terracotta** (`--ds-color-accent-*`): every CTA sitewide +
   announcements. This is WHY proposals couldn't take terracotta as
   identity, much as Adam liked it — every button would read
   proposal-branded.
2. **Status — semantic**: green OPEN badges / meetings, amber pending,
   gray closed. Why projects couldn't take identity-green: a green edge
   next to a green OPEN badge meaning different things.
3. **Identity — one hue per process type** (`--type-*`), now: vote navy,
   proposal purple (*muted to dusty plum #5f4b8b later the same evening*),
   **conversation TEAL** (#ddefef/#0f5e66 — left indigo;
   kin to the design system's civic-teal), project azure, **wordcloud
   MOSS** (#edf0dd/#5c6b2a — ceded its teal to conversations; a marigold
   alternative was mocked and rejected as too close to official-response
   gold). Announcement rust / author violet / meeting green /
   official-response gold / generic unchanged. Only two blues remain,
   far apart (dark navy vs bright azure).

**Page cards now wear the type palette:** the four `--card-accent` values
in App.css point at `--type-*-fg` — proposal cards purple, project cards
azure, deliberation cards teal, vote cards navy. A process is ONE color
everywhere: its list card, feed pill, Outcomes row, filter pill, digest
row. Digest PILL_COLORS hexes updated to mirror.

Verification: tsc -b clean, 557 unit tests pass, computed-style checked
proposal (#5e35b1) and deliberation (#0f5e66) card edges on dev; CTA
stays terracotta, OPEN badge stays green.

---

## One color per process type, everywhere — 2026-08-28

**Built; PUSHED 2026-08-28 with the design batch (evening entry above). No migration.** Adam's rule after seeing a proposal
render three different colors: every surface colors a card, row, or pill by
the underlying PROCESS TYPE, never by the event's lifecycle moment. "New
proposal", "Proposal results", and the proposal's Outcomes row are all one
purple; a brief wears its SOURCE process's color, so Outcomes and the feed
finally agree. The feed on All is mixed; filtered, monochrome.

**The decision lives in the shared classifier** (`feedActivity.ts`):
`Activity.color: ActivityColor` — vote / proposal / conversation / project /
wordcloud / announcement / announcement-author / meeting /
official-response / generic. Kinds collapse onto these keys there, so the
feed, Outcomes, and the digest render one decision (the same collapse the
Phase-3 audit did for feed-worthiness). Two non-process keys on purpose:
announcement-author keeps the elected-official vs admin distinction, and
official-response keeps its gold (an act, not a process).

**Renderers:** theme.css gains `--type-<color>-bg/-fg` tokens (the old
"start" colors are canonical; the divergent results-variants — vote-results
teal, conversation-results navy, brief blue — retire from use). Feed.css
pill classes are now `feed-pill--type-<color>`; Outcomes.css points at the
same tokens; digest `PILL_COLORS` is rekeyed by ActivityColor (hexes mirror
the tokens; falls back to generic rather than crashing a send on an item
with no color). The legacy `--pill-*` tokens stay DEFINED — App.css uses
`--pill-vote-*` as a general control accent (~25 sites) and FeedFilter's
three surface pills still read them — but no process-type surface points at
them anymore.

**Outcomes filter = feed filter (same classes):** the gray toggle-chips and
the Newest/Oldest dropdown are gone. The bar is now the feed's pill style
(`.feed-filter-pill`, shared via FeedFilter.css import): **All** + one
type-colored pill per type present, single-select, active = inverted
(type-fg background, white text). Always newest first; the backend `sort`
param survives unused. Year select and Clear stay.

| Piece | File |
|---|---|
| `ActivityColor` + per-case stamping + `briefColorOf` | `src/shared/feedActivity.ts` |
| `--type-*` tokens | `ui/src/styles/theme.css` |
| Pill classes by color | `ui/src/components/Feed.css`; filter pills in `FeedFilter.css` |
| `pillColor` plumbing | `ui/src/components/FeedPost.tsx` |
| Outcomes filter rework + token repoint | `ui/src/pages/Outcomes.tsx` / `Outcomes.css` |
| Digest rekey + fixture fix | `src/modules/civic.digest/{models,service}.ts`, `scripts/renderDigestSample.ts` |
| Tests | color-rule cases in `tests/unit/feedActivity.test.ts` |

Verification: `tsc -b` clean (backend + ui), **557 unit tests pass**.
Browser-checked on dev: feed pills per type (proposal purple, conversation
indigo, official response gold), Outcomes bar in feed style with working
single-select filter (active pill = white-on-type, computed-style
verified), digest sample renders.

Deferred: restructuring the FEED's own filter bar (still the three surface
groups: Announcements / BOS meeting summaries / Activity) into per-process
pills — an information-architecture change, decided separately.

---

## Per-brief delivery recipients + public "Sent to" receipt — 2026-08-28

**Built; PUSHED 2026-08-28 (first batch of the day). No migration** (brief state is JSONB). Replaces the
automated hub-wide delivery with an explicit choice made during review:
selecting who receives the brief is now part of the admin's review, and the
published page says to whom it was sent and when.

**The two-halves rule (the load-bearing decision):** each recipient is
`{ email, label }`. The EMAIL is where the brief is sent and stays
server-side forever; the LABEL ("Jane Doe, Board of Supervisors") is the
only half any public read model carries. `normalizeRecipients` REFUSES a
labelless recipient rather than defaulting the label from the email —
refusal is what makes leaking an address onto a permanent public record
impossible, not convention. Unit tests assert the public model never
contains an email string.

**Three states of `state.recipients`, three meanings at approval:**
`undefined` (review predates the picker) → fall back to the hub-wide
"Brief recipients" setting, recording NO labels so the public receipt keeps
its old "Delivered to the Board of Supervisors on [date]" wording;
`[]` (admin explicitly cleared) → publish with no email at all — the
fallback does NOT resurrect delivery; non-empty → deliver to exactly
those, recording `delivered_to` (emails, server-side), `delivered_at`
(actual send time), and `delivered_to_labels` (public). Selection is
editable only while pending, like every other review edit.

**Admin review UI (`AdminBriefs.tsx`):** a "Delivery recipients" section —
rows of email + display label, quick-add buttons for every officials-roster
member (label auto-built as "Name, Title"), free-form add-by-email, and the
hub-wide setting as the prefill for untouched briefs (roster-matched emails
get labels; unmatched ones get an empty label the save refuses until
filled). The approve confirmation states exactly how many recipients will
be emailed, or that none will.

**Public page (`Brief.tsx`):** "Sent to Jane Doe, Board of Supervisors and
Sam Lee, Town Council on August 28, 2026 at 2:14 PM." (labels joined as a
sentence, `delivered_at` timestamp). Legacy briefs keep the governing-body
line.

| Piece | File |
|---|---|
| Types (`BriefRecipient`, state fields) | `src/modules/civic.brief/models.ts` |
| `normalizeRecipients` / `setRecipients` / approve resolution | `src/modules/civic.brief/service.ts` |
| PATCH accepts `recipients`; approve uses per-brief selection | `src/controllers/adminBriefController.ts` |
| Picker UI + delivered receipt | `ui/src/pages/AdminBriefs.tsx` (+ `AdminVoteResults.css`) |
| Public receipt | `ui/src/pages/Brief.tsx` |
| Tests | `tests/unit/briefRecipients.test.ts` (14); `briefLifecycle.test.ts` updated to `fallbackRecipients` |

Verification: `tsc -b` clean (backend + ui), **554 unit tests pass** (37
files). Dev `GET /brief/:id` confirmed to carry `sent_to`/`delivered_at`
and to omit `delivered_to` entirely. Not yet exercised: a full admin
review → approve round-trip with the picker (needs an admin session).

Deferred: the hub-wide "Brief recipients" setting is now only a prefill +
legacy fallback — once every in-flight pending brief has been reviewed
with the picker, it could be retired or relabeled "Default recipients".

---

## Official responses to Civic Briefs — 2026-08-27

**Built; migration applied to dev AND prod, then PUSHED 2026-08-28** (see Deploy order
below). Depends on the managed official role (2026-08-27, below): an official
identity must exist to respond as one.

A published brief now carries the government's side of the record. Officials
post public responses to it; the public `/brief/:id` page shows **"Awaiting
response"** (a neutral invitation — no deadline, no callout) until the first
response, then **"Responded [date]"** with every response rendered below the
brief.

**Decisions (agreed with Adam this session):**

- **Any official may respond to any published brief**, and may respond again
  later — responses are **append-only public correspondence** (no edit, no
  delete; a follow-up is a new row). No unique constraint, no rate limit; the
  roster is small and admin-managed, and demotion revokes instantly.
- **The gate is the official ROLE, not the delivery list.** Plain admins
  cannot respond — a response is a public act of an office, not a platform
  capability. The brief's `delivered_to` recipients stay a framing concept
  only ("Awaiting a response from the Board of Supervisors" via
  `hub.governing_body_name`); gating on the list would lock out a supervisor
  whose delivery went to a clerk's inbox, and those emails must never render.
- **"Responded" anchors to the FIRST response's date** and never moves.
- **Office is snapshotted onto each response** (`official_type` /
  `official_title` at response time) so a later demotion or retitle never
  rewrites the record — same principle as announcements' `author_role`.

**Feed: one card per brief per 24h, log never throttled.** Every response
emits `civic.process.action_taken` (`data.action = "official_response"` — new
serializer mapping, `hub:OfficialResponse` / generic `hub:ProcessAction`, both
registered in `EXTENSION_TERMS`). The WRITE path stamps `feed_anchor: true`
only when no other anchor for that brief exists in the past rolling 24h
(`isFeedAnchor`, keyed on the last ANCHOR so ongoing conversation cannot
suppress cards forever); the shared classifier renders only anchored events as
a **"brief-response"** card, pill **"Official response"** (warm gold), linking
to `/brief/:id` where the collapsed responses are all visible. Because the
classifier is shared, the digest gets the same card for free (renders under
"Completed — results").

| Piece | File |
|---|---|
| Migration | `supabase/migrations/20260828000000_brief_responses.sql` |
| Pure rules (gate, status, anchor window, projections) | `src/modules/civic.brief/responses.ts` |
| Event emitter | `emitBriefResponseAdded`, `src/modules/civic.brief/events.ts` |
| Serializer mapping | `civic.process.action_taken`, `src/events/activitySerializer.ts` |
| Storage | `src/services/briefResponses.ts` |
| Middleware | `requireOfficial`, `src/middleware/auth.ts` |
| HTTP | `POST /brief/:id/response` + extended `GET /brief/:id`, `briefController` / `briefRoutes` |
| Classifier | `brief-response` kind, `src/shared/feedActivity.ts` (+ digest filter/service, FeedPost, Feed.css, theme.css) |
| Page | status chip + responses section + official-only form, `ui/src/pages/Brief.tsx` + `Brief.css` |
| Tests | `tests/unit/briefResponses.test.ts` (19) + 3 classifier cases in `feedActivity.test.ts` |

### Deploy order

1. Apply `20260828000000_brief_responses.sql` — **dev first, then prod, by
   hand in the Supabase SQL editor** (the officials-migration procedure; the
   CLI link points at prod and `db push` would replay unrecorded history — do
   not use it). Verify: `SELECT to_regclass('public.brief_responses') IS NOT
   NULL;` → `t`.
   > ✅ **DONE 2026-08-28, in order:** Adam applied it to dev (verify query
   > returned `t`) and then prod (independently confirmed from the session:
   > `supabase inspect db table-stats --linked` showed
   > `public.brief_responses` present with its indexes, 0 rows). The code
   > was pushed only after the prod table existed. The 08-22 ordering hold
   > was honoured.
2. Then push. Per the 08-22 incident, the migration must not trail its writer.

Reads degrade against an un-migrated DB (page shows "Awaiting response",
logs a warning — verified against dev); the WRITE fails loudly on purpose.

### Verification

- `tsc -b` clean (backend + ui). **538 unit tests pass** (36 files) — gate
  (official/admin/resident × published/pending), status transition
  awaiting → responded (earliest-date anchoring), 24h anchor window
  (boundary, fail-open on corrupt timestamp), public projection leaks no
  account ids, classifier default-closed for non-anchored/other actions.
- Against the un-migrated dev DB: `GET /brief/:id` returns
  `response_status: "awaiting"`, `responses: []`; anonymous POST → 401;
  page renders the awaiting chip (screenshot-verified via the dev servers).
- **Exercised end-to-end on dev (2026-08-28):** `adam@mosaic.social` was
  designated an official (`board_of_supervisors` — written directly onto
  the dev users row by script, since the dev roster was empty) and posted
  a response to brief `proc_09713c46665c4297`. Verified from the session:
  the row persisted with the office snapshot and `feed_anchor: true`,
  exactly one `civic.process.action_taken` / `official_response` event on
  the log, the page flipped to "Responded [date]", and ONE "Official
  response" card appeared at the top of the feed.
  **Still not exercised live: the 24h collapse** — no second response was
  posted, so `feed_anchor: false` on a follow-up has only unit coverage.
  Also added same-day (Adam): the Awaiting-response chip wears the
  brief's blue palette instead of muted gray (`b2f8a10`).

**Card copy (2026-08-28, after Adam's review):** the feed/digest card
carries **no excerpt of the response** — a truncated quote can misrepresent
an official statement; the card links to the brief where the response reads
in full. Instead it shows a shared, italic context line — *"Responding to
the community's Civic Brief on this \<proposal/vote/conversation/project\>"*
(`briefResponseContext` in `feedActivity.ts`, consumed by both FeedPost and
the digest so the phrasing cannot drift). The event payload still carries
the excerpt for log/wire consumers; only the rendering dropped it. The
24h anchor window stays rolling and deliberately NOT aligned to the digest
cron (13:00 UTC) — per-user digest cursors mean there is no single send
moment, a daily digest already can't contain two anchors for one brief, and
calendar bucketing would reintroduce the boundary double-post.

### Open questions / deferred

- Response rate-limiting (per-official caps) — deliberately skipped; add
  only if the feed shows abuse the 24h anchor doesn't already absorb.
- **Per-brief responder invitations (Adam, 2026-08-28):** during admin
  brief review, a section to pick which officials/emails are notified of
  the brief and invited to respond — a per-brief override of the global
  "Brief recipients" setting, naturally recorded in `delivered_to`.
- **Naming (Adam, 2026-08-28):** "Civic Brief" itself is in question
  (candidates: "Civic Results", "Community Results"). If renamed, the
  response context line is one string (`briefResponseContext`), and the
  page/pill/digest copy are the other touchpoints.
- A "responded" filter on the Outcomes index rows — the index entry doesn't
  carry response status yet.
- Notifying the brief's followers/author when a response lands (no follower
  mechanism exists on briefs today).

---

## Announcement publication receipts — 2026-08-27

**Built; on `origin/main` as of 2026-08-28.** No migration. Follows the officials entry below.

Every hand-authored announcement now emails a receipt to **the author and
every address in `CIVIC_ADMIN_EMAILS`**.

**Why this and not 2FA.** Sign-in is a code sent to an inbox, so whoever holds
that inbox — or a live session on an unlocked laptop — can publish carrying a
supervisor's office. The pill is what makes that account worth stealing. Three
candidate mitigations were weighed:

| | Inbox compromised | Device/session stolen |
|---|---|---|
| Shorter session / step-up re-auth | no help | stops it |
| TOTP second factor | stops it | stops it |
| **Receipt email** | **catches it** | **catches it** |

The receipt is the only one that helps against both, and by far the cheapest —
removal already exists in moderation, so the response path was already built
and the alarm was the missing piece. Prevention was deliberately deferred.

**The author is emailed, not just admins**, because they are the one person who
knows instantly that they did not write it. Admins are emailed because they can
take it down.

| Piece | File |
|---|---|
| Formatter + recipients (pure) | `src/modules/civic.announcement/receipt.ts` |
| Dispatch | end of `handleCreateAnnouncement`, `src/controllers/announcementController.ts` |
| Tests | `tests/unit/announcementReceipt.test.ts` (16) |

**Fire-and-forget, deliberately not awaited.** The announcement is persisted and
published before the receipt is attempted; a mail failure must not turn a
successful publish into a 400. `sendAnnouncementReceipt` swallows per-recipient
errors, and the call site has a second guard against a synchronous throw.

**Only the hand-authored path.** The floyd-news sync builds announcements
through `createProcess` directly and has no human author to warn.

**An admin posting under their own office gets ONE email**, not two — the
recipient list dedupes case-insensitively. That is exactly the account this
protects, so it is the case most worth not annoying.

### Not built (considered, deferred)

- **Step-up re-auth on publish** (GitHub's "sudo mode"): a freshness
  requirement on the action while the 30-day session still covers reading and
  commenting. The check is trivial; the cost is the UI — prompting mid-flow and
  preserving the draft across the round trip. Worth doing alongside TOTP, since
  they share a re-auth flow.
- **Shortening `SESSION_TTL_MS` for officials** (currently 30 days for
  everyone, `src/modules/civic.auth/index.ts`). Now trivially expressible since
  official status lives on the user row.
- **Splitting posting from official status.** A compromised official account
  currently gets impersonation *and* posting rights together, because the two
  are fused. Unfusing them would shrink the blast radius — the strongest
  argument yet for eventually doing it.

### Badge coverage — where the title does and does not render

Every public byline goes through `<Creator>`: Propose (×2), Projects (×2),
ProposalDetail, ProjectDetail (+ its comments), Process, Announcement, and
`CommunityInputPanel` (process comments).

Two places show a name WITHOUT the badge, both intentional-ish:
- **Feed cards** (`FeedPost.tsx`) render `author_display_name` as plain text —
  but the office is already on the card as the announcement PILL plus a
  distinct border, via `author_role`. Different mechanism, same information.
  Non-announcement cards show no author name at all (pre-existing).
- **`AdminReviews.tsx`** renders `creator_name` as prose in three places.
  Admin-only triage surface; a pill adds little there. Left alone.

---

## Officials: an admin-managed role with a structured title — 2026-08-27

**Built; on `origin/main` as of 2026-08-28. Migration applied to BOTH databases 2026-08-27** — prod
(`nfhyypwoporfggqcerli`) and dev (`urfmvqhzmamigssqwsya`), by hand in the
Supabase SQL editor, before the code was committed. The deploy-order constraint
below is therefore already satisfied; it is recorded because it governs any
rollback or fresh environment, not because it is still outstanding.

Generalizes the env-managed board author into a per-user official role. Before:
officials were `CIVIC_BOARD_EMAILS` (env) or an email-keyed JSON blob in
`hub_settings.announcement_authors`, both reachable only at announcement-post
time, so a Board member's title appeared on announcements and nowhere else.
Now an admin designates an ACCOUNT, and the title renders wherever that person
posts.

### The model

| Column | Purpose |
|---|---|
| `users.official_type` | Coarse kind — `board_of_supervisors` \| `town_council` \| `planning_commission` \| `school_board` \| `other`. Drives pill colour and future filtering. |
| `users.official_title` | The string that actually renders: "Board of Supervisors", "Supervisor, District 3". |

Type is stored; **title is what renders**. Two people can share a type and show
different titles. Both-or-neither is enforced by a CHECK.

**Columns, not a join table** — one office per account, no history requirement,
and `creatorDisplay.resolveCreators()` keeps its single batched `select("*")`
over `users`. No join, no N+1.

**Adding an office type** is three edits, none in a component: the union +
`OFFICIAL_TYPES`, `OFFICIAL_TYPE_LABELS`, and the CHECK constraint. A per-office
pill colour is then one CSS rule on
`.creator-official-badge--<kebab-type>` — zero TypeScript.

### Admin and official are orthogonal now

`resolveAuthorship()` used to short-circuit on admin and return
`{ role: "admin", label: "Admin" }`, so a hub administrator who also sat on the
Board could never show their office. That short-circuit is gone. The two halves
are independent:

- `isAdmin` — platform capability, from `CIVIC_ADMIN_EMAILS`. Gates `/admin/*`.
- `official` — public identity, designated by an admin on the account.

Someone who is both renders **both** badges, office first (`authorBadges()`).
They are never merged.

**One place still holds a single value**: an announcement's `author_role`, which
drives the feed card pill and the page eyebrow. There, the **office wins** — a
supervisor's post reads as coming from the Board, not from the software's
administrator. The Admin badge next to their name is unaffected.

### Posting is fused to official status — for now

Designating someone an official also lets them post announcements
(`canPost = isAdmin || official !== null`). Identity and that capability are
deliberately the same switch today; splitting them later means adding a second
column, not reworking the model. An official still cannot reach `/admin/*`.

### Files

| Piece | File |
|---|---|
| Migration | `supabase/migrations/20260827100000_official_role.sql` |
| Shared vocabulary + badge decision | `src/shared/officialTypes.ts` (dependency-free, both runtimes — the `feedActivity.ts` pattern) |
| Read/write of the role | `src/services/officials.ts` |
| Authorship split | `resolveOfficial()` / `resolveAuthorship()` in `src/middleware/auth.ts` |
| Byline resolution | `rowToDisplay()` in `src/services/creatorDisplay.ts` (+ the two inline copies in `processService.ts`) |
| Comments | `src/controllers/inputController.ts` |
| Admin API | `officials` on `GET`/`PATCH /admin/settings` |
| Admin UI | Officials section in `ui/src/pages/AdminSettings.tsx` |
| Byline component | `ui/src/components/Creator.tsx` + `.css` |
| Seed | `scripts/seedOfficials.ts` |

Read models gained `creator_official_type` / `creator_official_title` (flat,
matching the existing `creator_is_admin` convention); comments gained
`author_official_*`, under the same anonymity rule — **an anonymous comment
never carries its author's office**, which would identify them as surely as
their name.

`CommunityInputPanel` no longer hand-rolls its own `creator-admin-badge`; it
goes through `<Creator>` like every other surface, so the badges cannot drift.

### The legacy list, and the latch

`CIVIC_BOARD_EMAILS` still works as the last-resort fallback, exactly as before:
`getAnnouncementAuthors()` consults it only when no `announcement_authors` row
exists. `resolveOfficial()` falls back to that list (inferring a type from the
free-form label) **until `hub_settings.officials_migrated` is set**.

That latch matters. Without it, demoting someone in the admin panel would be
undone on the next request by the stale list still naming them. It is set by a
live `seedOfficials.ts` run, and by the first save from the admin panel — which
makes the panel self-migrating: it lists managed officials merged with
unmigrated legacy entries, and saving writes them all onto user rows.

### Designating an account that does not exist yet

The hub has no user-directory endpoint, so the admin's input key is still an
email. Designating an unknown email creates a shell `users` row
(`email_verified: false`, `is_resident: false`) the way `verifyCode` does;
`unique(email)` means that person's first sign-in adopts the same row. This
preserves the operator's ability to pre-authorize a board member before they
have ever signed in.

### Deploy order

1. Apply `20260827100000_official_role.sql` to the database. **Done** for prod
   and dev on 2026-08-27, by hand in the Supabase SQL editor.
2. Then push. Per the 08-22 incident, a shared `main` means the migration must
   not trail its writer.

**`scripts/seedOfficials.ts` was NOT run against prod, and should not be.**
Vercel refuses to export secret-typed env vars — `vercel env pull
--environment=production` writes `[SENSITIVE]` in place of
`SUPABASE_SERVICE_ROLE_KEY` — so running it against prod means hand-placing
that key in a local file. Unnecessary: prod has no `CIVIC_BOARD_EMAILS` set at
all, and Admin → Settings → Officials already merges any unmigrated legacy
entries into the roster, so saving there does the same job with no service-role
key on disk. The script remains useful for a self-hosted hub whose operator has
direct credentials.

Both official reads use `select("*")` (or degrade on error) specifically so a
database that has not applied the migration resolves to "no title" instead of
erroring out the content the byline annotates — but that is a safety net, not
the plan.

### Verification

- `tsc` clean (backend + `ui/tsc -b`), **500 unit tests pass** (34 files).
- 59 new assertions across four `tests/unit` files: `officialTypes.test.ts`,
  `authOfficial.test.ts`, `creatorDisplayOfficial.test.ts`,
  `officialsRoster.test.ts`. Per the CI note (only `tests/unit` runs on push),
  the badge decision was extracted into the pure `authorBadges()` so it is
  covered without standing up jsdom for one component — the repo has no
  frontend test runner.
- Against the **un-migrated dev DB**: `GET /process/:id/state` returns the new
  fields as `null` with no error; `listOfficialsWithLegacy()` logs a warning and
  returns `[]`; an admin still resolves to `{ isAdmin: true, label: "Admin" }`.
  The degradation path is real, not theoretical.
- Badge CSS checked by computed style in the running app: office pill
  `#F4E1D2` on `#8C4A2B` (accent), Admin pill `#DCE5F2` on `#15294C` (primary),
  identical geometry, visually distinct. Not screenshot-verified — the preview
  pane returned blank captures.

### Open

- **Nothing is deployed.** Four commits sit on local `main` from two concurrent
  sessions. After deploying, open Admin → Settings → Officials and add whoever
  should carry a title — that first save is also what latches
  `officials_migrated` and retires the legacy fallback.
- **Curated name vs. `full_name`.** The admin-curated name is written to
  `display_name`, and the byline rule is `full_name ?? display_name ??
  "Resident"` — so an official who has set their own real name will show that,
  not the admin's version. Announcements previously preferred the curated name.
  Worth a look if an operator notices.
- **Per-office pill colours are not defined**, only enabled. Every office shows
  the same terracotta pill today.
- **`announcement_authors` is still returned** by `GET /admin/settings`,
  read-only and marked deprecated, so an operator can see what the legacy list
  held. Remove it once prod is migrated and settled.

---

## Feedback archive in the admin panel, and feedback joins the daily digest — 2026-08-27

**Shipped** — pushed to `main` 2026-08-27, live via Vercel auto-deploy.

**No migration.** This change is additive and read-only against a table that
already exists, through an index that already exists. It rode along with
`20260827000000_feedback_topic_category.sql` (entry below) but added nothing to
that deploy-order requirement.

**First look at prod will be empty**, and that is correct, not a fault: the
archive shows submissions from the moment it exists onward, and the only prod
feedback that predates it is whatever is already sitting in the inbox. Likewise
the first admin digest reports a 24h window, so it will name nothing until
residents start submitting.

Two things: feedback got a home in the admin panel, and it stopped emailing on
every submission.

### 1. The archive — `/admin/feedback`

Read-only list of every submission, newest first, filterable by category. The
filter refetches server-side against `feedback_submissions_category_idx` rather
than filtering in the page, so it stays correct once the archive outgrows one
response. Deep links from the digest land on a row via its `id` anchor, which
`:target` highlights.

| Piece | File |
|---|---|
| Read path | `listFeedback()` in `src/modules/civic.feedback/service.ts` |
| Endpoint | `GET /admin/feedback` — `src/controllers/adminFeedbackController.ts`, one line in `adminRoutes.ts` |
| UI | `ui/src/pages/AdminFeedback.tsx` + `.css`, tab in `AdminTabs`, route in `App.tsx` |

**Read-only is a decision, not an omission.** No approve, edit, delete, or
resolve. Feedback is a record of what somebody said; an archive you can edit is
a worse record than one you cannot. It also keeps the surface small — the thing
that makes `AdminReviews` 448 lines is its state machine, and this has none.

**PII.** These rows carry name and email. `feedback_submissions` is RLS
deny-all with service-role bypass, so this endpoint is the first path by which
feedback leaves the database. `requireAdmin` on the whole `/admin` router is
what stands in front of it; the page is linked from no non-admin surface.

### 2. Notifications: per-submission email → daily digest

Every submission used to email the operator immediately. That is what made the
inbox the de-facto archive — the problem the panel exists to solve. Now:

- **`moderation` keeps its immediate email.** It is someone reporting content
  they think shouldn't be up; latency there has a cost.
- **`idea` / `topic` / `bug` / `general` do not.** They land in the panel and
  are summarised once a day by the admin digest.

The policy is one set, `IMMEDIATE_EMAIL_CATEGORIES` in the feedback service,
with `sendsImmediateEmail()` exported so it is testable and greppable. To go
back to emailing on everything, add the categories to that set; to go silent,
empty it. Nothing else changes.

**In the digest** (`civic.admin_digest`), feedback is a `QueueSnapshot` like the
review queues, with one difference worth knowing: **it is a 24-hour window, not
a backlog.** Feedback has no pending/resolved state, so counting "all of it"
would re-report the same submissions every day forever. The window is what keeps
the section honest, and it is why this needed no seen/handled column — i.e. no
migration. Section renders last (it is "what came in", not "what is waiting on
you"), is skipped entirely when the window is empty, and degrades to empty on a
read failure rather than costing the admin the rest of their digest.

Feedback can now be the *only* reason a digest sends, so the subject line had to
read correctly in that case — covered by tests.

### Verification

- `tsc -b` clean, backend and `ui/`. `tests/unit` — 30 files, **441 tests green**
  (8 new in `tests/unit/adminFeedbackDigest.test.ts`).
- Exercised against dev with a real admin session: `GET /admin/feedback` returns
  401 unauthenticated, 200 + `{items, count}` as admin, 400 on a bad category,
  and filters correctly by category.
- Page verified in the browser: tab renders between Moderation and Archived,
  rows render newest-first with attribution, category filter refetches, per-filter
  empty states and singular/plural are right.
- Notification policy verified end to end from the dev server log: an `idea`
  submission logged `saved for the admin panel; no immediate email by policy`,
  while a `moderation` submission attempted the send. (That send returned Resend
  403 — dev sandbox only allows the account's own address, and
  `FEEDBACK_RECIPIENT_EMAIL` isn't it. Pre-existing dev config, unrelated to this
  change, but worth knowing before reading the dev log as a failure.)

### Housekeeping

**Three dev-only rows are now in the dev feedback table**, submitted to verify
the render path and (after the migration landed) the topic round-trip — one
`idea`, one `moderation`, one `topic`, all prefixed
`[dev test row — Claude Code, 2026-08-27]`. There is no delete path by design,
so they will sit in the dev archive. Prod is untouched — nothing was submitted
there.

### Decided against: an attention badge on the Feedback tab (2026-08-27)

Raised, discussed, **declined by Adam.** Recording the reasoning so it does not
get re-pitched every time someone notices the panel has no unread indicator.

**What was proposed.** A counter on the Feedback admin tab showing how many
submissions have arrived since the last look — the same pattern reviews already
use: `users.reviews_seen_at` + `countReviewNotifications()` +
`GET /notifications/reviews/count` + the `civic-nav-menu-badge` in `Nav.tsx`.

**Why it was declined.** Awareness is already covered. The daily admin digest
names new feedback and links into the panel, and feedback is not time-sensitive
— the one category that is (`moderation`) still sends an immediate email. A
badge would only add value in the narrow case of being in the app, mid-task,
between digests. Adam's call: *"I don't need immediate notifications of the
feedback."* Not a cost objection — it simply isn't needed.

**One thing that was misread on the way, worth stating plainly for next time:**
clear-on-view is **per page, not per item**. `AdminReviews` stamps
`markReviewsSeen()` once on mount, so the counter zeroes when the page opens
regardless of whether anything was clicked, read, or acted on. There is no
per-submission read state anywhere in the pattern — `seen_at` is a single
timestamp per *user*, not a flag per row. That is the whole reason one glance
can clear the whole badge. Anyone revisiting this should not design per-item
tracking; it would be a different (and worse) thing than what exists.

**If it is ever revisited, there are two routes, and the obvious one is not
automatically right:**

| | Column (`users.feedback_seen_at`) | Browser `localStorage` |
|---|---|---|
| Migration | Yes — and the schema contract needs the column too | None |
| Across devices | Consistent | Per-device; laptop and phone count separately |
| Survives clearing site data | Yes | No — resets to zero unread |
| Mirrors existing code | Exactly (reviews) | Diverges from the house pattern |

The column route was the default assumption and is why this was deferred out of
the pre-launch window at all. But a badge is a per-viewer convenience, not
shared state, so `localStorage` is a legitimate fit for a single-admin hub and
carries no deploy-order risk. Pick deliberately rather than defaulting to the
column because reviews did.

One implementation note either way: reviews count on `updated_at` because a
review mutates. Feedback rows are immutable, so the equivalent query counts on
`created_at`.

### Open

- **Digest window vs. digest cadence.** The 24h window assumes the daily cron.
  If the admin digest ever moves off daily, that constant
  (`FEEDBACK_WINDOW_MS`) has to move with it or submissions fall through the gap.

---

## Feedback: a "Suggest a topic" category — 2026-08-27

> ### ✅ SHIPPED — migration applied, then pushed, in that order (2026-08-27)
>
> `supabase/migrations/20260827000000_feedback_topic_category.sql` was applied
> by hand in the Supabase SQL Editor to **prod (`Civic-Hub-Floyd`) and dev
> (`civic_hub_floyd_Dev`)**, verified with
> `SELECT position('topic' in pg_get_constraintdef(oid)) > 0 ... → true`,
> **and only then** was the code pushed. `civic-hub` auto-deploys on push to
> `main`, so push *is* deploy — there is no window between them, which is why
> the migration had to land first. The 08-22 ordering hold was honoured.
>
> Kept as a record rather than deleted: the next migration wants the same
> sequence, and a banner that only ever appears unresolved teaches people to
> scroll past it.
>
> **Verification tip worth reusing.** Reading the constraint back with
> `pg_get_constraintdef(oid)` alone is awkward — the SQL Editor truncates the
> string mid-list, and it is easy to misread a stale constraint as a current
> one. Ask a boolean instead:
> ```sql
> SELECT position('topic' in pg_get_constraintdef(oid)) > 0 AS topic_allowed
> FROM pg_constraint WHERE conname = 'feedback_submissions_category_chk';
> ```

Residents can now suggest a **subject the Hub should take up** without starting
a process themselves. It reuses the existing feedback form — one more pill, no
new surface, no new table, no new endpoint.

### What changed

| Where | Change |
|---|---|
| `src/modules/civic.feedback/models.ts` | `"topic"` added to `FeedbackCategory` and `FEEDBACK_CATEGORIES` |
| `ui/src/services/api.ts` | the mirrored `FeedbackCategory` union — **a fourth definition site**, easy to miss |
| `ui/src/pages/Feedback.tsx` | "Suggest a topic" pill (second, after Idea) + hint + subtitle copy |
| `supabase/migrations/20260827000000_feedback_topic_category.sql` | replaces the category CHECK from `20260429000000` with the superset |
| `tests/unit/feedbackCategories.test.ts` | new — drift guard across all four |

**Server validation needed no change.** `isValidCategory()` derives from
`FEEDBACK_CATEGORIES`, so `'topic'` was accepted the moment it joined the list —
verified on the running dev server: `POST /feedback` with a bogus category now
returns `category must be one of: idea, topic, bug, moderation, general`.

**Pill order is idea → topic → bug → moderation → general.** "General" is the
catch-all and stays last; a specific category after it reads wrong. The default
selection is unchanged (`idea`).

### The drift guard, and why it exists

The category set is defined in four places that cannot import from each other —
a TS model, a UI union, a UI pill list, and a SQL migration — and enforced in a
fifth, the database. Nothing kept them in step. `tests/unit/feedbackCategories.test.ts`
parses the newest migration that defines the constraint, the UI union, and the
form's `CATEGORIES` array, and asserts all three equal `FEEDBACK_CATEGORIES`.
Confirmed to fail on a stale constraint before being committed. It is pure
file-reading plus one validation call that returns before `getDb()` — no DB, so
it is safe in the `tests/unit`-only CI.

### ⚠️ Open: there is no admin feedback view

The task asked to make sure the admin view can filter topic submissions as their
own group. **That view does not exist.** `feedback_submissions` is write-only in
this codebase — `submitFeedback()` inserts, and nothing reads it back: no admin
route, no admin controller, no admin page, no `GET /feedback`. Deliberately not
built here, since it is a new surface rather than an adjustment to an existing one.

Until it exists, topic suggestions reach Adam two ways:

1. **Operator email** — already sent per submission, subject line
   `[Civic Hub feedback] topic — <first 60 chars>`, so they are filterable in the
   inbox today with no further work.
2. **SQL** — `feedback_submissions_category_idx` (from `20260429000000`) already
   indexes the column, so the group read is a plain indexed lookup:
   ```sql
   SELECT created_at, name, email, message
     FROM feedback_submissions
    WHERE category = 'topic'
    ORDER BY created_at DESC;
   ```

**Open question for Adam:** if choosing launch content is going to be a repeated
pass over these, an admin feedback list (read endpoint + category filter, mirroring
`AdminReviews`) is the natural follow-up. Worth deciding before the Hub launches
rather than during.

### Verification

- `tsc -b` clean, backend and `ui/`.
- `tests/unit` — 29 files, **433 tests green** (5 new).
- Dev UI at `/feedback`: five pills render, "Suggest a topic" selects, hint reads
  "A topic the Hub should discuss — for when you'd rather suggest an issue than
  start a process yourself".
- **Persistence — verified after the migration landed (2026-08-27).** A `topic`
  submission on dev returned 200, persisted, and read back through
  `GET /admin/feedback?category=topic` as `category: "topic"`. The same request
  had returned 500 (`violates check constraint`) before the migration, so the
  before/after is the constraint and nothing else. It also logged
  `no immediate email by policy`, confirming topic follows the digest path
  rather than the inbox.

---

## Light process-linking, universal across process types (Batch A #8) — 2026-08-25

> ### ⚠️ DEPLOY ORDER — MIGRATION MUST GO TO PROD FIRST
>
> This change adds `supabase/migrations/20260825000000_process_links.sql`.
> **Apply it to prod Supabase BEFORE deploying the code that writes
> `process_links`.** Per the 08-22 incident, a shared-main push must not get
> ahead of its migration: the write paths here (link creation, and draft
> submission, which materializes `draft.links`) hit `process_links` and the
> new `links` columns on the three draft tables. Without the migration those
> writes fail.
>
> Apply via Supabase → SQL Editor (dev first, then prod). Verify with:
> `SELECT to_regclass('public.process_links') IS NOT NULL AS table_ready;`
> — expect `t`. The schema contract now names `process_links` and the draft
> `links` columns, so a deploy-before-migrate shows up in the boot log and on
> `GET /health` instead of surfacing as a 500 later.

Reopened #8, deferred on 2026-08-10. Built to the design of record, with one
decision escalated to universal at Adam's direction: **linking is a property of
every process, not a capability each process type opts into.**

### The shape of it

**One row per relationship.** `process_links(from_id, to_id, relation)` stores
the edge once, in the direction the author asserted it. The backlink is
*derived* by reading `to_id` — never written. That is the whole design: a
backlink cannot drift from its forward link because there is nothing to keep in
sync. Both ends carry the same link id, which the unit tests assert directly.

**Relation vocabulary:** `continues` / `references` / `implements`, enforced by
a CHECK constraint so a bad write from any path (app, script, SQL console) is
refused rather than stored. Each relation has a forward and a back label
("Continues" ⇄ "Continued by"), resolved per side at render time.

**Visibility is inherited, not stored.** There is no `status`/`approved` column
on `process_links`. A link renders only when the process it hangs off is itself
publicly visible — so a resident's proposed links stay private while their
submission sits in `pending_review`, and go live when an admin approves. The
review flow already governs that; a second state machine here would only be
something else to keep honest.

### Why it is universal

Six of the seven seams cost a future process type nothing:

1. `from_id`/`to_id` reference `processes(id)` with no notion of type.
2. The API keys on a process id — `/process/:id/links`, mounted once.
3. The typeahead reuses the existing `search_processes` RPC with no type
   filter, and `search_doc` is maintained by a trigger on `processes`, so a
   new type is findable the moment a row exists.
4. `renderLinks()` is pure and type-agnostic.
5. Authz reads `processes.created_by`.
6. `submitForReview()` is the one funnel every process type passes through
   (`submitAsCreator` submits first and auto-approves for admins), so
   creation-time links materialize there for every type at once.

The seventh — the detail route for a link card — was a hardcoded `switch` in
`civic.search`. It is now `ProcessHandler.detailPath`, declared on the handler
alongside `requiredSchema` and `generateBrief`, resolved through
`processDetailPath()` in the registry. **This also fixed a latent bug:** search
had no case for proposal / project / deliberation / wordcloud, so those hits
had been falling through to `/process/:id`. Search now routes through the same
resolver and gets the fix for free.

Adding a process type later means: set `detailPath` (one line, optional —
omitting it falls back to `/process/:id`, which always resolves), and mount
`<RelatedProcesses processId={id} />` on its detail page. Nothing else.

### Files

**Migration** — `20260825000000_process_links.sql`: the table (+ unique edge
index, both-direction indexes, RLS ENABLE+FORCE per project convention), plus
a `links` jsonb column on `proposal_drafts` / `vote_drafts` / `project_drafts`.

**Backend**
- `src/modules/civic.process_links/` — pure module (models + service). Names no
  process type. `validateLink` / `validateLinkSet` / `renderLinks` /
  `suggestionSeed`. Owns NO status list — see the spec-conformance pass below.
- `src/services/processLinks.ts` — Supabase adapter (edges, peer hydration,
  idempotent create, delete).
- `src/controllers/processLinksController.ts` + `routes/processLinksRoutes.ts`.
- `src/processes/types.ts` + all nine handlers — `detailPath`.
- `src/processes/registry.ts` — `processDetailPath()`.
- `src/modules/civic.search/` — `hrefFor` switch replaced by an injected
  `HrefResolver`; the controller passes the registry's.
- `src/modules/civic.review/` — `SubmitForReviewInput.links`, materialized in
  `submitForReview` right after the process row insert.
- `src/db/schemaContract.ts` — `process_links` in `CORE_REQUIREMENTS` (core,
  not a handler declaration: every process has links), plus the draft `links`
  columns.
- The three draft modules + controllers — `links` persisted on the draft and
  passed into `submitAsCreator`.

**Frontend**
- `ProcessLinkPicker` — debounced typeahead, keyboard nav, request-sequence
  guard against the slow-response race. With an empty query it seeds from the
  draft's own title/description, which is what produces the auto-suggested
  candidates before the author types.
- `ProcessLinkField` — the creation-time field, on all three drafting forms.
  Explicitly labelled Optional; nothing validates it as required.
- `RelatedProcesses` — the detail-page panel. Renders forward links and
  backlinks from the same rows. Mounted on Process, ProposalDetail,
  ProjectDetail, DeliberationDetail, **plus AdminReviews and MySubmissions** so
  proposed links are part of what the admin reviews and what the creator sees.

### Permissions

Reading is public. Writing is **the process's creator OR an admin** — the
resident asserts the relationship, and the admin who reviews the submission can
append to it or take it away. `GET /process/:id/links` returns `can_edit`,
decided server-side, so mounting the panel stays one line and no page has to
fetch `created_by` just to pick an affordance.

Removal authorizes against the process that *authored* the edge: the process on
the receiving end of a backlink did not assert the relationship and does not get
to silently drop it.

Link create/remove emits `civic.process.updated` through `emitEvent()` (design
constraint #2 — no silent state changes). That type is default-CLOSED in the
feed classifier, so it records the change without posting a feed card.

### Verified

`tsc -b` clean (backend + UI), `vite build` clean, **342 unit tests pass across
24 files** — 29 of them new in `tests/unit/processLinks.test.ts`, covering edge
storage (vocabulary, self-link, dedupe, cap, and that no inverse row is ever
produced) and both-direction render (same edge → outgoing on one end, incoming
on the other, same link id, correct inverse label per relation, withheld peers
dropped, newest-first ordering).

### Not built — deliberately out of scope

- **Topics** and **convert-at-close** — later slices, per the design of record.
- The add-link affordance is **not** on announcement / meeting-summary /
  wordcloud / brief pages (Adam, 2026-08-25). They can still be linked *to* and
  appear as peers; they just don't offer the button.
- `civic.vote` keeps `detailPath: /process/:id`, matching its existing route.

### Spec-conformance pass (audited before commit)

Checked against `/specs/civic-activity.md`, `/specs/civic-event.md`,
`/specs/civic-process.md`, `/specs/civic-hub.md`, and
`/specs/civic-plugin-architecture.md`. Two violations found and fixed:

1. **Activity data namespacing.** §5 — *"the `data` field MUST be namespaced by
   `activity_type`."* Every existing emitter uses exactly one key
   (`data.process`); this had `data.process` and `data.process_link` as
   siblings. That mattered more than it looks: `withPayload()` carries `data`
   **verbatim** into `hub:payload` on the AS2 wire, so the shape is a public
   commitment. Now nested as `data.process.link`.
2. **A second source of truth for "publicly visible."**
   `services/processLifecycle.ts` already owns `NON_PUBLIC_STATUSES` +
   `isPubliclyFetchable()`. The linking module had grown its own copy that
   *also* listed `draft` — two lists that disagreed on day one, which is the
   exact drift the schema contract exists to prevent. The module's copy is
   gone; the adapter calls the canonical helper and the unit test pins the
   property in its real home.

Confirmed aligned: `civic.process.updated` is a canonical v0.1 lifecycle
activity (§4.1), already mapped to AS2 `Update` — no new event type invented.
`GET /events` suppresses events belonging to `pending_review` processes via
`getNonPublicProcessIds()`, so proposed links on a submission under review do
not leak onto the public wire. And per the plugin architecture's one principle
(least privilege), linking is a **host** capability: no `ProcessHandler` can
write a link — `createEdge` is reachable only from the host controller and
`submitForReview`.

### Deferred by decision — process relationships on the wire

**No spec covers relationships between processes** (searched all four; there is
no `related` / `parent` / link concept anywhere). So this slice introduces a
protocol-level concept that lives only in the implementation, and a link
currently reaches the wire as an opaque `hub:payload` blob rather than
something a federated consumer can follow.

**Decision (Adam, 2026-08-25): ship the hub-local form now; do the AS2 work
when the Phase 3 bridge starts.** AS2 has native homes for it (`context`,
`inReplyTo`, `target`, `Relationship`) and civic-activity.md §9 already
earmarks `process_id → object.context`. Two pieces of work at bridge time:
project process_links as a real AS2 relationship (a **wire change** — goldens
updated deliberately), and decide whether the activity/process specs should
define relationships at the protocol level (a design-review call, not a code
change).

Recorded in three places so it can't be lost: a `DEFERRED — PROCESS
RELATIONSHIPS` block in the header of `src/events/activitySerializer.ts`
(where whoever starts the bridge will open the file), an entry under
Protocol / Federation in `IDEAS.md`, and here.

### Dev smoke test — migration applied, endpoints exercised (2026-08-25)

Migration applied to **dev** (`urfmvqhzmamigssqwsya`). Boot log reports
`[schema] ✓ 28 table(s) match the code`, so the contract sees `process_links`
and the three draft `links` columns. Exercised against the live DB: typeahead
(returns `/deliberation/:id` for a Polis conversation — the route the old
hardcoded switch got wrong), create, both-direction read (same `link_id` from
each end, `Continues` ⇄ `Continued by`), idempotent re-assert, delete, and
every guard (self-link, unknown relation, unknown target, unauthenticated
write). AS2 wire form confirmed as `hub:payload.process.link` on an `Update`.

**Two bugs the unit tests could not catch, found here and fixed:**

1. **Admins got no add-link affordance.** `GET /:id/links` is a public route,
   so no middleware populates `res.locals.authUser` — reading it there made
   `isAdmin` permanently false, and an admin viewing a process they did not
   create received `can_edit: false`. That silently broke the entire
   admin-review surface, which is the reason the panel is mounted on
   AdminReviews at all. The caller is now resolved from the bearer token
   directly, the same shape as `eventController.callerIsAdmin`. **This class of
   bug is invisible to the infra-free unit suite** — it lives in the gap
   between a pure module and its HTTP surface.
2. **The activity payload named the target's title.** `to_title` duplicated
   into `data.process.link`, which is carried verbatim onto a permanent,
   append-only public wire. Archive the target later and its title is still
   named in an activity that cannot be retracted. Dropped; `to_id` identifies
   the target, and a consumer entitled to see it can dereference it. Verified
   by flipping a linked process to `pending_review` and confirming newly
   emitted activities carry no title.

Also confirmed under that flip: an anonymous caller sees the link withheld
(peer not hydrated), which is the load-bearing privacy guarantee for a
resident's proposed links.

Dev test data cleaned up — `process_links` is empty and no process was left in
a non-public status.

### UI walkthrough — the full round trip, in a browser (2026-08-25)

Drove the real flow on dev: new proposal → the picker's **auto-suggestions**
surfaced the related vote from the draft's own title before anything was typed
→ picked it as `continues` → confirmed the link persisted onto
`proposal_drafts.links` → Code of Conduct check → submit. `submitForReview`
materialized the edge, and the live proposal renders **Continues → Add More
Secure Dumpster (Green Box) Sites**, while the vote now renders **Continued by
→ Add recycling to the new green box dumpster sites**. One row, both ends, and
the backlink was never written.

**Two more bugs, both invisible to the tests and to the API-level pass:**

1. **The auto-suggestion feature was dead on arrival.**
   `websearch_to_tsquery` **ANDs** bare space-separated terms — the code
   comment claimed it ORed them. A six-word seed therefore demanded all six
   words co-occur, which essentially nothing satisfies, so the suggestion
   query silently returned zero every time. It failed by looking exactly like
   "no matches." `suggestionSeed` now joins terms with explicit `OR`; a typed
   query is still passed through untouched, because AND is what someone typing
   two words means. Two regression tests pin the OR, including that a
   single-term seed emits no dangling operator.
2. **The panel had no bottom margin.** `margin-top` only — so on the proposal
   page the comment form butted directly against the last link row (measured
   gap: 0px). Symmetric margin added.

**Note for future slices:** every bug found after the unit suite went green
lived in the same place — the seam between a pure module and the world
(HTTP auth, Postgres query semantics, CSS neighbours). The infra-free suite is
structurally blind there, and four bugs in a row is not a coincidence. Budget
a real-environment pass; it is not optional polish.

### Linking through the admin/resident review negotiation — verified

Walked the full back-and-forth on dev as a real non-admin resident plus an
admin. All of it works:

resident links at creation → submits (stays `pending_review`, link private:
the target vote showed 2 public backlinks, not 3) → both resident and admin
get `can_edit: true` on the pending submission → **admin appends a link** →
admin requests changes → **resident adds another link while in
`changes_requested`** → resident revises and resubmits and **all links
survive** (`reviseAndResubmit` only touches title/description/content/config,
so it cannot clobber them) → **admin removes one of the resident's links** →
approve → both ends live and public. A declined submission goes to `archived`,
which keeps its links hidden.

**Decision (Adam, 2026-08-25): link changes are deliberately NOT tracked in the
review thread.** `takeSnapshot` captures title / description / content /
config, and links are intentionally left out, so a turn records no link
history and neither party is notified when the other edits. That was weighed
and declined: the resident can see the current link set on their submission at
any time, and seeing the current state is what agreement actually requires. Do
not add snapshot tracking or change-notifications without asking — this is a
settled call, not an oversight.

### Slice A — linking reaches briefs and content posts — 2026-08-25

Follow-on to the linking slice, from Adam's review of it on prod. **No
migration.**

**Briefs now carry the thread into the permanent record.** Three things stack
on a brief's page:

1. **The brief ⇄ source pair, DERIVED not stored.** A brief already records
   what it summarizes in `state.source_process_id`. Writing a `process_links`
   row for it would be a second record of a relationship the system already
   holds — the duplication this whole design exists to prevent — and it would
   have needed a fourth relation in the vocabulary, and therefore a second
   prod migration. So the pair is computed at read time from the field the
   brief system already maintains: it cannot drift, cannot be forgotten, and
   cost no schema change. A brief reads "Summarizes →"; its source reads
   "Summarized by ←".
2. **The source's links, PROJECTED not copied.** A brief displays the links of
   the process it summarizes. Copying them would again mean two rows for one
   relationship; projecting keeps the row on the source and the brief current
   if a link is added later. Adam chose live-projection over a frozen snapshot
   (2026-08-25) — links are navigation, not evidence, and a stale brief helps
   nobody.
3. **Its own links, editable.** The brief's *content* is a sealed record; its
   relationships are not. Adam: "the brief [is] totally uneditable and
   archivable other than the linking … linking is this separate capability down
   below the brief."

Both derived and projected links carry flags (`synthetic`, `inherited`) and no
remove control. Verified on dev that the API refuses to delete either — one has
no row, the other's row belongs to the source.

**Content posts show backlinks, never originate them.** Announcement and
meeting-summary pages mount the panel `readOnly`: a process may link *to* them
and the counter-link renders so a reader can follow it back, but they offer no
add or remove control. **Word clouds are excluded entirely** (Adam,
2026-08-25) — the word cloud is a community amenity, not a stage in a civic
process, and a links panel would only pollute it. It stays linkable *as a
target* if someone genuinely wants to cite one.

**Relation defaults per process type, never restrictions.** Project →
`implements`, vote → `continues`, everything else (including proposals and
conversations) → `references`.

> **Proposal vs proposed vote — do not conflate these.** A **proposal**
> (`civic.proposal`) is an idea board: float an idea, gauge interest. It is NOT
> a vote and never becomes one (`processes/proposalAdapter.ts`). A **proposed
> vote** is a `civic.vote` sitting in `proposed` status gathering support until
> it crosses a threshold and opens for balloting — same type as a live vote,
> earlier in its lifecycle. They share the word "propose" and nothing else.
> That distinction is why a proposal defaults to `references` (it opens a
> thread) while a vote defaults to `continues` (it follows a discussion or a
> proposal). Adam is considering renaming the user-facing label to "proposed
> vote"; the Process Picker copy already separates them by intent, and the
> Batch A fast-follow about "needs supporters" framing points the same way.
The default leads the dropdown; all three stay available for every type,
including types not yet invented — one of them will legitimately implement
something that is not a project. A test pins that an unknown type still gets a
valid default.

**Also:** the field's copy now asks whether this connects to a community
process "happening now, or one that already happened … helps people follow a
topic across processes"; and a `?` beside **Relationship** expands an inline
glossary of the three relations (inline, not a hover tooltip, so it works on a
phone and by keyboard).

**Confirmed already correct, not changed:** editing links does NOT invalidate a
passed Code of Conduct check — the link field patches with
`skip_modified_flag: true` and `updateDraft` honours it.

**Deliberately not built.** No Topics.

**No thread strip, and this is a settled decision — not a backlog item**
(Adam, 2026-08-25). One hop in each direction, from every process, brief,
announcement and meeting summary, is the whole navigation model. Reasons, so
nobody re-opens this on aesthetics:

- **The relation labels already carry the signal.** "Continued by →" tells a
  reader a later stage exists; "Continues →" tells them an earlier one does.
  A thread view would mostly restate what the labels say, using far more of
  the page.
- **Any rendered thread must pick a path, and the data does not support
  picking one.** The spine/lateral idea (treat `continues` + `implements` as
  the thread, `references` as lateral) is an editorial judgment dressed as
  structure. When it picks wrong it actively misleads, which is worse than
  showing nothing. Adam caught the linear-order version of this first: the
  order is NOT conversation → proposal → vote → project, and a strip implying
  it would lie.
- **Every node is an entry point, which is the actual win.** Backlinks are
  free and automatic, so there is no privileged place to stand. This is
  ordinary hypertext, and it works because each page is honest about its
  immediate neighbours instead of summarizing a graph.
- **Cheap to add later, awkward to remove.** All the data is there; a thread
  view is pure read-layer work whenever wanted.

**The known cost, stated plainly:** standing three hops from the origin, you
can reach it but cannot see it. Briefs soften this by already showing their
source's links (a free second hop).

**The trigger to revisit** — the only one: if anyone finds themselves
repeatedly clicking three or four hops to reconstruct a history, especially
reading a brief for posterity. Absent that, leave it alone.

**Still to build: convert-at-close.** Pre-fill the link when a project is
started from a closed vote (and equivalent transitions). This is the higher-
value work, and deliberately ranked above any visualization: a thread strip is
the wrong thing to optimize in either world — if linking is sparse it has
nothing to show, and if linking is dense one-hop navigation already works.
What decides which world we are in is whether links get created at all, and
that currently depends entirely on people remembering.

### Shipped — status at end of session

**Deployed to prod and healthy.** `20260825000000_process_links.sql` is applied
to prod; `GET /api/health` reports 28 tables checked, zero gaps, which is
positive proof (the contract names `process_links` and the three draft `links`
columns, so a missing one would be itemized). The whole batch is on `main` at
`Mosaic-Foundation/civic-hub`. Note `/health` is NOT in `vercel.json`'s
rewrites — the Express app is only reachable under `/api`, so the health URL is
`/api/health`; plain `/health` returns the SPA's HTML.

**Automated coverage is thinner than the test count suggests.** 352 unit tests
pass, but the linking work has *no* API or E2E tests — every integration
behaviour was verified by hand against dev and prod. `TESTING.md` lists each
unverified flow explicitly rather than leaving the gap implied. Six bugs in
this slice survived a green unit suite, so treat that inventory as real work,
not bookkeeping.

### Closing the test gap — what CI can and cannot be made to guard — 2026-08-26

**The finding that shaped this.** CI (`.github/workflows/ci.yml`) runs four
things: install, `tsc`, `npx vitest run tests/unit`, and a UI build. It has no
database and no server, so neither `tests/api` nor `tests/e2e` runs on push —
for linking or for any other feature.

**A bare Postgres service container cannot fix that**, which I got wrong at
first and record here so nobody else spends time on it: the app talks
exclusively through `supabase-js`, which speaks to PostgREST. A `postgres:16`
container has no PostgREST, so the app cannot connect to it at all.

**What IS true and useful:** all 28 tables the code declares are created by
files in `supabase/migrations/` — nothing was hand-made in the Supabase
console. So the migration set is complete and a from-scratch build is viable
whenever it is wanted.

**What was done instead, deliberately small.** The linking *decisions* were
extracted from the controller into pure functions the existing CI already
guards: `canEditLinks`, `canRemoveLink`, `edgeBelongsToProcess`,
`isRemovableLink`. 14 new unit tests, including a **regression pin on the
can_edit bug that actually shipped** — an admin viewing a process they had not
created got `can_edit: false`, because the controller derived `isAdmin` from
`res.locals.authUser` on a route with no auth middleware. That decision is now
separable from the wiring and CI-guarded; the wiring left behind is one line.
Behaviour re-verified against dev after the refactor (admin true, resident
false, anonymous false, resident write refused).

This does not make the wiring impossible to get wrong. It makes it hard to get
wrong *quietly*.

**Still not guarded automatically**, and listed row by row in `TESTING.md`:
anything requiring a real database — links surviving revise-and-resubmit,
pending-review privacy, delete-cascade, the brief ⇄ source derivation,
inherited links, and the two UI behaviours. All verified by hand on dev and
prod; none re-checked on push.

**To actually run integration tests in CI**, two options, neither done:
- **Supabase CLI local stack** (`supabase start` in the workflow). Correct and
  isolated — a real Postgres + PostgREST per run, applying
  `supabase/migrations/` from empty, no secrets. Would also prove the migration
  set builds a working schema from scratch, which has never been verified.
  Needs `supabase init` (there is no `config.toml` today) and adds image-pull
  time to every run.
- **A Supabase project dedicated to CI.** Much less work: second free project,
  URL + service key as GitHub secrets, migrations applied once by hand. But
  test data accumulates (`review_turns` is append-only and cannot be cleaned),
  concurrent pushes collide, and it puts a full-access key in CI.

**Do NOT point CI at the dev project Adam works in** — CI runs would collide
with hands-on use and leave permanent residue in a database he browses.

### Outcomes — a public index of completed processes — 2026-08-26

**The gap it closes.** A published brief was reachable three ways: a feed card
(which decays out of view in days), search (which needs you to know the words),
and a direct link from a related process. There was no `/briefs` index at all,
so "what has this community actually decided" had no answer and a permanent
record had no front door. **No migration** — briefs are already process rows.

**`GET /brief`** returns every published brief with the filter options present
in the data. Filtering and sorting run in the pure module
(`civic.brief/filterIndex`) rather than in SQL — deliberately. The set is one
row per completed process for the life of a hub, and keeping it pure puts the
page's entire behaviour in the layer CI actually runs. 18 unit tests.

**`related_count` counts the SOURCE process's links, not the brief's.** A brief
owns almost no stored links — its relationships are derived (the brief ⇄ source
pair) or projected from the source. Counting the brief's own rows reported 0
for an outcome that visibly displays two, which is worse than showing nothing.
Caught by looking at the live response, not by reasoning.

**The page** (`/outcomes`, nav tab last, after the surfaces where things are
still happening). Type chips, year select, newest/oldest, and a row per
outcome: title, source-type pill, outcome headline, date, participation, and
"N related" so a reader knows an outcome sits in a thread before clicking.

- **Named "Outcomes", not "Results"** — results implies vote tallies, and this
  holds conversation summaries and project retrospectives too.
- **Filter options are derived from the data**, never enumerated, so a process
  type registered later appears the first time one of its briefs publishes. A
  test pins that.
- **No search box.** `/search` already indexes briefs; a second search here
  would drift from it.
- Every filter combination was exercised against the live endpoint with
  fixtures spanning three source types and two years, then the fixtures were
  removed.

**Known, not fixed:** a `published_at` at midnight UTC renders as the previous
day west of UTC. App-wide `toLocaleDateString` convention, not introduced here,
and real publication timestamps are not midnight — my fixtures exaggerated it.

### Outcomes rows are colored by process type — 2026-08-26

The index shipped in grayscale. Rows now carry the **same palette the feed
uses**, keyed to the source process type: a colored pill and a 3px left border
in the pill's foreground color. The border is the cue that survives scanning a
long list, where the pill sits far right and the eye runs down the left edge.

**The feed's pill hexes were promoted to tokens first.** `Feed.css` carried
bare hexes for proposal / conversation / project / wordcloud; those are now
`--pill-<slug>-*` in `theme.css`, and both `Feed.css` and `Outcomes.css` point
at them. Two files holding the same hexes is a drift waiting to happen. Pure
refactor — identical values, no visual change to the feed.

**Only color is keyed to type, never layout**, so a process type registered
later inherits the whole row shape and merely looks neutral until someone adds
two lines.

### Feed double-posting — FIXED 2026-08-26

Adam assumed a closing process posts one feed card. That holds for two types
and not the third:

- **Votes** — no `civic.process.ended` case in the classifier, so a closing
  vote posts nothing; only its published brief posts. Clean.
- **Conversations** — deliberately fixed already; `polis_deliberation/handler.ts`
  records that the old auto-post was *"intentionally removed"* so brief
  publication is the announcement. Clean.
- **Proposals — double-post.** `civic.proposal.closed` posts a PROPOSAL CLOSED
  card AND the brief posts PROPOSAL RESULTS. Two cards, same proposal. They are
  separated by however long admin review takes, so they only stack visibly when
  review is fast.

**Done (Adam, 2026-08-26):** `civic.proposal.closed` no longer produces a feed
card — `classifyActivity` returns null for it. The published brief is the
announcement, matching votes and conversations. All three process types now
behave alike.

The EVENT still fires and is still on the wire; only the card is withheld. The
`proposal-closed` kind stays defined across the feed and digest renderers
because proposals closed BEFORE this change keep their cards — the feed is a
projection of an append-only log, not a re-render of current policy.

**The digest followed for free, and a test proved it rather than my asserting
it.** `civic.digest/filter.ts` delegates to the same `classifyActivity`, so the
item left the email in the same commit with no digest code touched — and
`digest-parity.test.ts` failed, which is exactly how that was confirmed. Both
that test and the feed classifier test were rewritten to assert the new intent
with the reasoning inline, not edited to make red go green.

### Admin panel — "Process reviews", and the archive-coverage gap — 2026-08-26

**Renamed** the admin tab and page heading from "Reviews" / "Submission
reviews" to **"Process reviews"** (Adam). The queue handles every process type
now, and "Reviews" read like it might be something narrower.

**Finding — the Proposals admin tab is a leftover, but deleting it would break
archiving.** Two archive routes exist:

- `POST /admin/processes/:id/archive` — generic, any process type, added with
  the Archived tab and the reusable `AdminArchiveButton`.
- `POST /admin/proposals/:id/archive` — proposal-only, and older.

So archiving is NOT proposal-specific. But `AdminArchiveButton` is mounted on
only **three** pages — Announcement, MeetingSummary, and Process. It is missing
from ProposalDetail, ProjectDetail, DeliberationDetail, Brief and WordCloud.

Consequences today:
- The Proposals tab is the ONLY way to archive a proposal.
- **Projects and conversations cannot be archived from the UI at all** — the
  generic route exists and nothing calls it.

**Proposed slice (not built):** mount `AdminArchiveButton` on the detail pages
missing it, then retire the Proposals tab and its proposal-specific route.
Archiving then works identically everywhere — from the thing itself — and the
Archived tab stays the single place to review and restore. Do NOT just delete
the tab first; it is currently load-bearing.

Also noted: the Proposals tab lists ALL proposals (`listProposals()` takes an
optional status filter and the page passes none), so a short list there means
few proposals exist, not that it is truncating.

### Archive audit — the child-table blind spot, and what it found — 2026-08-26

Adam asked whether the proposals/projects "own child table" split causes
problems anywhere else. Audited every writer of `processes.status` against
every writer of `proposals.status` / `projects.status`.

**The modules were already disciplined.** `archiveProposal`,
`closeExpiredProposal`, `archiveProject` and `completeProject` all write BOTH
tables. No one-sided status writes exist. (`supportProposal` looked one-sided
but writes `proposal_supports` and only reads status.)

**The gap was in the GENERIC service, and it was real.** `archiveProcess` knew
only about the `processes` row — hence the `onArchive` / `onRestore` hooks.

**And the audit found a live bug beyond archiving.** Archiving a proposal hid
it from `/process/:id`, the generic list and the feed — but `/proposals/:id`
still returned 200 and it still appeared on `/propose`. The proposal's own read
paths never filtered archived status, because before this slice archiving one
was rare and admin-driven. **A take-down that leaves the direct link working is
not a take-down.** Fixed: `getProposalReadModel` returns not-found for an
archived proposal, and `listProposals` / `listProjects` exclude archived unless
a caller asks for that status by name. Verified: archive → all three surfaces
404/absent → restore → all three back.

**`deleteProcess` REMOVED (2026-08-26).** It was not quite dead — no app code
called it, but `scripts/verifyPhase2Close.ts` did. It hard-deleted a
`processes` row and its events while **`proposals` and `projects` have NO
foreign key back to `processes`**, so it silently orphaned child rows. The
script now cleans up its own throwaway ids directly. Archiving is the supported
removal path: reversible, visible in the Archived tab and moderation log, and
it syncs child storage through the hooks. If a hard delete is ever genuinely
wanted, **add the foreign keys first** so the database enforces cleanup rather
than trusting a helper to remember every table.

**Universality — verified, not assumed.** Archived and restored one of every
registered type present on dev: brief, conversation, vote and proposal all
round-tripped correctly, including `civic.brief`, which implements neither hook.
A new plugin type gets archiving free as long as its state lives in the
`processes` row.

**Guard for future plugins:** `tests/unit/archiveHooks.test.ts` pins the
registry. Registering a new process type FAILS that test until someone adds it
to `KNOWN_TYPES`, and the failure message asks the one question that matters —
does this type keep state outside its processes row? A deliberate speed bump;
nothing can detect that automatically without a database. Confirmed the guard
actually fires by registering a fake type and watching it fail.

**Why proposals/projects differ at all** — worth recording, since it reads like
an oversight and isn't. The 2026 universalization aligned the **registry and
read layer**: every type has a `processes` row and appears in
`listProcessSummaries`, discovery, the dispatch loop, links and briefs. It did
NOT unify **storage or HTTP surface** — both adapters say so in their own
docstrings. Proposals and projects keep relational tables that own their real
state, reached through `/proposals` and `/projects` rather than the generic
action dispatcher, because those tables buy indexed queries on support counts
and comments-as-rows that JSONB state would not. The cost is that anything
operating generically over "a process" can miss the child row. The hooks are
the systematic answer: a type declares what it owns, and the service grows no
switch. If proposals ever migrate fully into `processes.state`, delete the hook
and nothing else changes.

### Open questions

- **Dev carries one demo artifact:** proposal `proc_69cda899e1fa420a` ("Add
  recycling to the new green box dumpster sites"), created through the UI
  during the walkthrough and linked to the green box vote. Left in place
  deliberately so the feature is visible on dev; delete it and its
  `process_links` row if unwanted. Two further test proposals were **archived**
  rather than deleted — `review_turns` is append-only at the database level and
  correctly refused the delete.
- **`Participation-Model.md` was not found** anywhere on disk (searched the
  monorepo, all doc folders, the subrepo, and `~/Developer`). This was built
  against the design as Adam stated it in-session. Worth reconciling if that
  document exists somewhere I couldn't see.
- **Docs name the wrong GitHub org.** Both HANDOFFs still say
  `creatinglake/civic-hub`, but the remote is now
  `Mosaic-Foundation/civic-hub`. Unrelated to this slice; not swept.

---

## Schema drift check — making the 08-22 outage impossible to miss — 2026-08-24

The waitlist outage was not caused by a fragile settings page. It was caused
by **nothing in the system knowing whether the deployed code and the applied
migrations agree**. `GET /health` returned `ok` throughout: the ping proves the
connection works, and says nothing about the schema standing on top of it.

### What was built

A schema contract, checked at startup and continuously by `/health`.

- **`src/db/schemaContract.ts`** — what the running code needs the database to
  look like. `CORE_REQUIREMENTS` covers tables the core owns regardless of
  which processes are enabled.
- **`src/db/schemaCheck.ts`** — probes each requirement with one bounded
  `SELECT`, in parallel (sequential cost 2.6s against a remote DB; parallel
  ~900ms). Read-only by construction: it never writes, never migrates, never
  repairs. It can only refuse to be quiet.
- **`ProcessHandler.requiredSchema?`** — handlers declare the storage they own.
- **Startup** — `validateSchemaAtStartup()` sits beside `validateEmailConfig()`
  in `app.ts`, logging one line per cold start. Non-blocking: a drifted hub
  must still boot, precisely so it can serve the `/health` that explains why.
- **`GET /health`** — now reports `schema: { ok, checked, gaps }` and returns
  **503 `degraded`** on drift. Only gap descriptions travel in the response,
  not the whole contract.

### Why it composes with the plugin architecture

The list is **not** centralized. Each process handler declares its own storage
(`civic.wordcloud` → `wordcloud_submissions`, `civic.polis_deliberation` → its
two tables, `civic.vote` → the ballot tables), and the checker aggregates
whatever the registry currently holds. A hub that omits a module drops that
module's expectations with it — pinned by a test, because centralizing the
list would silently break exactly that property.

Nothing here touches the Civic Event Spec, the event model, the AS2 wire
format, or the discovery manifest. No new event types, no new routes; the
`level-1` conformance test passes unchanged.

### The ballot-secrecy invariant is now enforced, not just documented

`vote_records` has no `user_id` and `vote_participation` has no `receipt_id` —
that separation **is** the anonymous-ballot guarantee, and until now it lived
in a comment in the initial migration and a "Don'ts" line in the Supabase
README. `forbiddenColumns` inverts the probe: a select that *succeeds* is the
violation. A future migration that quietly joins those tables back together
now turns the hub's health endpoint red instead of silently making every past
ballot attributable.

### Verified, and the false-alarm risk taken seriously

A drift check that cries wolf gets ignored, at which point it is worse than no
check. The first draft invented column names (`wordcloud_submissions.word`,
which is really `body`; a `deliberation_submissions.id` that does not exist —
that table is keyed on `(process_id, user_id)`) and "found" drift on a healthy
database. So the contract was validated against **both** databases:

| Database | First run | After fix |
|---|---|---|
| **prod** (fully migrated) | `✓ 27 table(s) match` — zero gaps, zero inconclusive | unchanged |
| **dev** | one gap: `users.display_name` — **real drift, found by this check** | `✓ 27 table(s) match` |

Dev was behind on `20260619000000_add_display_name.sql`, so `updateDisplayName()`
(Board/committee personal attribution) had been throwing locally while prod
worked. Applied during this session; both databases now match the code.

**A drifted database makes `tests/api/health.test.ts` fail**, because that
smoke test asserts `/health` is 200 and the endpoint is now telling the truth.
That is intended, and the test was deliberately not weakened to accommodate
drift — it failed exactly once here, on the real gap, and went green when the
migration was applied. Suite: 375 tests green.

**Cache TTL is asymmetric on purpose.** A clean result is trusted for 5
minutes (schemas do not drift on their own); a drifted one is re-probed after
30 seconds, because whoever is reading that red health check is very likely
applying the missing migration right now, and an endpoint that keeps insisting
things are broken for five minutes after the fix teaches people to ignore it.
Verified live: /health returned 503 with the gap named, then recovered to 200
on its own once the column existed.

Unit coverage (`tests/unit/schemaContract.test.ts`, 17 tests) pins the parts
that must not regress: connectivity failures are classified `inconclusive` and
never reported as drift; the forbidden-column inversion; the plugin property;
and the exact words an operator reads at 2am.

### What this does not solve

Migrations are still applied by hand, and a shared `main` means "apply before
you push" is the only safe timing. This check shortens the feedback loop from
"a user reports the form is broken" to "the deploy log says so" — it does not
close the window. A pre-push guard comparing migrations against the target
database was scoped and deferred.

---

## Waitlist: optional name, softer opt-in copy, and a prod outage — 2026-08-22

Follow-up to [the test-user opt-in](#waitlist-test-user-opt-in--signup-notification--2026-08-21).
Three things: a production incident, a copy correction, and a name field.

### The outage — deploy order, exactly as warned

The opt-in commit was pushed to `origin/main` by a concurrent session before
the migration had been applied to prod. Vercel auto-deployed it, and prod ran
code that inserts `wants_test_user` against a table without that column.

Two things broke, one of them wider than expected:

- `POST /waitlist` → 500. Nobody could join the waitlist.
- `GET /admin/settings` → 500 — **the entire settings page**, not just the
  waitlist panel. `loadSettings()` awaits `getWaitlist()` inline, so one
  failing `select` takes the whole response down with it.

Diagnosed from the data, not from guesswork: dev had the column and an empty
waitlist (so the failing signup never went there), prod lacked the column and
its newest row was five days old. Fixed by applying both migrations to prod.

**The lesson is the coupling, not the mistake.** Any migration that adds a
column the backend immediately writes must be applied *before* the deploy that
writes it, and a shared `main` means "before you push" is the only reliable
interpretation of "before".

### Copy correction

The checkbox hint said "You'll be approved onto the beta allowlist" — a
promise the hub cannot keep, made to a stranger at the moment they hand over
their address. Now: **"We'll let you know if you're approved for the beta
allowlist."** Same invitation, no guarantee.

### Optional name

`waitlist.name TEXT` (nullable), from a never-required field at the top of the
form. Blank or whitespace-only input stores `NULL`, so "no name given" is one
value everywhere rather than two. The notification leads with it when present
— `TEST USER — Dana Reed <dana@example.com>` reads as a person, a bare address
reads as a row — and falls back to the address alone when absent. Shows as a
**Name** column in the admin waitlist table.

| File | Change |
|---|---|
| `supabase/migrations/20260822000000_waitlist_name.sql` **(new)** | `name TEXT` |
| `src/controllers/waitlistController.ts` | Parses/trims name, 200-char cap, blank → null |
| `src/services/waitlistNotify.ts` | Name in subject and body, escaped |
| `src/services/hubSettings.ts`, `ui/src/services/api.ts` | Select and type the field |
| `ui/src/components/WaitlistForm.tsx` | Name input + revised checkbox hint |
| `ui/src/pages/AdminSettings.tsx` | Name column |
| `tests/unit/waitlistNotification.test.ts` | 13 tests (was 10) |

### Verified

`npx tsc -b` clean (backend and `ui/`); unit suite 294/294. Both migrations
applied to dev **and** prod — confirmed by probing each schema directly.

Through the real form on dev, plus the API for the paths a browser can't reach:

| Submission | Row written | Notifier |
|---|---|---|
| Name + box checked | `name`, `wants_test_user = true` | `TEST USER — Dana Reed <…>` |
| No name, unchecked | `name = NULL`, `false` | Address alone, unflagged |
| Whitespace-only name | `name = NULL` — not `""` | Fired |
| Honeypot filled | **No row at all** | Never reached |

*Testing note worth keeping:* driving the checkbox by setting `.checked` in
the DOM writes `false` — React's `onChange` fires on the click event, not on a
property assignment, so the component state never updates. Any browser
automation against this form must issue a real click, or it will "pass" while
testing nothing. Cost an hour once; will cost it again otherwise.

Dev test rows were deleted after the run.

---

## Read paths: stop trusting `?actor=` (three stragglers) — 2026-08-21

`resolveCallerId()` in `src/middleware/auth.ts` has been the rule for a while —
per-actor fields on public read paths come from the Bearer token, never from the
query string, because `?actor=<someone else's id>` let any caller read another
resident's private state. `projectController` and `announcementController` had
migrated. Three endpoints never did:

| Endpoint | Leaked |
|---|---|
| `GET /proposals/:id` | `has_supported` — whether a named resident endorsed a proposal |
| `GET /deliberations/:processId` | `has_submitted` + whatever the handler personalizes |
| `GET /wordcloud/:id` | `has_submitted` |

All three now call `resolveCallerId(req)`. The frontend helpers lost their
`actor` parameter (`getCivicProposal`, `getDeliberation`, `getWordcloud`, plus
`getProjectDetail`, which was still sending a param the server had already
stopped reading) — the request wrapper's `Authorization` header carries identity
on its own.

**No behaviour change for signed-in residents.** The token resolves to the same
id the UI used to pass; anonymous callers get the public read model, as before.

### Verified

`npx tsc --noEmit` (backend) and `npx tsc -b --force` (`ui/`) clean; suite green
— 29 files, 353 tests. Against dev, with a word cloud whose contributor holds a
real session:

- `GET /wordcloud/:id` **with that contributor's Bearer token** → `has_submitted: true`
- `GET /wordcloud/:id?actor=<that same user id>`, no token → `has_submitted: false`
- `GET /proposals/:id?actor=…` → `has_supported: null` (query actor ignored)
- `GET /deliberations/:id?actor=…` → `has_submitted: false`

The positive control matters: "always false" would also be what a broken
per-actor path looks like.

### Open

- `processController` still carries a **private copy** of `resolveCallerId`
  (line 21) instead of importing the shared one. Identical behaviour; the
  duplication is what let these three drift in the first place. Left alone to
  keep this change to the leak itself.

---

## Word cloud: reveal by default, conceal only during onboarding — 2026-08-21

### First, what the submission rule actually is

Checked because Adam remembered contributing more than once. He hadn't — the
rule is **one submission per person per prompt**, and all three layers agree:

- `submitResponse()` counts the author's rows for the prompt and refuses a second
- `idx_wc_submissions_unique_author` (`process_id, prompt_id, author_id`) enforces
  it in Postgres, so the API cannot be talked around it
- the UI hides the form once `has_submitted` is true

That is the intended rule and it stays. One submission is one short answer of up
to `max_submission_length` (280) characters — the aggregator splits it into
words, so "mountains and music" already contributes two words to the cloud.

*(An exploratory change allowing five distinct responses per person was built
and then dropped in the same session once the intent was confirmed. Nothing from
it remains — no migration, no config field.)*

### What changed

**Concealment is now an onboarding device only.** Previously every first-time
viewer hit the "Add yours to reveal the cloud" curtain. Now:

| Context | Cloud | Form |
|---|---|---|
| `?onboarding=1`, not yet contributed | concealed | shown |
| `?onboarding=1`, contributed | revealed | thank-you line |
| Any other visit, not yet contributed | **revealed** | shown below the header |
| Any other visit, contributed | revealed | thank-you line |

Someone who came to look at the cloud is no longer charged a word for it; the
invitation to contribute stays on offer underneath until they take it, and after
they do they get "Thanks for contributing" instead of a vanished form.

| File | Change |
|---|---|
| `ui/src/pages/WordCloud.tsx` | `PromptSection` takes `isOnboarding`; `revealed` starts true unless onboarding; the form no longer depends on the curtain |
| `ui/src/pages/WordCloud.css` | `.wordcloud-form-done` |

Frontend only — no backend, schema, or event changes.

### Verified

`npx tsc --noEmit` (backend) and `npx tsc -b` (`ui/`) clean; suite green — 29
files, 353 tests. In the browser against dev: a plain visit renders the full
cloud with the form above it; `?onboarding=1` renders the banner, the form, and
the blurred cloud behind "Add yours to reveal". The read model returns
`has_submitted: true` for a seeded contributor and `false` for a stranger, which
is the flag the post-contribution branch keys on.

### Open

- **`GET /wordcloud/:id?actor=<id>` still trusts the query string.** Anyone can
  pass another resident's user id and learn whether they contributed. The same
  hole was already closed on `/process/:id/state` by resolving the actor from
  the session token (`processController.resolveCallerId`); this endpoint should
  follow. Small fix, deliberately not bundled with a UI-only change.
- `has_submitted` is computed **process-wide**, not per prompt, so on a
  multi-prompt cloud one answer would hide every prompt's form. Unreachable
  today — `CreateWordCloud.tsx` only ever creates one prompt.
- Running the API suite calls `GET /debug/seed`, which **clears the dev events
  table and then fails** whenever any `civic.wordcloud` process exists (the
  `wordcloud_submissions` FK blocks `clearProcesses()`). Symptom: six
  `tests/api/events.test.ts` failures and an empty dev feed. Fix is in the
  endpoint's own error message — `TRUNCATE review_turns, process_reviews,
  wordcloud_submissions CASCADE;` in the dev SQL editor, then re-hit
  `/debug/seed`.

---

## Waitlist: test-user opt-in + signup notification — 2026-08-21

The waitlist collected an email and a free-text note, and told nobody it had
done so. Sign-ups sat in a table until someone remembered to open Admin →
Settings, and there was no way to tell "add me to the list" apart from "let me
in and I'll break things for you" without reading every note.

### What changed

**Opt-in checkbox** — "I'd like to be a test user / You'll be approved onto the
beta allowlist" on `ui/src/components/WaitlistForm.tsx` (the form the
BetaLanding splash and the sign-in modal's private-beta fallback both share, so
both entry points get it). Persists to the new `waitlist.wants_test_user`
column and shows as a **Test user** column in the admin waitlist table.

**Signup notification** — every accepted signup emails everyone in
`CIVIC_ADMIN_EMAILS` via the shared Resend helper. The opt-in is in the
**subject line** (`[Civic Hub waitlist] TEST USER — someone@example.com`), not
buried in the body, because that is the part that gets read on a lock screen.

| File | Change |
|---|---|
| `supabase/migrations/20260821000000_waitlist_test_user.sql` | `wants_test_user BOOLEAN NOT NULL DEFAULT FALSE` |
| `src/services/waitlistNotify.ts` **(new)** | `renderWaitlistNotification()` (pure) + `notifyAdminsOfWaitlistSignup()` |
| `src/controllers/waitlistController.ts` | Persists the flag; awaits the best-effort notify |
| `src/services/hubSettings.ts` | `getWaitlist()` selects and types the flag |
| `ui/src/components/WaitlistForm.tsx`, `ui/src/services/waitlist.ts` | Checkbox; `joinWaitlist(email, { notes, wantsTestUser })` |
| `ui/src/pages/AdminSettings.tsx`, `ui/src/services/api.ts`, `ui/src/pages/BetaLanding.css` | Test-user column, type, checkbox styling |
| `tests/unit/waitlistNotification.test.ts` **(new)** | 10 tests |

### Patterns followed, deliberately

- **Best-effort, non-fatal, logged** — same shape as `civic.feedback`'s
  `notifyOperator` and the meeting-summary cron's `notifyCronOutcome`. The row
  is already written by the time we send; a bounced email must not turn a
  successful signup into a 500 for the person who just filled in the form.
- **Awaited, not fire-and-forget.** Serverless freezes the function the instant
  the response is flushed, so an un-awaited send never leaves the box — this is
  exactly the "saved but no email" bug the feedback module already fixed once.
- **Empty `CIVIC_ADMIN_EMAILS` is logged, not silent** — same warning the cron
  alerts emit, so a misconfigured deploy says so instead of dropping signups.
- **Honeypot unchanged, and it still short-circuits first.** A bot that fills
  the hidden `website` field gets the same fake confirmation and touches
  neither the database nor the mailer — spam can't turn into inbox volume.
- **Notes and email address are HTML-escaped** in the email body. Both are
  attacker-controlled free text from an unauthenticated form.

### Follow-up: the confirmation stopped contradicting itself — 2026-08-24

The success state replaced the form but left the heading and description
standing above it, so someone who had just joined was still reading
"Interested in participating? Leave your email and we'll let you know when the
hub opens up" — an invitation to do the thing they had just done, directly
above the message confirming they had done it. Both lines are the invitation,
so both now retire on success and the confirmation stands alone. The sign-in
modal passed neither, so only the beta landing page changed. (`2f8d503`)

Also verified in production this session: a real signup with the box checked
delivered the flagged notification to the operator's inbox — the one link the
local setup could never prove, since that Resend key is sandboxed to a
different address.

### Deploy order matters

The migration must be applied **before** the backend deploys. The insert now
names `wants_test_user`, and PostgREST rejects the whole row if the column
isn't there — sign-ups would 500 in the window between deploy and migration.

`supabase db push` **is not the way to apply this to dev.** The repo's Supabase
CLI is linked to PROD (`nfhyypwoporfggqcerli`); dev is `urfmvqhzmamigssqwsya`.
Paste the migration into the dev project's SQL editor, same as the three
migrations backfilled in the Slice-C session.

### Verified

`npx tsc -b` clean (backend and `ui/`), full suite green — 29 files, 353 tests.

Against the local dev server, with the migration applied to dev:

| Submission | Row written | Notifier |
|---|---|---|
| Box checked | `wants_test_user = true` | Fired, subject `[Civic Hub waitlist] TEST USER — …` |
| Box unchecked | `wants_test_user = false` | Fired, subject without the flag |
| Honeypot filled | **No row at all** | Never reached |

**The dev send does not complete, and that is the local Resend key, not the
code.** That key is sandboxed to `creatinglake@gmail.com` while
`CIVIC_ADMIN_EMAILS` is `adam@civic.social`, so Resend returns 403 and the
notifier logs `notification NOT sent … Resend 403: …`. Useful accident: it
exercised the best-effort path for real — the signup still persisted and the
form still got its confirmation. Production sends from the verified
floyd.civic.social domain (same path as OTP and feedback email), so this
doesn't reproduce there. Subject lines and bodies were verified by rendering
`renderWaitlistNotification()` directly; the unit tests pin both.

Test rows (`tester-checked@`, `tester-unchecked@`) were deleted from dev after
the run.

### Open

- Repeat sign-ups upsert on `email`, so re-submitting with the box unchecked
  clears a previous opt-in and emails again. Correct for "they changed their
  mind", noisy if someone submits twice — revisit if it ever happens.
- Still no automatic email to the *user* when they're moved onto the allowlist
  (the open question from the 2026-06-01 beta-gating session). This change
  tells the operator sooner; it does not close that loop.

---

## Meeting summaries: silent discovery failure + connector ladder — 2026-08-20

Board of Supervisors meeting summaries stopped being generated. Nothing
reported it, because the failure looked exactly like success.

### Root cause

Floyd County rebuilt `https://www.floydcova.gov/agendas-minutes` as a
**client-rendered Wix page**. `fetch()` does not execute JavaScript, so the
connector started receiving a bootstrap shell instead of the listing:

| | plain `fetch()` | real browser |
|---|---|---|
| bytes | 551 KB | — |
| PDF links | **0** | 756 agenda/minutes/recording links |
| visible text | **0 chars** | full listing |
| after `trimMinutesHtml` | **999 bytes of HTML comments** | — |

Every other page on the site still server-renders normally, so this was a
per-page change. Claude was reading the page correctly the whole time — it was
being handed a blank one. Anthropic's `web_fetch` server tool has the same
limitation ("does not support websites dynamically rendered with JavaScript"),
so routing discovery through the API would not have helped either.

**Ruled out:** the cron entry and `/internal/meeting-summary/run` route are
correct (GET, `CRON_SECRET` bearer, shared with three working crons); no
YouTube 429 or captcha (the transcript leg is never reached); `claude-sonnet-4-6`
is a current model. The county's server-rendered `/archive-agendas-minutes`
page exists but is frozen at 2026-06-09, so repointing at it was not a fix.

### Why nobody was told

`notifyCronFailures` returned early unless `failed > 0`, and empty discovery
produces `discovered: 0, created: 0, failed: 0` → HTTP 200. The total-batch
`catch` returned 500 to a cron caller that reads nobody's response and never
notified at all. Two distinct silent paths.

### The fix — a connector ladder, `auto` by default

`MEETING_CONNECTOR_ID=auto` tries each configured connector in order and uses
the first that returns meetings, logging which one won. An operator sets a
source URL and/or a channel id; they do not have to know what kind of site
they have.

| Connector | Reads | Model call? | Notes |
|---|---|---|---|
| `wix-cms` **(new)** | The CMS collection behind a Wix page | No | Works when the page renders client-side |
| `floyd-minutes-page` | Any **server-rendered** listing page, any engine | Yes | The universal fallback |
| `youtube-channel` **(new)** | A government's YouTube channel feed | No | Recordings only, no documents |

**`wix-cms` is the one that fixes Floyd.** A Wix site publishes a read token at
`/_api/v1/access-tokens`; that token queries the collection the page displays.
Verified live: **297 rows** back to 2017, each carrying meeting date, meeting
type, agenda PDF, minutes PDF, and up to three recordings. Wix document
references (`wix:document://v1/ugd/…`) map onto `{origin}/_files/ugd/…`; older
rows already carry absolute `filesusr.com` URLs, and both shapes are handled.
Discovery costs zero model tokens because the fields are structured.

*Stability, stated honestly:* this is an internal Wix endpoint, not a
documented API, so it can change without notice. That is survivable because the
new empty-discovery guard turns a break into a same-day alert, and the ladder
falls through to the next connector rather than taking the run down.

**`youtube-channel`** reads `https://www.youtube.com/feeds/videos.xml?channel_id=…`
— plain XML, no key, no scraping. Dates come from video titles, not upload
timestamps (Floyd's Jun 23 meeting was uploaded Jun 24). Multi-part uploads
collapse into one entry, earliest first. Kept as a fallback and as the right
primary for a body that streams but publishes no documents.

**New `source_type: "recording"`.** `summarizeMeeting` learned to work from a
transcript alone (it previously threw `No PDF available`). Authority order is
minutes > agenda > recording; `agenda` and `recording` are both in
`UPGRADEABLE_SOURCE_TYPES`, so the upgrade pass re-summarizes from official
minutes when they appear. Recording-specific prompt preamble warns about
auto-transcript misheard names and figures. Admin UI gains a "Transcript-only"
badge and review banner.

### Two dedupe bugs found while adding budget workshops

Both were silent-data-loss bugs, and both are now covered by tests.

1. **Same-day meetings collapsed.** The upgrade map was keyed on
   `meeting_date` alone. Floyd held a Budget Workshop *and* a Regular Meeting
   on 2026-06-23, each with its own agenda and minutes — the second was
   skipped as a duplicate. Now keyed on date **and** normalized title.
2. **Same-day, same-type meetings collided.** Floyd held *two* separate Budget
   Workshop Meetings on 2023-04-11, with different agendas and recordings.
   `source_id` now appends a short deterministic hash of the row's own
   documents when a date+type key repeats — stable across runs and independent
   of query order. The upgrade matcher prefers an exact `source_id` and
   **declines an ambiguous date+title match** rather than overwriting the
   wrong summary.

### Cross-connector identity (the migration hazard)

`source_id` is minted by whichever connector found the meeting, so switching
connectors renames every meeting in the database. Production's 48 existing
summaries carry HTML-connector ids (PDF URLs); `wix-cms` mints
`wix:2017Agenda:…`. Nothing would have matched, and the cron would have
re-summarized meetings that already exist.

`identity.ts` (new) fingerprints the **documents and recordings** a summary was
built from, which do not change when the discovery route does. It normalizes
the forms that differ cosmetically:

- `{site}/_files/ugd/{id}.pdf`, `{metaSiteId}.filesusr.com/ugd/{id}.pdf`, and
  `wix:document://v1/ugd/{id}.pdf/…` are one document
- `watch?v=`, `/live/`, `/embed/`, and `youtu.be/` are one video

The cron indexes every existing summary by these fingerprints and skips any
entry sharing one. This also fixes the cross-connector **upgrade** path noted
as an open item earlier: a recording-only summary from `youtube-channel` is now
correctly upgraded when `wix-cms` later reports minutes for the same meeting.

### Per-run cap now covers upgrades too (2026-08-21)

`MEETING_SUMMARY_MAX_PER_RUN` capped creation but **not** the upgrade pass,
which looped over every discovered entry. An upgrade costs exactly what a
creation costs — PDF fetch, transcript fetch, full Claude call — so a run could
make an unbounded number of model calls inside a 300-second function. It also
resets each upgraded summary to `pending`, so an uncapped pass can flood the
review queue with items an admin had already approved.

Pre-existing, but the cross-connector fingerprint matching above made it far
more likely to fire: it previously matched only agenda-typed summaries by
date+title, and now matches any provisional summary by shared document.
Creation and upgrades now share one budget (`created + upgraded >= perRunCap`).

### Three dedupe layers, after a duplicate reached production (2026-08-21)

The first production run produced a second summary for the 2026-06-23 Regular
Meeting, which already had one from June. Document fingerprints are precise but
only hold while the documents persist: a jurisdiction that replaces an agenda
PDF with a revised version, or drops a recording, leaves the old summary and
the new entry with nothing in common. Dedupe now runs three layers, cheapest
and most precise first:

1. **Exact `source_id`** — same connector, same meeting.
2. **Document fingerprints** (`identity.ts`) — survives a connector change.
3. **Per-meeting slots** — count existing summaries per `date::normalized-title`
   and create only the surplus. Independent of documents entirely.

Layer 3 deliberately counts rather than matching booleans, so it does not
reintroduce the same-day collision bug: a date+type that genuinely hosts two
meetings (Floyd ran two Budget Workshops on 2023-04-11) gets two slots, and
only meetings beyond the existing count are created.

**Known limitation:** an *archived* summary is invisible to all three layers,
because `getAllProcesses()` filters out archived rows. Archiving one copy of a
duplicate is safe as long as the other copy remains; archiving the last copy of
a meeting means it will be recreated on the next run.

### The upgrade pass was unpublishing live summaries (2026-08-21)

Floyd's 2026-06-23 summary appeared **twice in the feed** while the admin list
showed a single record — one card dated Jun 25, one dated Aug 21, both linking
to the same video and minutes. Not a dedupe failure: one process, two
`civic.process.result_published` events.

The upgrade pass set `approval_status = "pending"` and `published_at = null` on
an already-published summary. Two consequences, both bad:

1. `getPublicReadModel` returns nothing for an unpublished summary, so a page
   residents already had links to **404'd silently** from the moment the
   upgrade ran until an admin happened to re-approve it.
2. Re-approval emitted a second `result_published`, leaving a stale feed card
   pointing at content that had been replaced.

**Fixed in two places.** The upgrade now keeps an already-published summary
published, applies the better minutes-based content in place, and emits
`civic.process.updated` so the change is on the record. An unpublished summary
still routes through review exactly as before. And `GET /feed` collapses
`result_published` to the newest per process — the log stays append-only and
keeps the true history, while the feed shows current state. Scoped to
publications deliberately; repeated comments and votes are distinct
occurrences and keep their own cards.

Note: the admin "Clean up orphaned feed entries" action does **not** cover
this. It removes events whose process no longer exists; here the process is
alive and both events are valid.

### Feed link health folded into the alarm (2026-08-21)

The run that unpublished two live pages **reported complete success** — every
counter read zero. Publication state broke, not the job, and no cron-level
guard could see it. `services/feedHealth.ts` checks the invariant that actually
matters to a reader: every card in the public feed resolves to content the
public can fetch.

It runs at the end of each meeting-summary cron, against the database (no HTTP),
and feeds `cronAlertReason` so broken links raise the same alarm as a failed
summarization. `broken_links` is also on the run's JSON response. A failing
health check never fails the run that produced good work.

Two gates, because a publication can fail either: the process-level status
(archived, pending_review) and a module's own approval gate, where "published"
lives in `state.approval_status` — the gate the upgrade pass tripped. Only the
newest publication per process is checked, matching what the feed collapses to.

Deliberately type-agnostic: it will catch the next cause as well as the known
one. Worth promoting to its own cron if other publication paths grow.

### Summaries that predate their own meeting (2026-08-27)

The 2026-08-25 Board meeting produced no usable summary and **no alarm**. Not a
pipeline failure — a timing assumption nobody had stated:

```
Aug 21  county posts the Aug 25 agenda
Aug 22  cron summarizes it — from the agenda, three days BEFORE the meeting
Aug 25  meeting happens
Aug 26  county posts the recording
Aug 27  nothing has re-read it
```

Floyd posts agendas ~4 days ahead and recordings ~1 day after, so the cron
**reliably** caught the agenda first and wrote a summary of *planned* topics.
The upgrade pass then declined to revisit it, because it only fired when
official **minutes** appeared (`if (!entry.source_minutes_url) continue;`) and
Floyd had not posted minutes. The summary sat in Pending describing a meeting
that had not yet happened.

No alarm fired because nothing failed: 294 discovered, 0 created (Aug 25 already
had a summary, correctly skipped), 0 failed. `cronAlertReason` had no concept of
"we hold a summary that predates the meeting it describes".

**Three fixes.**

1. **Do not summarize a meeting that has not happened.** The creation loop skips
   any entry whose `meeting_date` is in the future. An agenda describes what is
   planned; summarizing it produces a document that reads as a record while
   predating the event.
2. **Upgrade on a recording, not only on minutes.** Re-summarize when minutes
   appear **or** when a recording appears for a summary that predates its own
   meeting. Guarded so a summary already written after the meeting is not
   re-summarized on every run — that would burn the per-run budget and reset
   review state forever.
3. **Alarm on staleness.** `summaryPredatesMeeting()` compares `generated_at`
   against `meeting_date`; any summary still failing that after the upgrade pass
   raises the alarm and appears as `stale_summaries` on the run response.
4. **Admin edits are never overwritten.** The review UI lets an admin rewrite
   blocks before approving; minutes arrive 15–30 days later, so a wholesale
   re-summarization would discard that work silently, weeks after the fact.
   When `edit_count > 0` the upgrade attaches the newly-available minutes URL
   as a source and leaves the reviewed text alone.

**Why not simply wait for minutes?** Measured against the live collection:
recordings appear within **0–1 days**, minutes take **15–30** and arrive in
periodic batch sweeps (many rows share an update date), because minutes must be
approved at the *following* meeting before they can be published. Waiting would
put every summary 2–4 weeks behind — an archive, not a civic feed. The
transcript is also the richer source: it carries public comment, discussion and
the closed-session basis that terse formal minutes omit. So the pipeline
summarizes from the recording within a day and folds the minutes in later, in
place, when they appear.

**The pattern worth remembering:** all three failures this month were invisible
to the job's own view of itself. The source broke and discovery reported "0
meetings" (success). Publication state broke and the counters read zero
(success). Here a summary described the wrong thing and every counter was clean
(success). Each guard added since is an *outcome* check rather than a *process*
check — did the reader get a correct, resolvable summary — and that is the
category to keep extending.

### Two-stage review: revisions (2026-08-27)

Better sources arrive late. Measured against Floyd's live collection,
**recordings appear within 0–1 days and minutes take 15–30**, in periodic batch
sweeps, because minutes must be approved at the *following* meeting before they
can be published. So a summary is written from the recording, and a better one
becomes possible weeks later.

The improved summary must still be reviewed before residents see it — but the
obvious implementation, flipping the record back to `pending`, is the one that
must never be used: an unpublished summary serves nothing, so the live page
404s for as long as the queue goes untouched. That is precisely the bug fixed
earlier this week.

**A revision is held beside the published summary instead.**

```
proc_abc  ├─ published version   ← keeps serving, untouched
          └─ pending_revision    ← awaits review
                                   accept  → swaps in, sets revised_at
                                   discard → cleared, v1 continues
```

- `stageRevision` / `acceptRevision` / `discardRevision` in `service.ts`.
- `POST /admin/meeting-summaries/:id/revision/accept|discard`.
- The upgrade pass stages a revision when the summary is **published**; a
  summary still in review is replaced directly, since there is no public
  version to protect and queueing a review inside a review helps nobody.
- A revision already waiting is not regenerated — that would swap one
  unreviewed candidate for another and burn the per-run budget.
- **The admin-edit guard applies only to the destructive path.** An edited
  summary *still in review* is replaced in place, with nothing to compare
  against, so regeneration is skipped and only the minutes link is attached. An
  edited summary that is *published* still gets a revision: the admin sees both
  versions and decides, so their edits are replaced only by their own choice.
  Guarding both paths would have meant an edited summary silently never
  receiving the official minutes — which was the first version of this and
  would have broken the very flow the revision system exists for.
- Accepting emits **no publication event**. The feed marks the existing card
  from `revised_at` rather than floating a month-old meeting back to the top.
  Chosen over a new card because the recording-based summary is already the
  substantively complete account; minutes add formal precision.

**Reader-facing.** The public payload carries `awaiting_minutes` and
`revised_at`. A summary with no minutes shows: *"Official minutes for this
meeting have not been published yet — they are usually approved at a later
meeting."* Without it the missing link reads as an omission rather than normal
public-body cadence. After a revision the header reads "Updated … with the
official minutes". Neither string names a jurisdiction.

**Unreviewed revisions** raise the alarm after `REVISION_NAG_DAYS` (14) and
appear as `pending_revisions_overdue`. Nothing is broken — the published
version still serves — but an improvement sitting unread would otherwise be
invisible forever.

**Generalizing.** The concept is source *authority* (`recording < agenda <
minutes`), not "minutes". A jurisdiction that publishes official transcripts
would slot in as another tier; one that never posts minutes simply never
generates a revision. No per-jurisdiction code.

### The upgrade never refreshed the recording URL (2026-08-27)

The repaired 2026-08-25 summary came back with real timestamps and
transcript-only detail — supervisor names, bill numbers, delivery dates — while
the admin page read **"Video recording: none available"** and the timestamps
were plain text rather than links.

Both were true at once. `summarizeMeeting()` reads `entry.source_video_url`, so
it fetched the transcript and produced grounded timestamps. But the upgrade
wrote back only `source_minutes_url`, `source_agenda_url` and `source_type` —
never `source_video_url`. The record kept the `null` baked in when it was
created on Aug 22, before the recording existed. The UI links a timestamp only
when the record knows its video (`MeetingSummary.tsx:168`), so every timestamp
rendered dead.

**Fixed by making "a source the record lacks" the upgrade trigger itself.**
`offersNewSources()` compares the discovered entry against the stored summary;
any source present in one and missing from the other is reason to re-summarize.
That is more honest than enumerating which document happened to arrive, and it
makes the pass self-repairing — the Aug 25 record is fixed by the next run
without intervention. Both the direct-replace path and `MeetingSummaryRevision`
now carry `source_video_url` and `additional_video_urls`.

**Admin copy corrected too.** A summary with an agenda *and* a recording was
labelled "Agenda-based summary… generated from the meeting agenda", which
undersold it: the prompt treats the transcript as the primary source in that
case and the agenda as a topic guide. It now reads "Recording-based summary"
with the auto-transcript caveat when a video exists, and keeps the agenda-only
wording when one genuinely does not.

### Guard

`cronAlertReason()` — zero discovered meetings is a **failure**, not an empty
success; the fatal path alerts too; and an operator with no
`CIVIC_ADMIN_EMAILS` gets a log line saying nobody is watching. In `auto` mode
the alert names every rung tried and what each returned.

### New: `scripts/diagnoseMeetingSummary.ts`

```bash
npx tsx --env-file=.env scripts/diagnoseMeetingSummary.ts             # dry run
npx tsx --env-file=.env scripts/diagnoseMeetingSummary.ts --summarize # + Claude
```

Reports key presence (never values), walks the connector ladder showing each
rung's result, and when everything comes up empty prints the ordered list of
things to check. Writes nothing to the database.

### Env changes

| Var | Change |
|---|---|
| `MEETING_CONNECTOR_ID` | default is now `auto` |
| `MEETING_TYPE_EXCLUDE` | **new** — use `EMS Board,EMS Meeting`; Floyd labels EMS rows both ways, and "BOS meeting with Floyd County EMS" is deliberately *not* excluded |
| `MEETING_WIX_COLLECTION` | **new**, optional — auto-discovered; set only if that fails |
| `MEETING_YOUTUBE_CHANNEL_ID` | **new** — must be the `UC…` id, not the `@handle` |
| `MEETING_TITLE_FILTER` | **new** — leave empty for `wix-cms` (the collection is already Board-specific); needed for `youtube-channel`, where one channel carries every body's recordings |

### Tests

The module had **zero** coverage before this — a large part of why its discovery
leg could return nothing for weeks unnoticed. **145 tests across eleven files**
now, each anchored to a failure that actually happened rather than to a coverage
target:

| File | Tests | Pins |
|---|---|---|
| `meetingSummaryConnector.test.ts` | 29 | YouTube feed parse, date-from-title, multi-part grouping |
| `meetingSummaryWixCms.test.ts` | 21 | Wix rows → meetings, both URL conventions, same-day meetings |
| `meetingSummaryStaleness.test.ts` | 17 | Never summarize a future meeting; upgrade on a recording |
| `meetingSummaryRevision.test.ts` | 16 | Two-stage review without taking the live page down |
| `meetingSummaryIdentity.test.ts` | 12 | Cross-connector identity — the migration hazard |
| `meetingSummaryPrompt.test.ts` | 11 | Block guidance scaled to meeting length |
| `meetingSummaryAlarm.test.ts` | 8 | Zero discovered = failure, not empty success |
| `meetingSummaryPipeline.test.ts` | 8 | Transcript-only summarization |
| `meetingSummarySlots.test.ts` | 8 | Per-meeting slot dedupe |
| `feedHealth.test.ts` | 8 | Published card ⇒ page resolves |
| `feedPublicationDedupe.test.ts` | 7 | One card per published process |

**Suite: 428 passing across 28 files in `tests/unit`** — which is all CI runs.
With a dev server on `:3000` the full suite is **490 across 35 files**.

*Caveat worth knowing:* the first full run immediately after starting the server
failed 2 API tests, and the same run passed on retry. It is a warm-up race
(cold start plus auto-seed), not a real failure — give the server a moment, or
re-run once, before believing a red API result.

Per-flow coverage, including the gaps, is tracked in `TESTING.md` →
"Meeting Summary Flows".

**Note on what tests can and cannot cover here.** Every test above pins *logic*
against known inputs. **None of them could have caught any of this session's
production failures**, because no code was wrong when they broke — the county's
website changed shape, then a recording appeared after a summary was written,
then a record kept a stale null. That class is only catchable at runtime, which
is what the discovery guard, the feed health check and the staleness check are
for. Tests catch regressions before they ship; the alarms catch the world
changing underneath shipped code. Both are necessary and neither substitutes.

### Verified end to end (2026-08-21)

Two `--summarize` runs against live Floyd data, with production-shaped config:

```
wix collection "2017Agenda": 297 row(s) → 293 meeting(s) after filters
transcript fetched segments=5107
summarized in 55s / 59s — 13 and 16 blocks, source_type="agenda"
```

293 = 297 rows less the four EMS rows, correctly keeping "BOS meeting with
Floyd County EMS". Timestamps are genuinely grounded (10:09 → 15:34 → 33:16 →
… → 4:06:41), not defaulted to zero. Content is strong: named officials,
specific figures, the Virginia Code citation for the closed session, and
`action_taken` populated on exactly the blocks carrying votes.

### Quality findings from those runs, and what was changed

**Block-count guidance was causing silent content loss.** The prompt said
"Aim for 4–12 blocks per meeting" regardless of length. On a 4h24m meeting
that is 22–66 minutes per block, and the two runs lost different things:

| | Run 1 | Run 2 |
|---|---|---|
| Blocks | 13 | 16 |
| Last block | 3:12:03 | 4:06:41 |
| Closed session | captured, with vote | **omitted** |
| Final hour | **dropped** | captured |

Run 1 obeyed the range and lost the last hour including the County
Administrator's report; run 2 exceeded it, covered more, and dropped the FOIA
closed session and its certification vote instead. Fixed by
`blockCountGuidance()`, which scales the target to the recording's actual
length (roughly one block per 8–20 minutes, floored at 4–8 and capped at
20–40), plus two explicit instructions: cover through to adjournment, and
never omit a closed session. Duration comes from the last transcript
timestamp; a document-only summary keeps the old fixed range.

**Auto-transcript mishearings pass through as fact.** Repeatable across both
runs: "Supervisor **Cookenboo**" for Kuchenbuch — in an `action_taken` line,
the highest-stakes field on the page. Also "**Xerxes** Society" for Xerces,
and "Alex Tuckman" / "Alex Tuchman" spelled differently between runs. This is
a *configuration* fix, not a code one: `MEETING_EXTRACTION_INSTRUCTIONS` is
currently generic and should name the supervisors, recurring department heads,
and organizations, instructing the model to prefer those spellings and to say
so when an unlisted name is unclear.

### Production incident, and what it turned out to be (2026-08-21)

The first production runs surfaced three things that all looked like duplicate
summaries. Only one was:

1. **Jun 23 Regular Meeting appeared twice in the feed** — one process, two
   `result_published` events, caused by the unpublish bug above. Fixed in code.
2. **Jun 23 Budget Workshop and Jun 9 Regular Meeting 404'd** — same bug; both
   had been unpublished by the upgrade pass and needed re-approval to restore.
3. **Jun 9 Regular Meeting appeared twice** — and this one was **not** a dedupe
   failure. The event log settles it: `proc_5d4dd147…` was created 2026-07-15
   and sat unapproved for five weeks; `proc_d6609dea…` was the June record.
   Today's runs created neither. The stale one was approved by mistake during
   cleanup and then archived.

Worth recording because the instinct in the moment was to blame the new dedupe
code, and the data said otherwise. **When triaging an apparent duplicate, read
the `created` events first** — `GET /feed` carries them, and process creation
timestamps distinguish "the pipeline made this today" from "this has been here
for weeks".

Operational lesson for the review queue: the **Generated** date separates the
two cases, with one exception — the upgrade pass resets `generated_at` to now.
So "Generated today" means new *or* freshly upgraded (approve), and an older
date means a leftover (check whether that meeting already has a published
summary before approving).

### Admin surface changes (2026-08-21)

- List rows now read `Board of Supervisors Regular Meeting — Jun 23, 2026`,
  matching the feed card. Every BoS row has an identical title, so the meeting
  date was the only distinguishing field and it was buried in the grey meta
  line. Removed the now-duplicate `Meeting <date>` from that line.
- Dropped the **Approved** filter tab. `approveMeetingSummary()` walks
  pending → approved → published inside one call, so `"approved"` is a
  transient in-memory step that is never persisted — the tab could only ever
  be empty. The status stays in the model; the lifecycle and its events
  distinguish outcome-recorded (Phase 5) from publication (Phase 6).
- New badges: "Transcript-only" for `source_type: "recording"`, and a
  recording-based review banner warning about auto-transcript mishearings.

### Not verified / open
- **The feed health check is deployed but has not run in production yet.** It
  executes at the end of each meeting-summary cron, so its first real exercise
  is the next scheduled run. Its logic is unit-tested and the equivalent check
  run externally reports all cards resolving.
- **The YouTube feed returns only ~15 videos.** Backfill needs the YouTube
  Data API (`YOUTUBE_API_KEY`, already documented).
- **Backfill in progress.** With `MEETING_SUMMARY_CUTOFF_DATE=2026-06-01`, the
  cron works backward at 3/run until every meeting since June has a summary,
  then goes quiet. Expect a few more review-queue items before it settles.
- **Plugin-as-a-service gaps** (connector registry in the host controller,
  env-var config, hard-coded jurisdiction) are written up in
  `decisions/audit-2026-07-02-ecosystem-architecture.md` §7.4 and
  `civic-social-docs/ecosystem/assisted-creation-and-hosting.md` §6. Not done
  here.

---

## AS2 wire conversion — Civic Activity Spec v0.2 compliance — 2026-08-20

The hub's public wire format is now **ActivityStreams 2.0** conforming to the
[Civic Activity Specification v0.2](../civic-social-docs/specs/civic-activity-spec.md).
The v0.1 envelope (`event_type` / `data` / `meta.visibility`, the
`{ events, count }` feed) is **retired with no compatibility window** — the hub
is pre-launch and has no external consumers.

**Strategy: serialize at the edge.** The internal `CivicEvent`, the append-only
Postgres log, `emitEvent()`, every module `events.ts`, `shared/feedActivity.ts`
and the digest are unchanged in shape. A new serializer projects internal
events onto AS2 documents at the boundary, on read. No migration, no schema
change. Future work (activity signing, ActivityPub delivery, portability
export, an AT Protocol bridge) attaches to that seam.

### What changed

| Area | Change |
|---|---|
| `src/events/activitySerializer.ts` (new) | `toActivity(event)` → a conformant AS2 document; `validateForEmission(event)` adds the emitter-side checks; the `event_type → activity` mapping table lives here and **throws** on an unmapped type. |
| `src/events/eventEmitter.ts` | Serializes every event *before* `appendEvent()`. An event that cannot be represented on the wire is never stored (spec §7.2). The wire form is discarded. |
| `src/events/eventStore.ts` | Added `getEventPage()` (keyset pagination on `created_at,id`), `getEventById()`, `countEvents()`. Row mapping, schema and append-only trigger untouched. |
| `GET /events` | AS2 `OrderedCollection`; `?page=true` / `?cursor=` → `OrderedCollectionPage` with `orderedItems`, `partOf`, `next`. Filters: `context` (process IRI **or** bare id), `type` (AS2 activity type, or an internal event type), `since`, `limit` (default 50, max 200, clamped). `Content-Type: application/activity+json`. |
| `GET /activities/:id` (new) | Dereferences the `id` each activity carries. 404 for unknown **and** for restricted-to-non-admin — indistinguishable, per §5.2. |
| `GET /api/feed` (new) | The old `{ events, count }` handler, moved verbatim to `controllers/feedController.ts`. The hub UI's internal read model, not a spec surface. Mounted at both `/feed` and `/api/feed` because Vercel strips the `/api` prefix before Express sees it. |
| `ui/src/services/api.ts` | `getEvents()` now reads `/feed`. No other UI change — payload shape is identical, so the feed, its filters and the digest are untouched. |
| `src/config/hub.ts` | Added `spaceDid()` (`CIVIC_SPACE_DID`, defaults to a `did:web:` derived from the BASE_URL host), `hubName()`, `civicPlaceCode()` / `civicPlaceName()` / `normalizePlaceCode()`. |
| `discoveryController.ts` | Space-spec manifest: `{ name, space: { id, scope, type }, jurisdictions?, feeds[], processes[], spec: { activity: "civic-activity-spec-v0.2" } }`. |
| `.env.example` | Documents `CIVIC_SPACE_DID`, `CIVIC_JURISDICTION` (civic place-code format) and `CIVIC_JURISDICTION_NAME`. |

### Visibility, unchanged in behavior

`public` → `to: ["…#Public"]`; `restricted` → `to: ["{base}/audiences/admins"]`
(an opaque, space-managed audience IRI; it does not dereference yet). Admins
still see restricted activities, nobody else does, archived/pending-review
processes are still suppressed from the feed, and an unauthorized caller gets a
valid **empty page** rather than an error. `totalItems` is counted with the
caller's own filters applied, so it cannot signal that withheld activities
exist.

### Hub extension terms (promotion candidates)

Hub-local families with no canonical civic home use `hub:`-prefixed terms in
the namespace `{baseUrl}/ns#`, declared as a third `@context` entry **only on
documents that use one**. The register lives beside the mapping table as
`EXTENSION_TERMS` in `activitySerializer.ts`.

| Term | Kind | Used by | Why it has no canonical home yet |
|---|---|---|---|
| `hub:payload` | property | every activity whose event carries `data` | Verbatim carry of the internal event payload, so the wire loses nothing the v0.1 `data` field held and no hub field is silently reinterpreted as an AS2 one. |
| `hub:ProposedProcess` | object type | `civic.process.proposed` (`Offer`) | A process offered for community support before it opens. |
| `hub:SupportThreshold` | object type | `civic.process.threshold_met` (`Announce`) | The support threshold of a proposed process being reached. |
| `hub:Aggregation` | object type | `civic.process.aggregation_completed` (`Create`) | Raw participation aggregated into structured results — the step before publication. |
| `hub:Submission` | object type | `civic.process.submission_received` (`Create`) | Free-text participation with no ballot/comment shape (word clouds). |
| `hub:Project` | object type | `civic.project.created` / `.updated` | A community project page — a candidate civic process class. |
| `hub:ProjectSentiment` | object type | `civic.project.sentiment_changed` (`Update`) | Aggregate support/oppose sentiment on a project. |
| `hub:ReviewSubmission` | object type | the six `civic.review.*` types | Space-internal review correspondence; always restricted. |

Canonical assignments follow spec §3.2 (created → `Create` + `civic:Process`,
started → `civic:Start`, ended/closed/archived → `civic:End` +
`civic:terminalState`, result published → `Announce` + `civic:Result`, ballot →
`Create` + `civic:Ballot`, comment → `Create` + `Note`, proposal → `Create` +
`civic:Proposal`, outcome → `Create`/`Announce` + `civic:Outcome`). Proposal
support/endorsement uses AS2's own `Like`; review decisions use `Accept`,
`Reject`, `TentativeReject`, `Update`, `Undo`.

### Ballot secrecy on the wire

`civic.process.vote_submitted` carries no ballot content internally, so the
serialized `civic:Ballot` object carries none either — `civic:method` only when
the payload has it, and **never** a selection. A golden test asserts the
document contains no selection or choice. Spec §5.4.

### Dead code / oddities found while enumerating event types

- **`civic.outcome_delivered`** — no longer emitted (the Polis close path
  stopped auto-delivering outcomes when the universal `civic.brief` review seam
  landed), but present in stored history and still handled by the feed
  classifier. Mapped (`Announce` + `civic:Outcome` + `target`) and listed as a
  retired type in the serializer's totality test: stored events must stay
  serializable forever.
- **`emitProposalEndorsed`** (`civic.proposal.endorsed`) — exported by
  `civic.proposals/events.ts`, called by nothing. Mapped anyway so the path is
  safe if it is ever wired up.
- **Bare `"system"` actor** — `spawnBriefFromClosedProcess` defaulted to a
  generic `"system"` actor, which spec §2.2.1 forbids (a system actor must name
  its component). Changed to `system:brief-spawn`, and the proposal-close call
  site to `system:proposal-close`. Historical rows carrying a bare `"system"`
  serialize to `{base}/system/unspecified` rather than being misattributed to a
  participant.
- **Anonymous comments** emit `actor: "anonymous"`, which currently serializes
  to `{ui}/users/anonymous`. When disclosure policy lands (spec §5.3) this
  should become a process-scoped anonymous actor IRI.

### Dev-environment fixes made along the way

- **`GET /debug/seed` no longer half-wipes.** It cleared events *before*
  discovering that `clearProcesses()` is impossible when append-only
  `review_turns` rows exist — leaving the dev database with processes and no
  activity log, unrepairable by either the endpoint or auto-seed. The blocker
  is now checked first and nothing is deleted when the reseed cannot run.
  Clearing that state needs a one-time SQL-editor step, run against the DEV
  project on 2026-08-20:
  `TRUNCATE review_turns, process_reviews, wordcloud_submissions CASCADE;`
  The dev database is reseeded and healthy again (Green Box active, Flock
  Camera proposed, four conversations); the wire and the UI feed were
  re-verified against the restored fixture.
- **`scripts/seedDevActivities.ts` (new)** — appends one full vote lifecycle
  (created → started → 3 ballots → comment → ended → aggregation → brief) with
  a generated process id, so a dev database whose reseed is blocked can still
  be given a realistic activity log without deleting anything.
- **`tests/fixtures/helpers.ts` / `auth.test.ts`** — residency affirmation now
  sends `full_name`, which became required when voting privacy was hardened.
  Three tests had been failing since; the suite is green again (217 pass).

### Post-audit fix

A second-session audit caught a real (if cosmetic) bug in `countEvents()`:
`NOT (meta->>visibility = 'restricted')` and `NOT (process_id IN (…))` evaluate
to NULL — not true — for a NULL column, so Postgres dropped those rows from
`totalItems` while the page reads kept them (`rowToEvent` defaults a null
`meta` to public, and an event with no `process_id` always passes the
suppression filter). Both exclusions now spell the NULL branch out
(`col.is.null,col.neq.x`), verified against the dev database: the plain
`.not()` form counted 0 of 15 rows on a column that is null everywhere, the
`or()` form counted all 15. An API test now asserts the invariant directly —
`totalItems` must equal the number of items walked across every page.

### Two guards added before the reversibility window closes

Both protect decisions that get expensive once activities are signed or
delivered over ActivityPub — a delivered activity is a permanent copy on
someone else's server, so neither is retrofittable after federation.

**Ballot secrecy is now structural, not conventional.** `hub:payload` carries
the event's `data` verbatim, which made "no emitter ever puts a choice in a
ballot payload" a convention one careless change could break. Two layers now:
the EMISSION path refuses to store a ballot event whose payload names a choice
(the log is append-only, so storing it would link voter to ballot permanently —
a bigger harm than the wire), and the READ path strips selection-shaped keys
from stored rows rather than throwing, so one bad row cannot 500 `/events` for
everyone. Container keys (`vote`, `ballot`) are deliberately not flagged —
`vote: { changed: false }`, the hub's real payload, passes — and a public
options list on a non-ballot activity still passes, because the question is
public and only the answer is secret. On-the-record voting stays legitimate,
but it must arrive through disclosure policy, not by deleting the guard.

**Production refuses to boot without `CIVIC_SPACE_DID`.** It is `generator.id`
on every activity and the key consumers bind provenance to; the derived
`did:web:<BASE_URL host>` default would tie the space's identity to its
address, so a host change would silently mint a new space with no `Move`
activity to explain it. `assertSpaceIdentityConfigured()` throws at boot in
production (mirroring the CIVIC_ALLOWED_ORIGINS convention), warns in dev, and
rejects a non-DID value in any environment — a URL being the plausible mistake,
since that is exactly what `generator.url` already carries.

**Still to set:** `CIVIC_SPACE_DID` in Vercel Production (and any preview that
should have a stable identity) before the next deploy — the hub will not start
without it.

### Deploy follow-up: the spec paths needed Vercel rewrites

The first production deploy surfaced a routing gap. Activities advertise
absolute IRIs built from BASE_URL — `https://floyd.civic.social/events`,
`.../activities/{id}`, and the `first`/`next`/`partOf` links — but
`vercel.json` only routed `/api/:path*` to the function, so those paths fell
through to the SPA catch-all and returned `index.html`. Fetching
`/api/events` worked; following the collection's own `next` link did not,
and activity `id`s did not dereference — which was the entire reason for
choosing HTTP IRIs over `urn:uuid:`. `/.well-known/civic.json`, the manifest
consumers use to find the feed, had the same problem (pre-existing).

Fixed with three rewrites above the catch-all — `/events`,
`/activities/:id*`, `/.well-known/civic.json` → `/api`. Routing only, no
code change: `api/index.ts` strips a leading `/api` and nothing else, so
each path reaches Express exactly as mounted. Setting
`BASE_URL=https://floyd.civic.social/api` was the alternative and was
rejected: it would bake `/api` into every activity id permanently and make
the spec's `GET /events` path wrong.

### Verification

- `npx vitest run` — 19 files, **229 tests, all passing** (32 serializer unit
  tests, 4 config-guard tests, 20 collection/feed API tests).
- Boot guard exercised for real: a production-env import of `src/app.ts`
  without `CIVIC_SPACE_DID` refuses with the explanatory error; with a valid
  DID it boots.
- Hub UI feed checked in the browser against `/api/feed`: cards render, the
  All / Announcements / Activity filters behave as before, digest dry-run
  (`scripts/dryRunUserDigest.ts`) renders unchanged.
- `npx tsc --noEmit` clean.

### Not done (deliberately out of scope)

ActivityPub delivery (inbox/outbox/actor documents/WebFinger), HTTP signatures,
activity signing, the AT Protocol bridge, any spec change, any UI redesign.

### Open questions

- `id` is `{baseUrl}/activities/{event.id}` (dereferenceable) rather than the
  spec's RECOMMENDED `urn:uuid:`. That is deliberate — a resolvable id is worth
  more today than a UUID — but it means activity ids are tied to the serving
  host, which is exactly what `generator.id` exists to avoid. Revisit before
  signing lands.
- `context` points at the UI process page (`{uiBaseUrl}/process/:id`), which
  returns HTML, not the process descriptor the spec expects a `GET` on that IRI
  to return. A content-negotiated descriptor is the fix.
- `hub:payload` keeps the wire lossless but is a broad extension. Once
  consumers exist, the fields they actually use should be promoted to real
  civic or hub terms and the catch-all narrowed.
- **The civic context does not resolve at the IRI every activity carries.**
  `https://civic.social/ns/civic` 404s: the apex is a registrar-level domain
  forward, not a host. The document itself is published and correct at
  `https://www.civic.social/ns/civic` (repo `civic-social-site`,
  `client/public/ns/civic`, with Content-Type + CORS in `firebase.json`).
  This is NOT a functional problem — AS2 documents are consumed as plain JSON
  and consumers do not fetch the context — but it MUST be fixed before either
  activity signing (RDF canonicalization has to resolve the vocabulary) or any
  third-party validation of the Level 1 conformance claim. Fix: add
  `civic.social` as a Firebase custom domain and drop the registrar forward.
- **Activity ids are not actually permanent, and the append-only guarantee is
  not enforced.** Spec §2.2 tells consumers they MAY deduplicate on `id`, and
  §7.4 requires ids to be stable — but `deleteProcess()` deletes a process's
  events, and `cleanOrphanedEvents()` deletes events by id and is reachable
  from an **admin HTTP route** (`adminRoutes.ts`), not just a script. So an
  activity served publicly at a stable IRI can later 404. Worse, the
  database-level protection the design language leans on does not hold: the
  events table's "append-only" trigger does not block row deletes in practice
  — `/debug/seed` wiped the table in a dev session on 2026-08-20. Pre-existing
  and acceptable while there are no external consumers, but it must be settled
  before there are: either tombstones (`Delete`/`Tombstone` per AS2) or a
  soft-hide that keeps the row and withholds it under the §5.2 serving rule,
  plus a trigger that actually enforces what it claims. Flagged by the
  2026-08-20 conformance audit (Finding 6); the admin-route exposure and the
  unenforced trigger were found while verifying it.
- **`published` is ingest time, not content time, for synced material.**
  `emitEvent` accepts a `timestamp` override (floyd-news-sync backdates to a
  story's real publication time), but `eventToRow` never writes it — the
  events table stamps `created_at`, and the wire's `published` reads from
  that. Ordering stays internally consistent, so nothing is broken today, but
  a re-enabled news sync would publish ingest times. Fix when floyd-news-sync
  returns. (Audit Finding 7.)
- `civic:processType` is typed `{"@type": "@id"}` in the published context,
  but the hub emits the internal registry string (`"civic.vote"`), which a
  JSON-LD processor would read as a relative IRI. Either the hub emits
  `civic:Vote`-style terms (what spec §4 describes, and my lean) or the
  context drops the `@id` typing. Settle it during the process-spec rewrite.

---

## Batch A refinement pass (pre-tester invite) — 2026-08-10

Worked the Batch A punch-list from `Rollout Plan/Launch-Checklist.md` — the
refinement + fixes pass before inviting the trusted test cohort. All changes
below are **committed pending Adam's approval, not yet deployed**. Verified with
`tsc -b` + `vite build` (both green) and the full unit suite (120 pass, incl. 16
new wordlist tests). The `tests/api/*` integration tests require a running
server + DB and are not exercised here. **No prod schema change is required by
this batch** (the archive slice stores its metadata in the existing
`processes.state` JSONB — see below).

### Straightforward items
- **"Conversations" label unification.** Killed the remaining resident-visible
  "Deliberation(s)" strings: `DeliberationPanel` loading/error copy, the four
  `deliberationController` error strings, and the stale `hub.ts` config comment.
  Left all code-level identifiers untouched (route `/deliberations`, type
  `civic.polis_deliberation`, component/table/CSS names) — copy/label only.
- **Vote-approval email wording.** `notifyCreatorApproved` (`civic.review/email.ts`)
  now sends an "approved — now gathering support" message (with the support
  threshold) for votes that enter the `proposed` phase, instead of the
  inaccurate "now live!". Lifecycle unchanged — only the copy. Driven by a new
  `entered_support_phase` flag computed in `approveReview` (`service.ts`), which
  also replaced the ad-hoc `activation_mode` re-read.
- **welcome.md** reconciled to the current participation model (conversation /
  proposal / proposed-vote-with-threshold / project; proposals gather support
  and never auto-launch a vote).
- **Scroll-to-nav: DROPPED.** The unreliable measure-and-retry auto-scroll in
  `FeedVotesTabs` was removed in favor of a deterministic `window.scrollTo(0,0)`
  on route change — sub-pages now land at the top. (Root cause of the old
  flakiness: the banner image loads and shifts layout *after* measurement.)
- **AI assist vs AI review clarity (#3).** Kept the always-on CoC pre-check but
  made the split honest: the assist/no-assist path cards now label assist as
  *optional* writing help, with a note that every draft still gets a Code-of-
  Conduct check; the "Review draft" button + status strings are relabeled "Run
  Code of Conduct check"; the shared spinner label is now context-aware
  (`loadingLabel`, "Running Code of Conduct check" vs "Thinking"). **Bug fixed:**
  the review path used to set `assistant_helped: true`, so a "write my own"
  draft wrongly showed the "drafted with AI help" disclosure — the CoC check now
  passes `markAssisted: false` in all three draft modules.
- **Card visual polish (#4).** Shared card language across the four process
  lists (Votes, Proposals, Projects, Conversations) in `App.css`: 14px radius,
  soft resting shadow, hover lift, pill-shaped uppercase status badges, and a
  per-type accent edge drawn from design-system tokens (Votes = Civic Indigo
  `primary-600`, Proposals = Terracotta `accent-600`, Projects = success
  `success-500`, Conversations = `primary-400`). Also **fixed** two latent bugs:
  `status-proposed` / `status-gathering(-support)` badges were previously
  undefined (rendered unstyled) — now amber `warning`-ramp pills; and the
  proposal progress fill is now Terracotta, not off-palette orange. Removed the
  duplicate per-card base rules in `Projects.css` / `Deliberations.css` (the
  shared block owns them now). `.proposal-card` renders only in the Propose list
  (`ProposalCard.tsx` is orphaned; ProposalDetail uses none of the card
  classes), so there is no detail-page bleed.
- **CoC + ToS "self-contained discussion" clause (#5).** Added the "do not
  import/repost private content from other platforms; linking to authoritative
  sources is permitted" clause to the Code of Conduct ("What we may remove") and
  Terms ("What we expect from you"). Updated **all three** CoC copies (UI
  markdown, `config/hubs/floyd/`, and the hardcoded `content.ts` fallback the AI
  review reads) so it's displayed AND enforced. Bumped `CURRENT_LEGAL_VERSION`
  1.0 → 1.1 + the "Last updated" headers — **this forces every existing account
  through the re-acceptance modal on next sign-in.** ⚠️ **Legal wording is NOT
  final — flagged for Adam's legal/pro-bono review.**

### #6 Admin slice — soft-archive + feed status-filter fix
- **Data model (no migration):** archiving flips `processes.status` → `archived`
  (already in the `ProcessStatus` union + `NON_PUBLIC_STATUSES`) and stores
  `{ archived, archived_at, archived_by, reason, previous_status }` in
  `processes.state.archive`. Restore reads `previous_status` back. Mirrors the
  existing announcement `state.moderation` soft-remove pattern.
- **Service:** `archiveProcess` / `restoreProcess` / `getArchivedProcesses` /
  `getNonPublicProcessIds` in `processService.ts`. Archive/restore emit a
  restricted-visibility `civic.process.updated` with a `process_archived` /
  `process_restored` moderation action (shows in the moderation log).
- **Endpoints:** `POST /admin/processes/:id/archive` (reason required),
  `POST /admin/processes/:id/restore`, `GET /admin/archived`
  (`adminArchiveController.ts`, under `requireAdmin`).
- **Meeting-summary cleanup:** the meeting-summaries admin batch action is now
  **soft-archive, not hard-delete** (`handleBatchDeleteMeetingSummaries` calls
  `archiveProcess`; route name kept for compatibility). `deleteProcess` is now
  unused by the app (left exported).
- **Feed status-filter fix (the ghost-post bug):** `GET /events` (feed) and the
  daily digest now suppress events whose `process_id` belongs to an archived /
  pending-review process, via `getNonPublicProcessIds()`. Fixes both the feed
  and the email digest (they share the classifier). Restricted-event admin
  reads and the moderation log are untouched.
- **UI:** new **Archived** admin tab + `AdminArchived` page (list + two-step
  Restore); AdminTabs reordered by function (queues → oversight → settings) and
  its stale docstring fixed; new reusable `AdminArchiveButton` (two-step confirm
  + reason) placed on the announcement toolbar, meeting-summary detail, and the
  generic process detail — all admin-only. Moderation-log page + type learned
  the new `process_archived` / `process_restored` actions.
- **Decision:** archive-only, no hard-delete path in the UI (Adam, 2026-08-10).

### #7 Slur/profanity wordlist filter (instant-post content)
- New `src/shared/wordlist/index.ts`: a deliberately **short, egregious-slur-only**
  list (NOT general profanity), whole-word matching (Scunthorpe-safe) with light
  leetspeak + repeated-char normalization. `assertPassesWordlist(text)` throws a
  user-facing 400 with a clear reason + appeal path. Wired into the three
  instant-post paths: comments (`civic.input`), Polis statements (before
  forwarding to Polis, covers the seed/mock branch), and word-cloud words
  (`civic.wordcloud`). 16 unit tests assert slurs/leetspeak are caught and civil
  dissent + Scunthorpe words pass. **The word list is intentionally reviewable —
  Adam should review/tune the exact terms before launch.**

### #8 Light process-linking — DEFERRED (Adam, 2026-08-10). Revisit later.

### Verify before ship (Adam's smoke test, needs backend + DB)
- Archive an old BoS meeting summary → confirm it leaves the feed AND the digest
  (no ghost card), shows in the Archived tab, and restores to `published`.
- Approve a resident vote → confirm the email says "gathering support" and the
  vote lands in `proposed`, not open for ballots.
- Submit a comment / Polis statement / word-cloud word containing a slur →
  blocked with the reason; submit passionate civil dissent → passes.
- Confirm the re-acceptance modal fires once for an existing account (legal
  version bump).

---

## Launch-critical security hardening (audit §2 punch-list) — 2026-07-04

Worked down the pre-Aug-11 launch-critical list from the code audit
(`decisions/audit-2026-07-03-civic-hub-code.md` in the meta-repo). All items below
are **committed and deployed to prod** (Vercel) unless noted, each dev-verified /
prod-verified as called out. Deploys are per-commit; login-touching changes were
verified on prod by Adam (dev uses the `000000` bypass, which short-circuits the
real OTP path, so the real auth flow can only be tested on prod).

### Shipped this session
- **Ballot privacy + authz (P1 cluster)** — commit `0438e8b`. Closed all 4
  user↔ballot leak vectors (see the 2026-07-03 entry below for detail);
  `GET /process/:id` now returns the gated read-model projection (not raw state);
  `POST /process/:id/action` admin-gates lifecycle actions (activate/close/
  propose/snapshot) so a resident can't drive another process's lifecycle or
  bypass the review queue. **Verified on prod** (cast a real vote, confirmed no
  `vote_submitted` in the public `/events`, receipt anonymous, tally correct).
- **Site-wide creator names + Admin badge** — commit `3fd889d` (+ `e151d76`
  legacy-comment fix). Central `creatorDisplay.ts` resolver (batch ids →
  `{name, is_admin}`, `full_name ?? display_name ?? "Resident"`, `select("*")` +
  graceful-degrade so schema drift can't crash content). Raw `user_xxxx`
  retired from all public surfaces; `<Creator>` component + "Admin" pill.
  Project detail: `is_owner` computed server-side, replaces `?actor=`. **Verified
  on prod.**
- **CI** (#11) — `.github/workflows/ci.yml`, commits `e6b58e2` → `4dfe0bf`.
  Backend `tsc` + infra-free `tests/unit` + real UI build on every push/PR.
  Uses `npm install` (NOT `npm ci`): the dep tree has optional platform-specific
  WASM bindings (`@rolldown`/`@emnapi`) that break `npm ci`'s cross-platform
  lockfile strictness; `npm install` matches Vercel. **CI is green** (watched to
  completion). First run also caught + fixed stale vote-tally unit tests (the
  ballot refactor changed `computeTally(map)` → `computeTally(Ballot[])`).
- **Prod boot guards + terminal error handler** (#13) — commit `7b3335a`. Demo
  bypass (`CIVIC_DEMO_BYPASS_CODE`) is now **inert when `NODE_ENV=production`**
  (fail-SAFE, not refuse-to-boot, so a misconfig can't cause an outage). Added a
  last-resort Express error handler. Seed already prod-safe via host denylist.
- **OTP hardening (P1 — account takeover)** (#5) — commits `9ec8e7c` (cap +
  crypto RNG + 30s throttle) and `2ddcef5` (15-min lockout + Resend button).
  `crypto.randomInt` for codes; 5 wrong guesses → email locked 15 min (verify +
  request-code both refused with a "try again in ~N minutes" message); 30s
  resend throttle; "Resend code" button added to the verify popup.
  **Verified on prod** (login works; 15-min lockout confirmed). Migrations
  `20260703010000_otp_attempts` + `20260704000000_otp_lockout` applied dev+prod.
- **401 handling + digest cadence** (#15, #14) — commit `07576a4`. API client
  dispatches `civic:auth-expired` on 401 → AuthProvider drops to logged-out.
  Digest next-due check subtracts a 6h slack so a daily digest stops silently
  degrading to every-other-day.
- **Review-email escaping + creator-from-session** (#9) — commit `0671a82`.
  `esc()` around all user content in review-email HTML; `handleSubmitForReview`
  derives creator email/name from the session, not the request body (closed an
  email-relay / phishing vector).
- **Copy** — commit `536d3f1`. "pilot" → "pilot program" (welcome banner + About)
  per resident feedback (misread as "plot").

### Also shipped this session (was "still open") — audit §2 remainder
- **SSRF** (#10) — commit `754783e`. New `utils/ssrfGuard.ts` resolves the host
  to its real IP and rejects private/loopback/link-local/metadata ranges (v4+v6);
  fetcher runs it on the initial URL and every redirect hop. Unit-tested.
- **HUB_ID** (#16) — commit `88e53d7`. One `config/hub.ts` reads
  `CIVIC_HUB_ID`/`CIVIC_JURISDICTION` with the same defaults (no behavior change
  until the env is set). **To stamp Floyd's identity on new events, set
  CIVIC_HUB_ID + CIVIC_JURISDICTION on the prod deployment.**
- **RLS** (#8) — commit `ed38bed` (migration `20260704010000_rls_gap_tables.sql`).
  **⚠ NOT yet applied to any DB** — apply the ENABLE+FORCE statements to dev then
  prod via SQL editor (safe: service-role bypasses RLS, no client anon path).
- **Concurrency** (#7) — commit `50570f8`. Proposal close is now a conditional
  atomic claim (`.eq status 'submitted'`) — fully fixed. Vote close guards on an
  existing vote_results record (kills duplicate spawn/board-emails; tally is
  always correct from vote_records). Documented residual: vote support-threshold
  double-activation (cosmetic duplicate 'started' events) — not addressed.
- Smaller (still open): dev `/debug/seed` wipe collides with append-only `review_turns` +
  `wordcloud_submissions` FK (dev-only; unblock with
  `TRUNCATE review_turns, process_reviews, wordcloud_submissions CASCADE`);
  dev/prod schema-drift sync (dev was behind on `display_name` migration);
  announcement GET still keeps `author_id` in public JSON for the edit-form owner
  check (low concern — official posts; convert to `is_owner` like projects).

### Related planning artifacts (this multi-session effort)
- **Ecosystem architecture audit** (Step 1): `decisions/audit-2026-07-02-ecosystem-architecture.md` (meta-repo).
- **civic-social-docs consolidation** (four-spec canon Space·Process·Activity·Identity):
  PR #7 on `creatinglake/civic-social-docs`, branch `spec-consolidation-v0.2` — awaiting review.
- **Civic Hub code audit** (Step 2): `decisions/audit-2026-07-03-civic-hub-code.md` (meta-repo) — the source of the §2 punch-list above.
- Meta-repo `/specs/*` still needs deprecation-pointer stubs, and `specs/civic-activity.md` there is still untracked (`git add` it before it's lost).

---

## Identity & anonymity: ballot secrecy, required real names, opt-in anonymous comments — 2026-07-03

Full identity/anonymity pass for the Aug 11 launch. Backend `tsc` clean, UI `npm run build` (tsc -b) clean. **NOT yet committed, and the three new migrations are NOT yet applied to any database** — apply to dev first (see below).

### 1. Ballot secrecy — closed three user↔ballot leaks
- `state.votes` (per-user ballot map in `processes.state`) is GONE. `VoteProcessState` now keeps only an anonymous `total_votes` counter; ballots live solely in the `civic.receipts` tables. Tallies compute from `vote_records` (`getBallotChoicesForProcess`), the voter's own current choice resolves via `active_vote_keys` (`getActiveChoice`) and is null after close — true paper-ballot semantics.
- `civic.process.vote_submitted` events no longer carry the ballot (`data.vote = { changed }`) and are emitted `meta.visibility: "restricted"`. Previously the public `/events` feed exposed actor + choice in real time.
- `GET /process/:id/state` derives the actor from the Bearer token (`resolveCallerId`), never from `?actor=` — the old form let anyone read anyone's vote. UI `getProcessState()` no longer sends an actor param.
- `VotingMethod` gained `parseReceipt(choice)`; `computeTally` now takes `Ballot[]` instead of a user-keyed map. `ProcessHandler.getReadModel` may now return a Promise (vote handler is async; service awaits either form).
- Migration `20260703000000_ballot_secrecy.sql`: strips `votes` from existing state (sets `total_votes`), DELETEs historical `vote_submitted` events (events are UPDATE-blocked by trigger; privacy purge via delete).
- Edge case handled: a voter with `vote_participation` but no `active_vote_keys` row (pre-receipts legacy) gets "already voted" instead of being double-counted.

### 2. Required real names
- `users.full_name` (migration `20260703000100_full_name.sql`), on `User`/`AuthUser` models. Distinct from `display_name` (Board-role attribution) — both kept.
- Sign-up gate (AuthModal step 3) now collects Full name alongside residency + ToS; `POST /auth/residency` accepts/requires `full_name`; `PATCH /auth/me` accepts `full_name` (validated 2–100 chars in `normalizeFullName`).
- **Existing accounts:** no purge. `canParticipate` (UI) and `requireResident` (server, `code: "name_required"`) now require a name, so name-less accounts are re-gated: next participation attempt opens AuthModal's "Add your name" variant (name field only, no ToS re-accept). Email/account untouched.
- `creator_name` fallbacks in vote/project/proposal/deliberation draft controllers now prefer `full_name` (was leaking email prefixes).

### 3. Comments: real name by default, opt-in anonymous
- `community_inputs.is_anonymous` + `author_name` (snapshot at post time) — migration `20260703000200_comment_identity.sql`. `author_id` still stored always (moderation accountability); **redacted from all non-admin API responses** (was previously shown raw in the UI!).
- Composers (VotePanel comment box, ProposalCommentForm) show a "Post my comment anonymously" checkbox when the hub policy allows. `submitInput` API no longer takes an author param (server uses the session).
- CommunityInputPanel renders `author_name` / "Anonymous" / "Resident" (legacy rows); admins additionally see the author id on anonymous comments.
- `comment_added` events: `actor: "anonymous"` for anonymous comments (public event log must not leak the id); `data.comment` carries `author_name`/`is_anonymous`.

### 4. Admin identity setting (stretch goal — shipped)
- `hub_settings.comment_identity_mode`: `real_name` | `anonymous_optional` (default) | `anonymous_only`. Getter/setter in hubSettings.ts; enforced server-side in `handleSubmitInput` (overrides client flag both directions).
- Admin → Settings gains an "Identity & anonymity" section (dropdown + save). Votes/process-creation described there as fixed (structural, not settings).
- Public `GET /process/input/identity-mode` lets composers render the right toggle; UI hook `useCommentIdentityMode` (fails safe to default; server re-enforces anyway).

### To deploy (in order)
1. Apply the three migrations to **dev** Supabase (`urfmvqhzmamigssqwsya`), verify, then prod (`nfhyypwoporfggqcerli`): `20260703000000_ballot_secrecy.sql`, `20260703000100_full_name.sql`, `20260703000200_comment_identity.sql`. Until applied: comment posting and name-saving will 500 (missing columns); votes/tallies still work.
2. Deploy code. Order doesn't matter much (old code + new columns is safe; new code + old columns breaks the two paths above), so migrate first.

### 5. Audit fast-follows (same session)
- `GET /process/:id` no longer serves the raw DB record (it exposed unpublished vote_results admin_notes + delivered_to recipient emails, moderation reasons, the identified supporters map, and pending_review/draft content). It now returns the same read-model projection as `/state`, inheriting the `isPubliclyFetchable` 404 gate. No UI caller used the raw form.
- `POST /process/:id/action`: lifecycle-control actions (`process.activate`, `.close`, `.propose`, `.snapshot`) are now admin-only (`ADMIN_ONLY_ACTIONS` in processController) — previously any resident could close/activate any process or propose their own pending_review vote past review. Participation actions (`process.vote`, `.support`, `.unsupport`, `.submit`, `proposal.support`) stay resident-level. Actions on non-public-status processes 404 for non-admins (no id-existence leak). Auto-close (`system:auto-close`) and threshold auto-activation are internal dispatch/module paths — unaffected. Verified live: projection shape + 401 on unauth action.
- Known cosmetic quirk: votes closed BEFORE the receipts module existed recompute their tally from (empty) vote_records → zeros. Demo data only; finalized votes use the `result` snapshot and are unaffected.

### Open questions / follow-ups
- Process detail page still shows raw `created_by` user id ("Created by user_xxx") — should show the creator's real name (or nothing) now that names exist. Small UI+read-model change.
- Still open from the broader audit (cheap, non-blocking): OTP hardening, RLS on 5 tables, minimal CI, `.temp/linked-project.json` pointing at prod, HUB_ID constant, review-email escaping, SSRF.
- Settings page has no "edit my name" field yet (PATCH /auth/me full_name exists; UI not wired).
- `GET /events` still exposes user ids as `actor` on non-vote public events (comment_added named comments, proposals, endorsements). IDs are opaque but linkable across events — consider actor display-name enrichment or hashing later.
- Vote-results comment seeding (`spawnVoteResultsFromClosedVote` → `getInputsByProcess`) copies comment bodies only — unaffected by anonymity.

---

## Onboarding copy, review polish, prod legacy cleanup + digest fix — 2026-07-01/02

Continuation of the pre-test-user pass (below), plus a parallel Polis session (next entry). Shipped to prod across several pushes (latest `08ba02d`); local main == origin/main.

### Onboarding copy — reviewed screen-by-screen with Adam and shipped (commit `7720ea9`)
Worked through all 5 onboarding screens in `Onboarding-Copy.md`:
- **Intro popup body** (`VITE_HUB_INTRO_BODY`): "This is where Floyd County residents keep up with county government, raise topics that matter, help make sense of issues together, and have conversations to see where our community stands." (hub.ts default updated; Adam updated ui/.env — no Vercel override, so ui/.env covers prod).
- **Residency intro** (`VITE_HUB_RESIDENCY_INTRO`): "To participate in the Floyd Civic Hub, please confirm your residency and review the policies below."
- **Word-cloud onboarding banner** (WordCloud.tsx): "One quick thing before you dive in" + reworded body.
- Screens 2/3 (email/code), residency heading, and the combined residency+legal checkbox left as-is (checkbox flagged for the legal review).

### Intro popup centering (commit `e888396`, deployed)
The first-visit `<dialog>` lost its default centering and rendered top-left while the residency modal was centered. Positioned it explicitly (`position:fixed` + `translate(-50%,-50%)`) so the whole onboarding flow sits centered on desktop; still centered on mobile.

### Process picker centering + pilot-reminder welcome banner (commits `ed3d3f7`, `08ba02d`, deployed)
- **Process picker** (`ProcessPicker.tsx` / `.css`): same top-left `<dialog>` bug as the intro popup. Fixed to **upper-center** — `position:fixed; top:5vh; left:50%; transform:translateX(-50%)` + `max-height:90vh; overflow-y:auto`, so the taller picker keeps its header visible and scrolls on short/mobile viewports (mobile was already fine).
- **Pilot reminder → merged into the existing welcome banner** (`WelcomeBanner.tsx`), per Adam — no new UI, nothing added to onboarding. Reframed "New to the {hub.name}?" into "**Welcome — the {hub.name} is a community pilot** … use the feedback button at the top anytime to report a bug, suggest a feature, or share anything else. We're building this with you." Points at the persistent header feedback button; dismiss key bumped `v1`→`v2` so anyone who dismissed the old banner sees this once.
- **Decision (pilot feedback):** rejected random/timed pop-ups (intrusive + off-brand for a calm civic tool). Recommended surfaces = this dismissible banner + the always-on header feedback button, with an optional future **post-action contextual nudge** (after submit/vote/finish) and/or **occasional banner re-surface** if a recurring reminder is wanted. Feedback form should carry a distinct "feature suggestion" category.

### Prod legacy-tables cleanup — the child-table gap
The earlier prod clean-slate archived `processes` rows + deleted events, but the **Proposals/Projects tabs read their own `proposals`/`projects` tables directly** (decoupled from the process/event cleanup), so test content lingered there. `scripts/cleanupProdLegacyTables.ts` backed up + **deleted all 4 proposals + the skate-park project** (Adam wants everything recreated via the new flow). Skate-park copy saved to `backups/saved-project-copy-*.md` + repo `Skate-Park-Project-Copy.md`. Both tables verify empty.

### Daily-digest email layout (commit `2a72eed`, deployed)
Mobile digest was cramped: each row put the category pill in a right-aligned `nowrap` column, squeezing the title. Moved the pill to a small label **above** the title so the title spans full width (verified at 375px — a 6-line title now wraps to 2). `src/modules/civic.digest/service.ts` (`renderSectionHtml`). Per-item pills KEPT — they encode item state (new / results / closed / update), not just category, so collapsing to one section pill would mislabel mixed sections.

### Notes / open decisions this stretch
- **"Closing soon" is NOT built** (a documented stretch feature). New processes show in the feed on open + close only. Confirmed it's fully backward-compatible to add later — it keys off the deadline already stored on each process, so content loaded now is covered when it ships (best paired with the already-backlogged close cron for proactive/email delivery).
- **Admin auto-approve** (admin-created processes skip creation-review via `submitAsCreator`) — left as-is per Adam (a no-op for a solo admin/reviewer; resident submissions still go through review).
- **Vote approval email is inaccurate (flagged, not fixed):** `notifyCreatorApproved` says a vote is "now live!" but an approved vote enters the "proposed" endorsement phase, not live. On-site messaging is correct (VotePanel "Needs N more endorsements to proceed to an official vote"; Votes "Proposed Votes" section); only the email misleads. Small fix available.
- **Prod state:** feed/Activity empty · Proposals/Projects tabs empty · word cloud active+blank · BoS announcements (29) + meeting summaries (48) intact.

---

## Parallel Polis + UI-polish session (Adam) — 2026-07-01/02

Adam ran a separate session on the same repo (Polis conversation behavior + UI polish). Reconstructed from commits `3285326`..`07a6f35` — already committed, pushed, and deployed:
- **Polis participant / statement serving:** register new participants before fetching statements (`ddc8ce7`); a fallback for new participants who get no statements (`51f8763`), later reverted + replaced with debug logging (`f72e66c`); track votes locally + serve unvoted statements as fallback (`5e02934`); one statement per user per deliberation + scrollable confirmation modal (`3285326`).
- **Opinion groups:** 1-indexed group names + correct pluralization (`a1105b0`); hide opinion groups below 5 participants (`7d3c553`).
- **UI polish:** preserve line breaks in process descriptions across all views (`3b19da1`); project sources textarea 2→4 rows (`ee78b82`); drafting-form scroll fix / `min-height:0` on flex container (`1f849f4`); active-tab hover styling (`7d3c553` / `591ba80` / `07a6f35`).

*(Summarized from commit messages — Adam to correct/expand; the underlying Polis "seed statements at creation don't reach Polis" bug from the 06-27 entry may or may not be resolved by these — verify.)*

---

## Pre-test-user verification pass + prod clean-slate — 2026-06-30 (PM)

**Status:** Big verification + fix session. **COMMITTED + DEPLOYED to `main` (through commit `7720ea9`)** — Vercel auto-deploy triggered 2026-07-01; full prod build (`npm run build` frontend + backend) verified locally before push, so no silent Vercel failure. Prod **data** cleanup also ran (see below). Backend `tsc` + frontend `tsc -b`/`vite build` all clean.

### 1. Creation-review flow — VERIFIED end-to-end in the browser (was never browser-tested)
Drove it as resident + admin against dev, watching real events: submit → `pending_review` → MySubmissions → admin queue/detail → **request-changes** (note shown to creator) → **revise & resubmit** → **approve → posts LIVE** (project went `active`, in public list; creator emailed "now live") → **decline** (archived). All five tested branches emit the right events. Withdraw not click-verified (button observed; unit-tested in `review-transitions.test.ts`).

### 2. BLOCKER found + fixed — AI pre-check was a silent single-point-of-failure
Every resident submission (project/vote/proposal) was hard-gated behind an AI "Review draft" Code-of-Conduct check. On failure (no key / timeout / quota) the old code **500'd into a hidden chat panel** → Submit disabled forever, no visible error → resident silently trapped.
**Fix (Adam chose fail-open):** the 3 review handlers now degrade gracefully — on any review-service error they save a clean empty result, let the submission through to human admin review (the real gate per Decision #7), and return `review_unavailable: true`. The 3 draft pages surface a visible `form-hint` notice ("The automated check couldn't run just now… your submission will go straight to human review"). Verified in-browser (dev has no `ANTHROPIC_API_KEY`, so this path is exercised every time). Files: `src/modules/civic.proposal_assistant/index.ts` (shared `AUTOMATED_REVIEW_UNAVAILABLE_NOTICE`), `src/controllers/{project,vote,proposal}DraftController.ts`, `ui/src/services/api.ts`, `ui/src/pages/{ProjectDraft,ProposeDraft,ProposeDraftVote}.tsx`.

### 3. PROD clean-slate (Adam-directed) — DONE
Selective, type-scoped (announcements + meeting summaries are ALSO `processes` — a blanket wipe would destroy them). Scripts: `scripts/exportProdProcesses.ts` (read-only backup), `scripts/cleanupProdProcesses.ts` (dry-run by default, `--apply` to write; self-backs-up first).
- **Archived 16 test processes** (4 conversations, 5 proposals, 5 votes, 2 vote_results) → hidden from public + admin queue.
- **Deleted 92 test events** (302→210) — archiving alone does NOT clean the feed (the feed renders raw events without status-filtering; see Open issue below), so the events were removed to clear them.
- **Word cloud "What do you love about Floyd?" kept ACTIVE, 33 submissions deleted** → starts blank for testers.
- **Preserved untouched:** 29 announcements + 48 meeting summaries.
- Backups in `backups/` (`prod-processes-*.json/.md`, `cleanup-backup-PROD-*.json`) — everything recoverable.

### 4. Conversation auto-start on approval — DONE (code), PROD-VERIFY PENDING
`approveReview()` now auto-starts approved conversations: best-effort `executeAction("start")` creates the Polis room (passing `state.seed_statements` through `createDeliberation`, which should also fix the seed-statements-not-reaching-Polis bug) and goes `active`. On failure (dev has no `POLIS_AUTH_TOKEN`, or transient Polis outage) it logs and LEAVES the conversation in `draft` — never rolls back the approval. **Note:** the public "Start" button was removed earlier, so auto-start is now the primary path; if it fails in prod the admin recovery is the still-existing `POST /:id/start` endpoint (no UI button). File: `src/modules/civic.review/service.ts`.

### 5. Word-cloud teaser — DONE + verified
New `ui/src/components/WordcloudTeaser.tsx` (+ `.css`): slim on-brand bar under the nav — "✦ Community word cloud · *[rotating word]* →" linking to the cloud, with a "be the first to add a word" invite when blank. Verified desktop + mobile (rotates real words, links, no overflow). Reads `hub.onboarding_wordcloud_id`; hides if unset. Rendered after `<Nav/>` in `App.tsx` (both shells).

### 6. Onboarding word-cloud step — enabled via config
The post-signup redirect to `/wordcloud/:id?onboarding=1` was already built but disabled (empty `VITE_HUB_ONBOARDING_WORDCLOUD_ID`). Adam set it in Vercel (prod + dev). Locally injected via `.claude/launch.json` (dev id `proc-wordcloud-test`) since `.env` writes are blocked — consider moving to `ui/.env`. **Prod needs a redeploy** (build-time Vite var). Dev id = `proc-wordcloud-test`, prod id = `proc_wordcloud_floyd_001`.

### 7. Onboarding copy review — DELIVERED, awaiting Adam's calls
- First-visit popup (`VITE_HUB_INTRO_BODY`) undersells — proposed a stronger version (env change, Adam to set).
- `welcome.md` describes the OLD proposal→threshold→vote mechanic (pre the proposal/proposed-vote split) — offered to reconcile; awaiting yes/no.
- Residency + legal in one checkbox — flagged for the pro-bono legal review.

### Findings / env notes
- **Email:** prod Resend works (Adam gets feedback at adam@civic.social). DEV Resend key is **test-mode** — only mails creatinglake@gmail.com (verified-domain restriction); not a prod problem. Feedback top-bar button: Adam confirms it's placed + works → no change.
- **`CIVIC_ADMIN_EMAILS`** already `adam@civic.social` in prod (was fine all along; only local dev `.env` showed creatinglake).
- **Session persistence on refresh:** PASS (earlier "logout" was a stale `civic_hub_token` legacy key + HMR churn, not a bug).
- Dev env gaps that limit local testing: no `ANTHROPIC_API_KEY`, no `POLIS_AUTH_TOKEN`, no `RESEND_FROM`.

### Open issues / deferred
- **`GET /debug/seed` (Workstream G)** — blocked by the SAME `review_turns` append-only trigger as the prod delete (not just the wordcloud FK). Can't be fixed via the REST clear functions; needs a trigger migration (a change to audit-log immutability) or a different reset approach. The selective cleanup script is the working alternative. Recommend post-launch.
- **Feed doesn't status-filter** — `GET /events` (and the UI feed) render events regardless of the process's current status, so an archived process can still surface (empty/fallback) feed posts. The prod cleanup worked around this by deleting events. A principled fix (feed excludes non-public-process events) is worth doing so future archives/soft-removes are clean without deleting events.
- **Auto-start prod verification** — needs a real conversation approved in prod (Polis).
- **Full smoke test** — auth/onboarding/session/picker/creation-review verified; feed/digest/vote/project/nav/error-states/admin sections still to do.

### Uncommitted files this session
`src/modules/civic.proposal_assistant/index.ts`, `src/controllers/{project,vote,proposal}DraftController.ts`, `src/modules/civic.review/service.ts`, `ui/src/services/api.ts`, `ui/src/pages/{ProjectDraft,ProposeDraft,ProposeDraftVote}.tsx`, `ui/src/App.tsx`, `ui/src/components/WordcloudTeaser.tsx` + `.css`, `.claude/launch.json`, `scripts/exportProdProcesses.ts`, `scripts/cleanupProdProcesses.ts`, `backups/`.

---

## Phase 5 — Test the spine (logic-level) — 2026-06-30

**Status:** **MERGED to `main` and DEPLOYED (commit `3df3571`).** Behavior-preserving refactor + new tests. Backend `tsc --noEmit` + frontend `tsc -b` clean; `vitest run tests/unit/` = **101 passed** (+15).

Implements `decisions/audit-2026-06-25-process-and-feed-consistency.md` §5 (Phase 5), partially — see scope note.

- **Extracted `processService`'s lifecycle DECISIONS into a pure, DB-free `src/services/processLifecycle.ts`** and routed processService through them (behavior-identical): `resolveInitialStatus` (create → `stateStatus ?? "active"`), `isPubliclyFetchable` (hides `pending_review`/`archived`), `isActionable` (rejects `finalized`), `shouldEmitStatusUpdate` (emit `civic.process.updated` only on a real status change), and `NON_PUBLIC_STATUSES` + `nonPublicStatusFilter()` — the latter derives the `getAllProcesses` PostgREST `in`-list from the same constant the fetch gate uses, so the query and the gate can't drift.
- **Tests** (idiomatic — pure logic, no DB mock, matching `transitions.ts`/`methods.ts`/`deadline.ts`/`feedActivity.ts`): `tests/unit/processLifecycle.test.ts` (all five decisions + a query↔gate lockstep assertion), `rowToProcess` (now exported — field mapping + null-column defaults), and `tests/unit/voteResultsLifecycle.test.ts` (the `vote_results` publication state machine `pending → approved → published` — `canEdit`/`canApprove`/`isPublished`/`assertPublicationTransition`, previously an entirely untested core handler).

### Scope note — what's covered vs not
- **Covered:** the lifecycle *decision logic* of the process spine (the audit's headline "no tests on `processService`" gap) + the vote-results publication state machine. This is the risky logic; the DB calls are now thin wrappers around tested decisions.
- **Deliberately NOT done:** true DB-integration tests of the handler methods and processService's insert/update/query I/O. The codebase has **zero DB-mock infrastructure** (every existing test is pure logic); a hand-rolled fake Supabase client risks testing the fake, not the code. The review state machine was already well-covered (16 cases in `review-transitions.test.ts`). Building a DB-mock harness is a separate decision (fragility tradeoffs) — recommended to skip, or do post-launch if ever.
- **Important:** these are **local unit tests** of pure logic — they are NOT run by the Vercel build (which is only `tsc -b && vite build`) and there is no CI test run. Run them by hand (`npx vitest run tests/unit/`) before committing. End-to-end confidence in the *running* site comes from manual browser/dev verification + the `scripts/verify*.ts` scripts, not this suite.

### Phase 0 leftovers — already resolved (verified this session)
The two trivial code items from the audit §3 were already done by a prior pass: `GET /events?type=` now accepts `type` as an alias for `event_type` (`eventController.ts`), and the discovery manifest already emits `jurisdictions` (`discoveryController.ts`). No work needed.

---

## Polis JWT Auth + Word Cloud Seed + Draft Cleanup — 2026-06-27

**Status:** Polis real connection **WORKING** in production. Word cloud seeded. Draft deliberations removed from public page. Pushed to `main`, Vercel auto-deploying.

### Polis JWT Authentication (config-only, no code changes)
- **Problem:** `POLIS_AUTH_TOKEN` was never set; all deliberation API calls returned 401. The adapter code (`polisAdapter.ts`) was correctly shaped but the token was missing.
- **Root cause:** Polis uses a hybrid JWT auth middleware that checks tokens against 4 types in order: XID → Anonymous → Standard User → OIDC. Each type requires specific claims — a plain JWT without type markers gets "Token does not match any known JWT type" rejection.
- **Fix:** Generated a **Standard User JWT** (RS256, 10-year expiry) on the Hetzner server (5.161.68.87) inside the `polis-prod-server-1` Docker container, signed with the private key at `/app/keys/jwt-private.pem`. Required claims: `standard_user_participant: true`, `oidc_sub`, `sub: "user:..."`, `iss: "https://polis.civic.social/"`, `aud: "participants"`, `uid: 1`.
- **Env var:** `POLIS_AUTH_TOKEN` set in Vercel production env vars. `POLIS_BASE_URL` defaults to `https://polis.civic.social` in code (`src/processes/deliberationBoot.ts:25`).
- **Token rotation:** Token expires ~2036. Set a calendar reminder for annual rotation as good practice. To regenerate: SSH into Hetzner box, run the JWT generation script inside the container, update Vercel env var.

### Verified working
- Creating real Polis conversations from floyd.civic.social
- Submitting statements/comments after conversation starts
- Agree/Disagree/Pass voting on statements
- Existing seed conversations (Flock Camera `proc_delib_flock_001`) still work via mock layer

### Known bugs (not fixed this session)
- **Seed statements not appearing:** Initial seed statements entered during conversation creation don't reach Polis. Comments submitted *after* starting the conversation work fine. Likely a bug in the handler's "start" action — seed statement submission may happen before the Polis conversation ID is available.
- **Other test data in production:** Several test proposals/votes exist (`proc_e1234c800c2c41dc`, `proc_add2a6156c3641fe`, `proc_25501c89bc994888`, `proc_f9f91616c9cf4cd9`, `proc_f8c72d30763041e8`). Can't delete due to `review_turns` append-only trigger. Could close them like the test conversations.

### Draft section removed from Deliberations page
- Removed the "Draft" section, "Start Conversation" button, `handleStart()`, `startDeliberation` import, and `startingId` state from `ui/src/pages/Deliberations.tsx`.
- Conversations should go through the admin review/approval flow (via ProcessPicker → `/deliberations/new`) like all other process types, not be started from a public-facing button.
- Three test conversations (`proc_dd4ffa81bae14031`, `proc_42dc361615664443`, `proc_7e467a64d5044d1b`) closed in production DB.

### Word cloud production seed
- Created `scripts/seedProdWordcloud.ts` — seeds "What do you love about Floyd?" word cloud (`proc_wordcloud_floyd_001`) with 30 submissions.
- **Key detail:** Word cloud module stores `status` inside the `state` JSONB field (not just the process-level `status` column). Both must be `"active"` for the frontend submission form to appear. Initial seed was missing `state.status`, which hid the form.
- Supports `--remove` flag for cleanup.

### Production demo data inventory (all process types)
- **Proposals:** Community Farm Stand, Jacksonville Trail Extension
- **Projects:** Floyd County Community Skate Park (with banner image)
- **Conversations:** Flock Camera (seed/mock data)
- **Word cloud:** "What do you love about Floyd?" (30 real submissions)
- **Seed scripts:** `seedProdDemo.ts`, `seedProdConversation.ts`, `seedProdWordcloud.ts`

---

## Phase 3 — Shared feed-worthiness classifier (feed ↔ digest parity) — 2026-06-26

**Status:** **MERGED to `main` and DEPLOYED to production (2026-06-26).** Verified on dev, then shipped. `tsc -b` (frontend) + `tsc --noEmit` (backend) clean; `vitest run tests/unit/` = **86 passed** (+31 new); `vite build` clean. **No DB migration needed** (adds an optional `data.process.type` field to emitted event payloads; events are append-only JSONB).

**Deploy note (2026-06-26):** The first push failed the Vercel build on a **pre-existing Phase 2 bug** — `ProposalDetail.tsx` compares `proposal.status === "closed"` but `"closed"` was never added to the frontend `CivicProposalStatus` union (Phase 2 added it backend-only). It went unnoticed because the frontend was being "verified" with `cd ui && npx tsc --noEmit`, which **type-checks nothing** here (`ui/tsconfig.json` is `files:[]` + project references; only `tsc -b` checks the app — now recorded in `memory/project_ui_typecheck_command.md`). Because this bug entered in Phase 2, **every Vercel build since Phase 2 had been failing** — so Phase 2 had never actually deployed despite being on `main`. The fix (commit `552cab3`, add `"closed"` to `CivicProposalStatus`) unblocked the build, and **Phase 2 + Phase 3 went live together**. Two follow-up commits also shipped the same day: `de98d5b` (meeting-summary card pill prefixed with `governing_body_short` so it matches the feed filter pill — the classifier label stays the canonical "Meeting summary" that the email digest uses) and `80282b0` (`engines.node` 20.x → 24.x to clear Vercel's Node-20 deprecation). All builds green; no regressions observed on prod.

Implements `decisions/audit-2026-06-25-process-and-feed-consistency.md` §2 (Phase 3). Collapses the **four** drifting copies of the "what's feed-worthy" decision into ONE shared classifier.

**Commits (all on `main`, deployed):** `5e0246f` (Part A — classifier + `data.process.type` on emitters), `142b802` (Part B/C — route feed/filter/digest through it + closed cards), `552cab3` (prod-build fix: add `"closed"` to `CivicProposalStatus`), `de98d5b` (meeting-summary card pill prefix), `80282b0` (`engines.node` → 24.x). Handoff entries: `8b0198c` (this section) + `050e8cf` (the 2026-06-27 Polis section above). The 2026-06-27 Polis JWT/word-cloud/draft-cleanup work is in commit `d26d587`.

### Part A — the shared classifier + one discriminator field
- **New `src/shared/feedActivity.ts`** — `classifyActivity(event) → { surface, kind, pill, href } | null`, the single source of truth, zero-dependency and framework-agnostic so BOTH runtimes import it (Vite frontend by relative path `../../../src/shared/feedActivity`; Node backend via `src/**/*`). It's an explicit **allowlist (default-closed)**: only named event types produce a card; everything else returns null. This is the seam for future admin-configurable feed-worthiness ([[project_feed_classifier]]).
- **`data.process.type` discriminator (owner chose "all" — full uniformity).** `emitEvent` gained an optional `processType` that it stamps into `data.process.type` (merge-safe, never clobbers an existing type). Added `processType` to **every** `civic.process.*` / `civic.proposal.*` / `civic.project.*` emitter (vote, vote_results, announcement, meeting_summary, wordcloud, proposals, projects, processService generic `updated`, + Polis normalized via the deliberationBoot host adapter from its flat `process_type`). The classifier reads `data.process.type` first, falling back to the legacy data-shape ladders for historical events. **Key property:** the field is purely a discriminator — adding it to non-feed-worthy events (comment_added, vote_submitted, moderation, …) does NOT surface them (the allowlist decides). Verified live: every emitted event now carries `data.process.type`. (Exception: `civic.input` comment/moderation events omit it — the cross-cutting input module doesn't know the host process type locally and these are never feed-worthy.)

### Part B — route all four consumers through the classifier
- **Feed gate** (`Feed.tsx`): `renderableEvents = events.filter(e => classifyActivity(e) !== null)`. Removed the old `kindFromEvent`/`ProcessKind`/`EXCLUDED_TYPES` Set.
- **Feed metadata loop** (`Feed.tsx`): keys on `activity.kind`; **added the missing project branch** (`getProjectDetail`) — fixes the 404 where project cards fell through to `getAnnouncement(id)`.
- **Feed renderer** (`FeedPost.tsx`): `eventToPost` now calls `classifyActivity`, reads `.pill/.kind/.href`, and only derives title/summary (which need fetched metadata). No more data-shape `switch`; **no bland "Activity" fallthrough** for known types. `FeedPillKind = ActivityKind` (one vocabulary). Dropped the duplicated `abbreviateGovernment` (now in the classifier).
- **Filter predicate** (`FeedFilter.tsx`): `buildFilterPredicate(key) = e => classifyActivity(e)?.surface === key` — was a *fourth* hand-maintained ladder and the cause of the observed "filter shows fewer items than All" bug (created/outcome/proposal events passed the gate but failed the filter). Fixed.
- **Digest** (`civic.digest/filter.ts` + `service.ts` + `models.ts`): `isDigestRenderable`/`classifyItemKind` delegate to the classifier; `DigestItemKind = ActivityKind`. Email groups kinds into 8 sections, per-row pill colors mirror the feed palette, and relative hrefs (wordcloud/proposal/conversation) are absolutized against the hub UI base. **Digest now reaches feed parity** — proposals, projects, conversations, and word clouds reach email for the first time. Fixed the **wordcloud mislabel** (`started` → always `vote_opened` before) and the **`civic.outcome_delivered` orphan**. New CSS pill tokens added for proposal / proposal-closed / conversation / conversation-results (`Feed.css`).

### Part C — "closed" cards (owner-selected: proposal closed + conversation results)
- `civic.proposal.closed` (Phase 2's deadline-close) → **"Proposal closed"** card. `civic.outcome_delivered` (deliberation close) → **"Conversation results"** card — both in feed + digest. Vote close stays as the existing vote-results card (raw vote `result_published` kept excluded — no double-post). Project archive intentionally NOT carded (owner's choice).

### Verification (2026-06-26, dev)
- `scripts/verifyPhase3.ts` (run: `npx tsx scripts/verifyPhase3.ts`): runs the REAL classifier + digest assembler over a representative event set (current + legacy shapes) → 17 render with correct surface/kind/pill/href, 9 correctly excluded (no bland Activity), filter surfaces agree, digest spans all 8 sections (parity). Writes `/tmp/phase3-digest.html`.
- **Browser eyeball (dev Supabase):** feed renders real cards — VOTE OPEN (real description + engagement), WORD CLOUD (real "60 responses"), NEW CONVERSATION ×2, CONVERSATION RESULTS (Part C) — no runtime errors, no bland Activity. `?type=activity` → all 5; `?type=announcement` → 0 (filters agree with pills). Digest HTML eyeballed: all 8 sections + correct pills.
- 31 new unit tests: `tests/unit/feedActivity.test.ts` (classifier) + `tests/unit/digest-parity.test.ts`.

### Incomplete / follow-ups
- **Dev data was disrupted during verification.** `GET /debug/seed` is **broken**: its process-wipe fails on a FK from `wordcloud_submissions` (it deletes `processes` before child tables). This left the event store empty mid-verify; I restored a working feed by additively emitting 5 events for the 7 surviving processes. **Follow-up:** fix the seed reset to delete child tables (wordcloud_submissions, etc.) before `processes`. Dev currently has 7 processes + 5 synthetic feed events (not the full original fixture).
- **Meeting-summary card pill** — RESOLVED (`de98d5b`): the feed card pill is prefixed with `governing_body_short` ("BoS meeting summary") to match the feed filter pill ("BoS meeting summaries"). The classifier's label stays the canonical hub-agnostic "Meeting summary", which the email digest uses — so feed card + feed filter agree, while the digest reads "Meeting summary" (a separate surface; pre-existing, owner OK with it).
- **Frontend verification MUST use `tsc -b`** (or `npm run build`), not `npx tsc --noEmit` — the latter checks nothing in `ui/`. See `memory/project_ui_typecheck_command.md`. The backend `npx tsc --noEmit` at the repo root IS valid.
- **`data.process.type` not on `civic.input` events** (comment_added + 2 moderation) — deliberate (host type not known at that layer; never feed-worthy). Add by threading the host type if full uniformity is wanted later.
- Deferred per scope: event-type renaming to `civic.<type>.<verb>` + the full 38-site sweep of `data.process.type` into the rename = Phase 4; spec rewrites = Phase 4; admin-configurable classifier = future; Polis rework = separate track (not touched; seed-conversation browsing not regressed).

---

## Phase 2 — One deadline-close + lifecycle alignment — 2026-06-26

**Status:** **MERGED to `main` and DEPLOYED to production (2026-06-26)** — but note it did NOT actually reach prod until the Phase 3 session: Phase 2 introduced a frontend type error (`ProposalDetail.tsx` `=== "closed"` without `"closed"` in `CivicProposalStatus`) that silently failed every Vercel build from Phase 2 onward. Fixed in commit `552cab3`, after which Phase 2 + Phase 3 deployed together. `tsc` (backend + frontend) clean; `vitest run tests/unit/` = 55 passed (+7 new). **No DB migration needed** (all `status` columns are plain `TEXT`, no CHECK constraints; `"closed"` is a new value only).

Implements `decisions/audit-2026-06-25-process-and-feed-consistency.md` §5 (Phase 2), addressing findings P3, P4, P7 + the dual-status note.

### Part A — one lazy, type-agnostic deadline-close
- **New optional `ProcessHandler.closeIfExpired(process)`** (`src/processes/types.ts`). Each handler owns its own deadline source, open-check, persistence, and lifecycle event — so process logic stays in the registry, not the service layer (CLAUDE.md constraint #1). `processService.autoCloseIfExpired` is now generic: it just calls `handler.closeIfExpired?.()` from the read paths (`listProcessSummaries` / `getProcessState`), best-effort (a failure is logged and the original process returned). Replaced the old vote-only implementation.
- **Action-dispatcher injection** (`registry.setActionDispatcher`, mirrors `setProcessFactory`; wired in `processService` to `executeAction`). Lets vote/deliberation `closeIfExpired` dispatch their own persisted close action without importing `processService` (circular dep).
- **Vote** (`voteProcess.ts`): `closeIfExpired` dispatches `process.close` when `state.status==="active"` and `voting_closes_at` has elapsed — same full close flow (tally, vote-results spawn, events) as before, just moved into the handler.
- **Proposal** (P3 fixed): new `closeExpiredProposal()` (`modules/civic.proposals/index.ts`) flips the child `proposals` row **and** the canonical `processes` row to `"closed"` and emits **`civic.proposal.closed`** (new helper in `events.ts`). Wired via `proposalAdapter.closeIfExpired`. Proposals previously wrote `closes_at` on approval but nothing ever acted on it.
- **Deliberation** (P4 fixed): `closeIfExpired` attached in `deliberationBoot.ts` dispatches the shared handler's `close` action when `state.deadline` has elapsed. **The Polis `closeDeliberation` call is now guarded** (`shared/polis_deliberation/handler.ts`): a 401/unreachable Polis is caught and logged so it can't wedge the local lifecycle transition. (Polis itself is still broken — separate track; see `memory/project_polis_status.md`. NOT verified live to avoid an external Polis call; verified by construction — same dispatch path as votes.)
- **Guarded date parsing** (audit §4): new `src/utils/deadline.ts` `isPastDeadline()` — `Date.parse` + `Number.isFinite`, so a malformed/empty deadline fails safe (`false` = don't close) instead of a silent NaN no-op. Used by vote, deliberation, and proposal close. Unit-tested (`tests/unit/deadline.test.ts`).

### Part B — terminal-vocabulary + dual-status alignment
- **`ProposalStatus`** (`modules/civic.proposals/models.ts`): added canonical `"closed"`; documented the mapping (`submitted`↔canonical `active`, `closed`, `archived`); marked legacy `endorsed`/`converted` inert (kept so old rows still type-check).
- **Single source of truth = the canonical `processes` row.** Terminal transitions now keep the child row and the `processes` row in lockstep: `archiveProposal` and `archiveProject` now **also flip the `processes` row to `"archived"`** (previously child-only → archived proposals/projects still leaked into `getAllProcesses`, which filters on the `processes`-row status). `closeExpiredProposal` writes both.
- **`getProcessState` is now lifecycle-gated**: `pending_review` and `archived` processes return `undefined` (404) — not addressable by direct id. This also hides the pending-review internal-status mismatch from this read path. Vote `proposed`/`threshold_met` and conversation `draft` remain fetchable (the UI needs them).
- **Frontend**: `ProposalDetail.tsx` (the live `/proposal/:id` page) now renders the new `"closed"` terminal status (badge + "discussion period has ended" notice; "Open until"→"Closed"; support/comment-form already gated to `submitted`). `.status-closed` CSS already existed.

### Verification (2026-06-26, dev Supabase)
`scripts/verifyPhase2Close.ts` (run: `node --env-file=.env --import tsx scripts/verifyPhase2Close.ts`) — 12/12 checks pass, throwaway rows cleaned: vote auto-closes on read + emits `civic.process.ended` + persists `closed`; malformed `voting_closes_at` (JSONB) keeps the vote `active` (guard works); proposal auto-closes on read + child & process rows `closed` + emits `civic.proposal.closed`; no-deadline proposal stays open; `pending_review` and `archived` not fetchable by id. (Deliberation close not exercised live — external Polis call.)

### Incomplete / follow-ups
- **Deliberation close not live-verified** — gated on a healthy Polis instance (separate track). The lifecycle/status transition + event + guard are in place; verify end-to-end once Polis is fixed.
- **Legacy `/process/:id` proposal path** (`ui/src/pages/Process.tsx` `isProposal` branch + `ProposalCard`/`ProposalPanel`) still treats `status==="closed"` as "promoted to vote" — conversion-era dead UI (proposals route to `/proposal/:id` now; that path also renders `NaN` endorsements via the thin adapter). Left untouched this phase; clean up with the Phase 3 feed/UI work or a dedicated frontend pass.
- **Open-state vocabulary mismatch remains by design**: a live proposal is `submitted` on its child row but `active` on the canonical row. Documented mapping rather than a rename; `/proposals` routes still speak the child vocabulary, the unified read layer speaks canonical.
- **Lazy-close only fires on the unified read paths** (`listProcessSummaries`/`getProcessState`), matching the vote pattern. The dedicated `/proposals` list/detail routes don't trigger it themselves — fine in practice (any home/feed load closes elapsed proposals), but a direct `/proposals/:id` hit on a just-elapsed proposal could show it open until the next unified read. Centralizing in Phase 3 (`shared/feedActivity.ts`) is the natural fix.
- Deferred per scope: feed/digest classifier centralization = Phase 3; Polis rework = separate track; event-type renaming / spec rewrites = Phase 4.

---

## Phase 1 — Process unification (Parts A/B/C) — 2026-06-25

**Status:** **MERGED to `main` and DEPLOYED to production (2026-06-26)** via PR #21. Verified on dev, then shipped. Votes, proposals, projects, the unified review→approve flow, and the proposed-vote phase all work on prod. `tsc` (backend + frontend) + 48 unit tests pass.

### Post-deploy fixes (on `main`, deployed)
- **Votes page** (`046b4e4`): stop rendering idea-board proposals in the Votes "Proposed Votes" section — they leaked in via the canonical `processes` row, rendered `NaN` endorsements (thin adapter has no support_count) and linked to `/process/:id` → blank page. Proposals show correctly on the Proposals tab. 
- **Conversations** (`f877518`): approved conversations land in `draft` (not `active`) so they surface the "Start" path instead of a dead participate panel. (Interim — the Polis rework will replace the manual Start with auto-start-on-approval.)
- **Prod proposal creation**: failed with `closes_at not in schema cache` — prod was missing the proposal-duration columns. Owner ran the idempotent `ALTER … ADD COLUMN IF NOT EXISTS closes_at / proposal_duration_ms` + `NOTIFY pgrst, 'reload schema'` on prod. Fixed.

### Prod environment notes (learned 2026-06-26)
- Prod (`nfhyypwoporfggqcerli`) has **legacy Supabase API keys disabled** — uses new `sb_secret_`/`sb_publishable_` keys. Dev (`urfmvqhzmamigssqwsya`) still uses legacy JWT.
- Prod READ access for diagnosis is set up in gitignored `civic-hub/.env.prod` (`PROD_SUPABASE_*`). Prod is treated READ-ONLY; prod schema changes are handed to the owner as SQL.
- **Conversations / Polis are NOT really working** — the integration is mock-only (real Polis never connected; bearer-vs-cookie auth mismatch; instance on Hetzner `5.161.68.87` currently unhealthy — `/createuser` blank). Owner wants this fixed for launch as a **dedicated effort** after the unification phases. Conversations are intentionally NOT hidden. See `memory/project_polis_status.md`.

### Verification (2026-06-26, dev Supabase)
Ran an authenticated API walkthrough against the running dev hub. All confirmed: Part A unified read layer (`GET /process` 200, proposal visible as `civic.proposal`, **canonical id with no fork** — same `proc_` id on process + child row); Part C-7 convert route → 404; Part B one creation path (admin → `auto_approved=true`, resident → review queue + hidden from public list); step 8 vote lifecycle (approve → `proposed`, endorse increments support, **auto-activates `proposed→active` at threshold 5**) with the full event chain `created→proposed→threshold_met→started` in the feed; step 5 deliberation fix (all recent events carry a top-level `process_id`). Note: `GET /process/:id/state` on a pending-review process returns the vote's *internal* `state.status` (e.g. `draft`), which is the known dual-status quirk — harmless (the process is excluded from the public list + feed; only the admin review queue surfaces it).

**Dev DB was behind 3 migrations** (`20260623_vote_method`, `20260624_process_reviews`, `20260625_reviews_seen_at`) — applied to dev via the SQL editor during verification (prod already had them). The repo's Supabase CLI is linked to PROD (`nfhyypwoporfggqcerli`); dev is `urfmvqhzmamigssqwsya`. Verification left some throwaway test rows in dev (test users, drafts, one auto-activated vote, one proposal) — clear with `GET /debug/seed` if desired.

Implements `decisions/audit-2026-06-25-process-and-feed-consistency.md` Phase 1 + the addenda. Owner decisions captured this session: **all votes** go through the proposed phase (resident AND admin), votes **auto-activate** at the support threshold, and **admin votes behave the same as residents'** (just auto-approved).

### Part A — registry + canonical row (commit "Part A")
- Thin `ProcessHandler` adapters for `civic.proposal` (`src/processes/proposalAdapter.ts`) and `civic.project` (`src/processes/projectAdapter.ts`), registered in `registry.ts`. All four types now visible to `getAllProcesses`/`listProcessSummaries`. Adapters expose canonical `processes`-row fields only (the sync handler read interface can't query the child tables); rich detail still served by the dedicated `/proposals` and `/projects` routes.
- Permanent canonical `processes` row: on review approval, the proposal/project **child row is keyed by `review.process_id`** (no forking a new id). `createProposal`/`createProject` gained an optional `id`.
- Deleted dead `processes/proposalProcess.ts` + its registry entry.
- Removed the `"open"` ProcessStatus alias. **Finding (contradicts the audit's "dead alias" premise):** `"open"` was the live `createProcess` default for announcements/vote-results/deliberations (they don't declare a resting status). Nothing in the codebase compares to `"open"`, so removing it is runtime-safe; the `createProcess` fallback now defaults to `"active"`. Legacy `"open"` rows remain in the DB but are inert.
- `archiveProject` now emits `civic.project.archived` (was a silent state change). NOTE: `archiveProject` still has no caller/route — the event fires once archive is wired up.
- Deliberation events now carry top-level `process_id` (lifted from event `data` in `deliberationBoot.ts`), restoring `GET /events?process_id=` filtering + orphan-event joins.

### Part C step 7 — retire proposal→vote conversion (commit "step 7")
- Removed `handleConvertProposal`, the `POST /admin/proposals/:id/convert` route, dead `markConverted`/`emitProposalConverted`, and the frontend `convertProposal` client. `AdminProposals.tsx` is now moderation-only (list/detail/archive). Proposals are a pure idea board.

### Part B + step 8 — one creation path; activate the vote proposed phase (commit "Part B + step 8")
- `submitAsCreator()` (review module) is the single creation path for all four reviewable types: always submit for review, auto-approve when the creator is an admin. Removed the `if(isAdminEmail) create… else submit…` branches from the vote/proposal/project/conversation controllers. `submitForReview` gained a `notify` flag (suppresses "needs review" emails on auto-approve).
- Uniform response `{ review_id, process_id, auto_approved }` (`CreateProcessResult` in `api.ts`); the four submit pages navigate to the live detail page when `auto_approved`, else to My Submissions.
- Votes are created in `activation_mode: "proposal_required"` (was hardcoded `"direct"`). `approveReview` runs the vote's `process.propose` so its STATE enters `proposed` (addSupport gates on `state.status`). The existing `VotePanel` endorsement UI now lights up; the vote engine auto-activates at threshold.

### Incomplete / follow-ups
- **Dual status** (now confirmed in verification): the `processes` row holds the lifecycle status (`pending_review`/`proposed`/`active`) while the vote's `state.status` and the proposal/project child rows hold their own status, and `GET /process/:id/state` returns the latter. Reconciling status semantics + terminal vocabulary is Phase 2 (lifecycle alignment). Consider also status-gating `getProcessState` so pending-review processes aren't fetchable by direct id (pre-existing, out of Phase 1 scope).
- **Legacy `"open"` rows** in the DB are inert; clean up if/when convenient (not required).
- Deferred per scope: feed-worthiness centralization (`shared/feedActivity.ts`) + digest parity = Phase 3; event-type renaming + spec rewrites = Phase 4.
- Consider renaming the vote's early `proposed` state (e.g. `gathering_support`) to kill the residual collision with the Proposal process name.

---

## Collaborative Admin Creation Review — 2026-06-24

**Status:** Core system built. Backend + frontend + DB migration complete. TypeScript compiles clean. Needs browser testing and integration tests.

### What was built

A review layer between resident submission and public posting. When a non-admin resident submits a vote, project, or conversation, it enters `pending_review` status. An admin reviews and can approve, request changes, or decline. The creator can revise and resubmit or withdraw. Admin users bypass review and create directly.

**Database migration:** `supabase/migrations/20260624000000_process_reviews.sql`
- `process_reviews` table (id, process_id, creator_id, creator_name, creator_email, status, timestamps)
- `review_turns` table (id, review_id, turn_number, actor, actor_role, action, note, process_snapshot JSONB) — append-only via trigger
- `review_id` column added to `processes` table
- RLS enabled on both tables

**Review module:** `src/modules/civic.review/`
- `models.ts` — ReviewStatus, ProcessReview, ReviewTurn, SubmitForReviewInput, ReviseInput types
- `service.ts` — State machine: submitForReview → approveReview / requestChanges / declineReview / reviseAndResubmit / withdrawReview. Read operations for list/detail. On approval: votes → "proposed" status (support threshold), projects → creates actual project row, conversations → "active" status.
- `events.ts` — All review events emitted with `visibility: "restricted"` (automatically hidden from public feed)
- `email.ts` — 7 notification functions via existing mailer (creator submitted/approved/declined/changes-requested, admin new-submission/resubmitted/withdrawn)

**Routes + controller:** `src/routes/reviewRoutes.ts`, `src/controllers/reviewController.ts`
- Creator: POST /reviews/submit, GET /reviews/mine, GET /reviews/:id, POST /reviews/:id/revise, POST /reviews/:id/withdraw
- Admin: GET /admin/reviews, GET /admin/reviews/:id, POST /admin/reviews/:id/approve, POST /admin/reviews/:id/request-changes, POST /admin/reviews/:id/decline

**Draft submit handler changes (admin bypass):**
- `voteDraftController.ts` — Non-admin → submitForReview("civic.vote"), admin → direct createProcess
- `projectDraftController.ts` — Non-admin → submitForReview("civic.project"), admin → direct createProject
- `deliberationController.ts` — Non-admin → submitForReview("civic.polis_deliberation"), admin → direct createProcess
- `deliberationRoutes.ts` — POST / changed from requireAdmin to requireResident (controller handles admin check)

**ProcessStatus:** Added `"pending_review"` and `"archived"` to union type. `getAllProcesses()` filters them from public listings.

**Frontend:**
- `AdminReviews.tsx` + CSS — Admin review queue with status filters, detail view with thread + action buttons
- `MySubmissions.tsx` + CSS — Creator submission tracker with status, detail view with revise form + withdraw
- `api.ts` — Review API functions (submit, list, detail, revise, withdraw, admin CRUD)
- `AdminTabs.tsx` — Added "Reviews" tab
- `Nav.tsx` — Added "My submissions" link in user menu
- `ProposeDraftVote.tsx` — Redirect to /my-submissions on review_id response; button text "Submit for review" for non-admin
- `ProjectDraft.tsx` — Same redirect + button text pattern
- `ConversationDraft.tsx` + `HostDeliberationForm.tsx` — onSubmittedForReview callback, button text changes
- `App.tsx` — Routes for /my-submissions, /admin/reviews

### Coverage

- **Votes, projects, conversations:** Routed through review for non-admin residents
- **Proposals:** Already have their own review flow (AdminProposals) — not changed
- **Word cloud:** Admin-only creation — not affected

### Incomplete / follow-ups

- **Browser testing:** Not yet verified in browser
- **Integration tests:** Review state machine tests not yet written (Task 8)
- **display_name requirement:** The system falls back to email prefix if display_name is null. Consider requiring display_name at submission time.
- **Conversation approval:** On approval, the process goes "active" but doesn't call the deliberation start flow (Polis integration). Admin may need to manually start after approval.
- **Proposal review consolidation:** Proposals have a separate review flow. Consider migrating to the unified review system in a future pass.

---

## Pluggable Voting Methods + Approval Voting — 2026-06-23

**Status:** Complete and deployed. Backend, frontend, unit tests, migration applied to production.

### What was built

Upgraded `civic.vote` to support pluggable voting methods via a sub-registry pattern, and added **approval voting** as the first new method alongside the existing yes/no/unsure.

**Backend:**
- `src/modules/civic.vote/methods.ts` — VotingMethod interface and sub-registry with two implementations: `yes_no_unsure` (default, backward-compatible) and `approval` (multi-select, creator-defined options)
- `src/modules/civic.vote/models.ts` — Added `method` field to VoteProcessState, widened votes type to `string | string[]`
- `src/modules/civic.vote/results.ts` — Delegates to method registry for tally computation
- `src/modules/civic.vote/index.ts` — Full rewrite of `submitVote`/`closeVote`/`finalizeVote`/`getReadModel` to dispatch through method registry
- `src/modules/civic.vote/events.ts` — Events include `method` in data payloads
- `src/processes/voteProcess.ts` — Reads method from state, routes ballot input (`payload.selections` for approval, `payload.option` for yes_no_unsure)
- `src/modules/civic.vote_drafts/` — Model, index, and controller updated to handle `method` + `custom_options` fields through CRUD and submission
- `src/modules/civic.vote_results/` — VoteContextSnapshot carries `method`; snapshotted at results creation
- `supabase/migrations/20260623000000_vote_method.sql` — Adds `method TEXT` and `custom_options JSONB` to `vote_drafts` table

**Frontend:**
- `VoteDraftingForm.tsx` — Method selector (toggle buttons: Yes/No/Unsure vs Approval) and dynamic option editor for approval voting
- `VoteDraftingForm.css` — Styles for method selector and approval options editor
- `ProposeDraftVote.tsx` — Wired `onMethodChange` handler, confirmation modal shows method + options
- `VotePanel.tsx` — Approval ballot with checkboxes, submit button, shows "You approved: X, Y" in receipt; tally note for approval percentages
- `VoteLog.tsx` — `formatChoice()` deserializes JSON array choices for display
- `VoteResults.tsx` — Notes approval voting method in participation line
- `App.css` — Approval ballot CSS (checkbox cards, submit button, method note)
- `api.ts` — Added `submitApprovalVote()`, updated VoteState/VoteDraft types for method

**Tests:**
- `tests/unit/voting-methods.test.ts` — 32 unit tests covering both methods: validation, tally, serialization, same-ballot detection, edge cases
- `vitest.config.ts` — Expanded include to cover `tests/unit/**/*.test.ts`

### Backward compatibility

- Missing `method` defaults to `"yes_no_unsure"` everywhere via `resolveMethod()` helper
- No process state migration needed (JSONB field defaults are handled in code)
- Existing votes, events, and receipts unaffected
- Receipt system is opaque — stores serialized choice as TEXT (bare string for yes_no_unsure, JSON array for approval)

### Architecture decisions

- **Sub-registry pattern:** Each VotingMethod owns ballot validation, tally computation, and receipt serialization. Adding ranked-choice or score voting only requires implementing the interface and registering it — no other file changes needed.
- **Tally semantics for approval:** `total_votes` = number of voters (not sum of approvals). Percentages represent "% of voters who approved this option" and can sum to >100%.
- **One ballot per voter, changeable while active, secret/display-anonymous** — same privacy model as yes_no_unsure.

### Post-deploy fixes

- Fixed missing `onMethodChange` prop on mobile `VoteDraftingForm` instance
- Fixed button hover text color — global `a:hover` from design system was overriding white text on dark button-styled `<Link>` components (Suggest a vote, Start a project, etc.)
- Added `method` field to frontend `VoteContextSnapshot` type (fixed Vercel build)

### What's incomplete

- No integration/E2E tests yet for approval voting (requires running server + DB)
- Seed data for demo doesn't include an approval vote yet
- Admin vote results review UI (`AdminVoteResults.tsx`) not updated with approval-specific copy

### Open questions

- Should the method selector be available on proposal-required votes, or only direct-activation votes?
- Should approval voting results show a "winner" indicator (option with most approvals)?

---

## Deployment Summary

- **Live at:** https://demo-hub.civic.social
- **GitHub:** creatinglake/civic-hub
- **Vercel:** auto-deploy on push to main
- **Storage:** Supabase-backed persistent storage

---

## UI Polish & Navigation Overhaul — 2026-06-22

**Status:** Mostly complete. Scroll-to-nav on sub-pages still not working reliably.

### What was built

**Word cloud fixes:**
- Fixed oversized SVG flash on load — `CloudViz` defers SVG render until `ResizeObserver` measures the container (`dims` starts as `null`, SVG only renders after measurement). Commit `0c46838`.
- Hidden "Add your response" form for users who already submitted. Commit `6b13f67`.
- Simplified accordion labels — removed "Show" prefix, replaced text expand/collapse indicators with CSS chevron arrows (border-right/border-bottom trick, rotated). Commit `215fd54`.

**Auth token persistence:**
- Added `AuthError` class with `status` field to `ui/src/services/auth.ts`.
- `AuthContext` now only clears the stored token on 401/403 responses; transient network/server errors preserve the session. Commit `5838dd9`.

**Navigation UI overhaul:**
- Compact CTA cards on all process pages (Propose, Votes, Projects, Conversations) — replaced large colored cards with inline section-header-row pattern (title left, pill button right). Shared styles in `App.css`.
- Added vertical divider after "Feed" tab to visually separate it from the process tabs.
- Fixed Feed tab label alignment (`line-height: 1`, `align-items: center`).
- Added spacing between sticky tabs and page content (`.section:first-of-type { padding-top }`).
- Commits `6665442`, `7606a04`, `c1109e1`.

**Scroll-to-nav on sub-pages (in progress):**
- Goal: clicking Conversations/Propose/Votes/Projects loads the page scrolled down so the sticky tab bar sits at viewport top.
- `FeedVotesTabs.tsx` sets `history.scrollRestoration = "manual"` and retries `window.scrollTo` at 0/100/300/600ms to handle async content loading.
- Commits `6686771`, `17bb7ff`.
- **Still not working reliably** — the user reports that sub-pages still load with the banner visible at the top. Multiple approaches tried (rAF, double-rAF, setTimeout, retry with height check). Needs further debugging — possible causes: build caching on Vercel, late-loading components resetting scroll, or the scroll firing before route transition completes.

### Files changed
- `ui/src/pages/WordCloud.tsx` — SVG defer, hide form, accordion chevrons
- `ui/src/pages/WordCloud.css` — chevron styles
- `ui/src/services/auth.ts` — `AuthError` class
- `ui/src/context/AuthContext.tsx` — conditional token clearing
- `ui/src/components/FeedVotesTabs.tsx` — divider, scroll-to-nav
- `ui/src/components/FeedVotesTabs.css` — divider, tab alignment
- `ui/src/App.css` — section-header-row, section-action-btn, spacing
- `ui/src/pages/Propose.tsx` — compact CTA
- `ui/src/pages/Votes.tsx` — compact CTA, removed scroll restoration code
- `ui/src/pages/Projects.tsx` — compact CTA
- `ui/src/pages/Deliberations.tsx` — compact CTA
- `ui/src/pages/Propose.css` — cleanup
- `ui/src/pages/Projects.css` — cleanup

### What's incomplete
- **Scroll-to-nav** — not working reliably on deployed site. Needs further investigation.
- **Feed tab alignment** — may still sit slightly higher than other tabs.

---

## Step 2 Completion + Design System + Onboarding — 2026-06-19

**Status:** Complete. Pushed to production. Vercel build fixed.

### What was built

**BoS display names (attribution clarity):**
- Added nullable `display_name TEXT` column to users table (migration `20260619000000_add_display_name.sql`, applied to prod Supabase).
- `PATCH /auth/me` endpoint accepts `{ display_name }` to set/clear a user's public name.
- Announcement creation stamps `author_display_name` from the creating user's `display_name` field.
- Feed cards show `author_display_name` above the summary when present (e.g. "Jane Doe").
- Announcement detail page shows combined attribution: "Posted by Jane Doe, Board member".

**Word cloud onboarding flow:**
- After a new user completes signup (email OTP → residency affirmation), if `VITE_HUB_ONBOARDING_WORDCLOUD_ID` is set, they redirect to `/wordcloud/:id?onboarding=1`.
- Word cloud page detects `?onboarding=1`: shows a welcome banner ("Welcome! You're all set.") and a skip-to-feed button instead of the normal back link.
- Configured via `hub.ts` config (`onboarding_wordcloud_id`).

**Design system adoption:**
- Vendored shared design system CSS (`tokens.css`, `base.css`, `components.css`) into `ui/src/styles/design-system/` (Vercel deploys only the civic-hub repo, not the monorepo — `file:../../shared/design-system` doesn't resolve).
- `theme.css` rewritten as a bridge layer: imports `--ds-*` tokens and maps them to the `--color-*` / `--font-*` / `--space-*` names component CSS already uses. No component CSS files needed renaming.
- Added Libre Franklin (`@fontsource-variable/libre-franklin`) for headings. Inter for body text. Manrope for wordmark.
- Hub-specific tokens (pill colors, layout widths) stay local in `theme.css`.
- Civic Indigo primary (#2A4E84), Terracotta accent (#C37B51).

**Vercel build fix:**
- Removed stale `../../shared/design-system` entry from `ui/package-lock.json` that caused `npm install` to fail on Vercel (commit `f5d7523`).

### Previous Step 2 items (completed in prior session)

Nav reorder, not-found back links, creation finality warnings, Floyd-string config sweep, review failure UX fix — all previously shipped.

### What's incomplete

- **Smoke test:** API integration tests (`npm run test`) and E2E tests (`npm run test:e2e`) require a local `.env` with Supabase credentials to run. `.env.local` (from Vercel CLI) is missing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Manual smoke test against production recommended.
- **Threshold default config (S):** Not yet addressed.

---

## Civic Word Cloud — Slice 4 (Admin Creation UI) — 2026-06-18

**Status:** Complete. Admins can create and activate word clouds from a form at `/wordcloud/new`.

### What was built

- `ui/src/pages/CreateWordCloud.tsx` — Admin-gated form (title, description, prompt text). Creates a process via `POST /process`, immediately activates via `POST /process/:id/action`. Redirects to the new word cloud page on success.
- `ui/src/pages/CreateWordCloud.css` — Styles matching the PostAnnouncement pattern (max-width 720px, shared form classes).
- `ui/src/services/api.ts` — Added `createWordcloudProcess()` helper that chains create + activate calls.
- `ui/src/App.tsx` — Added `/wordcloud/new` route (placed before `/:id` to avoid param capture).

### No new backend code
Reuses existing `POST /process` (admin-gated via `requireAdmin` middleware) and the process action dispatch loop. The `createWordcloudState()` factory in the wordcloud module handles state initialization; `process.activate` dispatches to `activateWordcloud()`.

---

## Civic Word Cloud — Slice 3 (Hub Integration) — 2026-06-18

**Status:** Complete. Word clouds now appear in the main feed and are filterable.

### What was built

**Feed integration:**
- `Feed.tsx` — Added `"civic.wordcloud"` to `ProcessKind`, `kindFromEvent()` discrimination (checks `data.process.type`), metadata fetch via `getWordcloud()`, engagement line ("N responses so far")
- `FeedPost.tsx` — Added `"wordcloud"` to `FeedPillKind`, `eventToPost()` handling for `civic.process.started` and `civic.process.result_published` word cloud events, `/wordcloud/:id` href override (bypasses legacy action_url), internal route classification
- `FeedFilter.tsx` — Added `"wordcloud"` filter key, "Word clouds" filter pill, predicate for word cloud events
- `Feed.css` / `FeedFilter.css` — Teal pill color (#e0f2f1 bg / #00695c text) and card border

**Event action_url fix:**
- `modules/civic.wordcloud/index.ts` — All emit calls now pass `action_url_path: /wordcloud/:id` so future events link correctly
- `modules/civic.wordcloud/models.ts` — Added `action_url_path` to `EmitEventFn` type
- Snapshot/close events use `wordcloud_snapshot` / `wordcloud_result` data keys for feed discrimination

**Word cloud improvements (from earlier this session):**
- Aggregation simplified to unigrams only (no n-grams) — cleaner, more coherent cloud
- SVG-based spiral layout with mixed horizontal/vertical orientations, no overlaps
- Tighter packing (3px padding, 0.58 char width, 2500 spiral steps)
- Backend cap of 50 words max
- `GET /wordcloud/:id/responses` endpoint + responses list UI below the cloud
- 60 seeded test submissions

### What's incomplete (Slice 4+)
- Admin creation UI (currently seed/API only)
- Hide/restore moderation for submissions
- Cross-process AI moderation layer
- Embeddable widget / America 250 standalone mode

---

## Civic Word Cloud — Slices 1 + 2 (Complete) — 2026-06-17

**Status:** Complete. Module, handler, API routes, and UI page all built and verified with seeded data.

### What was built

New `civic.wordcloud` process type — a lightweight, non-deliberative civic process where residents submit short free-text answers to prompts and the answers aggregate into a live word cloud.

**Module** (`src/modules/civic.wordcloud/`):
- `models.ts` — Types: `WordcloudProcessState`, `WordcloudSubmission`, `CloudEntry`, `PromptCloud`, etc.
- `index.ts` — Service functions: `createWordcloudState`, `activateWordcloud`, `submitResponse`, `snapshotWordcloud`, `closeWordcloud`, `buildClouds`, `getSubmissionCount`
- `aggregation.ts` — Tokenizer, vendored Porter2 stemmer, stop-word filtering, n-gram extraction (1–3 grams), frequency aggregation with dedup per submission
- `stopwords.ts` — Common English stop words

**Handler** (`src/processes/wordcloudProcess.ts`):
- Implements `ProcessHandler` interface
- Actions: `process.activate` (draft→active), `process.submit` (record submission), `process.snapshot` (publish current cloud), `process.close` (active→closed + final result)
- Registered in `src/processes/registry.ts`
- `PROCESS_DESCRIPTOR` declares the lifecycle: `draft → active → closed` (per ADR-003)

**Migration** (`supabase/migrations/20260617000000_wordcloud_submissions.sql`):
- `wordcloud_submissions` table with process_id FK, prompt_id, author_id, body, device_token, moderation columns
- Unique index enforcing one submission per author per prompt (partial — excludes anonymous)
- Applied to both dev and production Supabase (prod has the empty table — harmless until feature deploys)

**API routes** (`src/controllers/wordcloudController.ts`, `src/routes/wordcloudRoutes.ts`):
- `GET /wordcloud/:id` — full read model with cloud data, prompts, config, metadata
- `GET /wordcloud/:id/cloud` — lightweight cloud-only endpoint for refreshing after submission
- Mounted in `src/app.ts`

**UI page** (`ui/src/pages/WordCloud.tsx`, `WordCloud.css`):
- Word cloud visualization with 6 size classes (frequency-based) and 6 civic color classes
- Ranked list toggle for accessible companion view
- Submission form with character counter, auth gate via `useRequireAuth()`
- Per-prompt sections (supports multi-prompt word clouds)
- Cloud auto-refreshes after submission without full page reload
- Route: `/wordcloud/:id` in `App.tsx`

**API client** (`ui/src/services/api.ts`):
- Added `getWordcloud()`, `getWordcloudCloud()`, `submitWordcloudResponse()` functions
- Added types: `WordcloudCloudEntry`, `WordcloudPromptCloud`, `WordcloudState`

**Seed script** (`scripts/seedWordcloud.ts`):
- Creates a test word cloud "What do you love about Floyd?" with 15 sample submissions

**Architecture decision** (`decisions/003-flexible-process-lifecycles.md`):
- Formalizes that the spec's 5-state lifecycle is a recommended vocabulary, not mandatory for all plugins
- Word cloud uses `draft → active → closed` subset

### Key design decisions
- Evergreen mode: stays `active` indefinitely; admin can manually snapshot or close
- One submission per user per prompt (enforced by DB unique index)
- Per-submission events use `meta.visibility: "restricted"` — raw citizen text stays out of the public feed
- Aggregation computed on-read from DB (not materialized) — fine at Floyd scale
- No moderation for now — placeholder for future cross-process AI moderation layer
- Vendored Porter2 stemmer (zero dependencies)
- `getReadModel()` stays sync (metadata only); cloud data served by dedicated async endpoints

### What's incomplete (Slice 3+)
- Hub UI integration (show word clouds in main process list / feed)
- Hide/restore moderation (will follow civic.input pattern)
- AI moderation at ingestion (future, cross-process)
- Embeddable widget + America 250 mode (future)
- Admin creation UI (currently seed/API only)

### Open questions
- None blocking

---

## Vote Auto-Close + Status Display — 2026-06-02

**Status:** Complete.

### What was built

Votes that pass their `voting_closes_at` date now auto-close on the next read request (lazy evaluation). The full close flow runs: tally computed, vote results process spawned, events emitted.

- `src/services/processService.ts` — Added `autoCloseIfExpired()` function called from `getProcessState()` and `listProcessSummaries()`. When a vote's `voting_closes_at` has passed and status is still "active", it runs `executeAction("process.close")` automatically.
- `ui/src/pages/Process.tsx` — Shows "Vote closed on {date}" instead of just "Voting closed" when the close date is available.
- `ui/src/components/ProcessCard.tsx` — Shows "Closed {date}" instead of just "Closed" on vote cards.

### How it works

No cron needed. When any user views the feed, votes list, or a vote detail page, the read path checks if any active votes have expired. If so, it closes them on the spot — same as if an admin had manually triggered `process.close`. The vote results process is spawned and appears in the admin queue at `/admin/vote-results` for review and approval.

---

## Beta Gating + Digest Frequency — 2026-06-01

**Status:** Complete. Not yet deployed — requires DB migrations and env var activation.

### What was built

**Slice 1: Beta Gating (Invite-Only Access with Waitlist)**

Restricts floyd.civic.social to admin-managed email allowlist during private beta. Non-allowlisted visitors see a beta landing page with waitlist signup.

- `supabase/migrations/20260530000000_waitlist.sql` — `waitlist` table (email PK, created_at, notes) with RLS
- `src/services/hubSettings.ts` — Added `getBetaAllowlist()`, `setBetaAllowlist()`, `isEmailOnBetaAllowlist()`, `getWaitlist()` using existing hub_settings table
- `src/modules/civic.auth/index.ts` — Beta gate in `requestVerification()`: if `CIVIC_BETA_MODE=true`, non-allowlisted/non-admin emails rejected before OTP sent
- `src/controllers/waitlistController.ts` + `src/routes/waitlistRoutes.ts` — `POST /waitlist` with honeypot spam protection
- `src/controllers/adminSettingsController.ts` — Extended to serve/save `beta_allowlist` and `waitlist`
- `src/app.ts` — Mounted `/waitlist` route
- `ui/src/config/hub.ts` — Added `beta_mode` flag from `VITE_BETA_MODE`
- `ui/src/pages/BetaLanding.tsx` + `BetaLanding.css` — Landing page with banner, beta messaging, sign-in button, waitlist form
- `ui/src/services/waitlist.ts` — `joinWaitlist()` API helper
- `ui/src/App.tsx` — Beta gate: unauthenticated users see only landing page + legal pages
- `ui/src/pages/AdminSettings.tsx` + `AdminSettings.css` — Beta allowlist editor + waitlist viewer in admin panel
- `ui/src/services/api.ts` — Extended `AdminSettings` interface

**Activation:** Set `CIVIC_BETA_MODE=true` (backend) + `VITE_BETA_MODE=true` (frontend). Remove both to exit beta.

**Slice 2: Digest Frequency**

Replaced boolean digest toggle with configurable frequency dropdown (Daily, Every 3 days, Weekly, Every 2 weeks, Monthly, Unsubscribed).

- `supabase/migrations/20260601000000_digest_frequency.sql` — Adds `digest_frequency_days INTEGER` column, migrates from `digest_subscribed`, drops old column, adds partial index
- `src/modules/civic.auth/models.ts` — `digest_subscribed: boolean` → `digest_frequency_days: number | null`
- `src/modules/civic.auth/index.ts` — `setDigestSubscription()` → `setDigestFrequency()`, `listSubscribedUsers()` now queries `digest_frequency_days IS NOT NULL`, `rowToUser()` updated, new user default = 1
- `src/controllers/digestController.ts` — Cron job skips users whose frequency window hasn't elapsed; PATCH endpoint accepts `{ digest_frequency_days: number|null }` (with legacy `{ subscribed: boolean }` compat); unsubscribe handler uses `setDigestFrequency(null)`
- `src/modules/civic.digest/service.ts` — Email footer: "Change digest frequency" link + "Unsubscribe" link
- `ui/src/services/auth.ts` — `AuthUser.digest_subscribed` → `digest_frequency_days`
- `ui/src/services/api.ts` — `setDigestSubscription()` → `setDigestFrequency()`
- `ui/src/pages/Settings.tsx` — Toggle replaced with dropdown (Daily / Every 3 days / Weekly / Every 2 weeks / Monthly / Unsubscribed)
- `ui/src/pages/Settings.css` — Added `.form-select` styles for settings panel

### Deployment steps

1. Apply migrations to Supabase (waitlist table + digest frequency column)
2. Set env vars: `CIVIC_BETA_MODE=true`, `VITE_BETA_MODE=true` (when ready for beta gating)
3. Add beta tester emails to allowlist via admin panel at `/admin/settings`
4. Deploy backend + frontend

### Open questions

- Should waitlisted users receive an automatic email when added to the allowlist? (Not implemented — admin manually notifies for now)
- Future: digest frequency change via signed email link (like current unsubscribe) vs. requiring sign-in to settings page

---

## Slice C: Projects Module — Full Stack + Banner Image — 2026-05-24

**Status:** Complete. Deployed to production. All migrations applied to both dev and prod Supabase.

### What was built

**Phase 1 — Database Migration:**
- `supabase/migrations/20260524100000_projects.sql` — Five tables: `projects`, `project_updates`, `project_sentiments` (composite PK, upsert-friendly), `project_comments`, `project_drafts`. Indexes, RLS, updated_at triggers.

**Phase 2 — Backend Module `civic.projects`:**
- `src/modules/civic.projects/models.ts` — Types: Project, ProjectUpdate, ProjectSentiment, ProjectComment, CreateProjectInput, ProjectStatus, SentimentValue.
- `src/modules/civic.projects/events.ts` — Event emission: emitProjectCreated, emitProjectUpdated, emitProjectCommented, emitProjectSentimentChanged. All use `action_url_path: /project/:id`.
- `src/modules/civic.projects/index.ts` — Full CRUD + updates timeline + changeable sentiment (upsert with recount) + flat comments + read model + dev utilities.

**Phase 3 — Backend Module `civic.project_drafts`:**
- `src/modules/civic.project_drafts/models.ts` — ProjectDraft, CreateProjectDraftInput, UpdateProjectDraftInput types.
- `src/modules/civic.project_drafts/index.ts` — Draft CRUD, conversation history, review results, apply AI proposal, status transitions. Mirrors vote_drafts pattern.

**Phase 4 — Assistant Integration:**
- `src/modules/civic.proposal_assistant/models.ts` — Extended ProcessType to include "project".
- `src/modules/civic.proposal_assistant/systemPrompt.ts` — Project-specific brainstorm questions, review guidance, category guidance. Projects have no considerations field.
- `src/modules/civic.proposal_assistant/content.ts` — Added PROJECT_BEST_PRACTICES document.

**Phase 5 — Controllers + Routes:**
- `src/controllers/projectController.ts` — CRUD + updates + sentiment + comments handlers.
- `src/controllers/projectDraftController.ts` — Draft CRUD + assistant + review + submit handlers. Submit creates project via createProject (not process handler).
- `src/routes/projectRoutes.ts` — 7 endpoints (POST /, GET /, GET /:id, POST /:id/updates, POST /:id/sentiment, POST /:id/comments, GET /:id/comments).
- `src/routes/projectDraftRoutes.ts` — 6 endpoints (POST /, GET /:id, PATCH /:id, POST /:id/assistant, POST /:id/review, POST /:id/submit).
- `src/app.ts` — Mounted /projects/drafts (before /projects) and /projects.

**Phase 6 — Frontend API Types + Functions:**
- `ui/src/services/api.ts` — Added ProjectSummary, ProjectDetail, ProjectUpdateEntry, ProjectComment, ProjectDraft, ProjectDraftAssistantResult types. Added 12 API functions for projects and project drafts.

**Phase 7 — Nav + Routing:**
- `ui/src/components/FeedVotesTabs.tsx` — Added "Projects" as fourth tab.
- `ui/src/components/Nav.tsx` — Added "Projects" to drawer links.
- `ui/src/App.tsx` — Added /projects, /projects/new, /project/:id routes. Added "/projects" to BANNER_ROUTES.

**Phase 8 — Projects Listing Page:**
- `ui/src/pages/Projects.tsx` — Listing page with blue-themed CTA, active projects with sentiment bars, archived section.
- `ui/src/pages/Projects.css` — Blue accent CTA styles, project card and sentiment styles.

**Phase 9 — Project Detail + Drafting Pages:**
- `ui/src/pages/ProjectDetail.tsx` — Full detail page: sentiment buttons (changeable), description, sources, updates timeline (creator can post), flat comments.
- `ui/src/pages/ProjectDetail.css` — Sentiment, updates, comments styles.
- `ui/src/pages/ProjectDraft.tsx` — AI-assisted drafting page mirroring ProposeDraftVote: two-path entry (brainstorm/write), desktop two-pane, mobile FAB, submit confirmation modal.
- `ui/src/components/ProjectDraftingForm.tsx` — Simplified form (title, description, sources — no duration, no category). Shares VoteDraftingForm.css.
- `ui/src/pages/ProjectDraft.css` — Minimal (reuses ProposeDraft.css layout classes).

**Phase 10 — Feed Integration:**
- `ui/src/components/FeedPost.tsx` — Added "civic.project" to FeedProcessKind. Added civic.project.created and civic.project.updated event cases with blue pills.
- `ui/src/components/Feed.css` — Added pill and border styles for project-created and project-updated.

### Files created (17)
- `supabase/migrations/20260524100000_projects.sql`
- `src/modules/civic.projects/models.ts`
- `src/modules/civic.projects/events.ts`
- `src/modules/civic.projects/index.ts`
- `src/modules/civic.project_drafts/models.ts`
- `src/modules/civic.project_drafts/index.ts`
- `src/controllers/projectController.ts`
- `src/controllers/projectDraftController.ts`
- `src/routes/projectRoutes.ts`
- `src/routes/projectDraftRoutes.ts`
- `ui/src/pages/Projects.tsx`
- `ui/src/pages/Projects.css`
- `ui/src/pages/ProjectDetail.tsx`
- `ui/src/pages/ProjectDetail.css`
- `ui/src/pages/ProjectDraft.tsx`
- `ui/src/pages/ProjectDraft.css`
- `ui/src/components/ProjectDraftingForm.tsx`

### Files modified (9)
- `src/modules/civic.proposal_assistant/models.ts` — ProcessType extended
- `src/modules/civic.proposal_assistant/systemPrompt.ts` — Project-specific prompts
- `src/modules/civic.proposal_assistant/content.ts` — PROJECT_BEST_PRACTICES
- `src/app.ts` — Project route mounting
- `ui/src/services/api.ts` — Project types + API functions
- `ui/src/components/FeedVotesTabs.tsx` — Projects tab
- `ui/src/components/Nav.tsx` — Projects drawer link
- `ui/src/App.tsx` — Project routes + banner
- `ui/src/components/FeedPost.tsx` — Project event rendering
- `ui/src/components/Feed.css` — Project pill styles

### Design decisions
- **Standalone CRUD, not process handler** — Projects bypass the process registry entirely. They have their own table, their own CRUD, and manual event emission via emitEvent(). The process handler lifecycle (draft→scheduled→active→closed→finalized) is too rigid for editable living documents.
- **Changeable sentiment** — Support/oppose uses upsert on composite PK (project_id, user_id). "Neutral" deletes the row. Counts are recounted from the authoritative sentiments table (same pattern as proposal support counting).
- **AI-assisted drafting** — Full brainstorm/write path with the shared proposal_assistant module. ProcessType extended to "project". Projects have no considerations field — the assistant skips it.
- **No category/duration** — Projects are simpler than votes (no duration picker) and proposals (no idea/concern toggle). Just title, description, sources.

### Post-Slice C additions (same session)

**Feed filter fix:**
- `ui/src/components/FeedPost.tsx` — Added `return null` for `civic.project.comment_added` and `civic.project.sentiment_changed` events to suppress spurious "Activity" cards (same pattern used for vote/proposal events).

**Banner image upload:**
- `supabase/migrations/20260524200000_project_banner_image.sql` — Added nullable `banner_image_url` and `banner_image_alt` columns to `projects` and `project_drafts`.
- `src/routes/uploadRoutes.ts` — Added `POST /upload/project-image` with `requireResident` auth, reusing `handlePostImageUpload`.
- `src/modules/civic.projects/models.ts` — Added banner fields to `Project` and `CreateProjectInput`.
- `src/modules/civic.projects/index.ts` — Updated `ProjectRow`, `rowToProject`, and `createProject` insert.
- `src/modules/civic.project_drafts/models.ts` — Added banner fields to `ProjectDraft` and `UpdateProjectDraftInput`.
- `src/modules/civic.project_drafts/index.ts` — Updated `DraftRow`, `rowToDraft`, and `updateProjectDraft`.
- `src/controllers/projectDraftController.ts` — Passes banner fields through update and submit flows.
- `ui/src/services/api.ts` — Added banner fields to `ProjectSummary`, `ProjectDraft`; added `uploadProjectImage()` function; updated `updateProjectDraft` signature.
- `ui/src/components/PostImagePicker.tsx` — Added optional `uploadFn` prop for endpoint flexibility.
- `ui/src/components/ProjectDraftingForm.tsx` — Added `PostImagePicker` with suggestion note between description and sources.
- `ui/src/pages/ProjectDraft.tsx` — Added `handleImageChange` callback with `skip_modified_flag: true`.
- `ui/src/pages/ProjectDetail.tsx` — Displays banner image above title when present.
- `ui/src/pages/ProjectDetail.css` — Banner image styles (rounded corners, cover-fit, max-height 320px).

### Commits
- `1856c1b` — Slice C: Projects module — full stack
- `bf08849` — Filter project comment/sentiment events from feed
- `d5fbd9a` — Add banner image upload to project drafting + detail pages
- `75ef154` — Fix missing onImageChange prop on mobile ProjectDraftingForm

### What's next
- Slice D: Navigation polish + cross-module feed integration
- Slice E: Assistant module rename (civic.drafting_assistant)

---

## Slice B: Propose Module Rebrand + Simplification — 2026-05-23

**Status:** Complete. All 7 phases implemented, builds pass. Not yet committed or deployed.

### What was built

**Phase 1 — Nav + Routing:**
- `ui/src/components/FeedVotesTabs.tsx` — Added "Propose" tab to TABS array.
- `ui/src/components/Nav.tsx` — Added "Propose" to drawer links.
- `ui/src/App.tsx` — `/propose` route now renders `<Propose />` (listing page). Added `/propose/new` route for the drafting flow. Added `"/propose"` to BANNER_ROUTES.

**Phase 2 — Backend: Remove Endorsement Auto-Promotion:**
- `src/modules/civic.proposals/index.ts` — `supportProposal()` no longer changes status or triggers endorsement events. Support count increments but status stays as-is.
- `src/controllers/proposalDraftController.ts` — Removed `steward_approved` bypasses from hard-block and modified-since-review checks. Added `"concern"` to VALID_CATEGORIES.
- `src/modules/civic.proposal_assistant/models.ts` — Added `"concern"` to Category type.

**Phase 3 — Propose Listing Page:**
- `ui/src/pages/Propose.tsx` — New listing page at `/propose`. Shows HubInfo, FeedVotesTabs, green-themed CTA ("Got something on your mind?"), active proposals sorted by support_count, past proposals section.
- `ui/src/pages/Propose.css` — Green accent overrides for CTA, status badge styles.

**Phase 4 — Simplify Drafting Flow:**
- `ui/src/pages/ProposeDraft.tsx` — Removed category selection step (3-step → 2-step). Rebranded to "Propose an idea". Back links point to `/propose`. Submit navigates to `/propose`. Removed `onCategoryChange` and `onDispute` props.
- `ui/src/components/DraftingForm.tsx` — Removed CategorySelector import. Added inline Idea/Concern pill toggle. Removed considerations field. Removed dispute button and `onDispute`/`onCategoryChange` props. Updated PLACEHOLDERS for idea/concern only. Simplified `canSubmit` (no category requirement).
- `ui/src/components/DraftingForm.css` — Replaced category selector styles with subtype toggle pill styles. Removed dispute button styles.
- `ui/src/services/api.ts` — Extended `DraftCategory` type with `"concern"`.

**Phase 5 — Simplify ProposalDetail:**
- `ui/src/pages/ProposalDetail.tsx` — Back link to `/propose`. Status label "submitted" → "open". Removed endorsement progress bar. Replaced "Endorse This Proposal" → "Support this proposal". Simple "X supporters" text instead of progress bar. Backward compat: endorsed/converted/archived still display.
- `ui/src/App.css` — Added `.proposal-supporters-detail` style.

**Phase 6 — Clean Up Votes Page:**
- `ui/src/pages/Votes.tsx` — Removed `listCivicProposals` import, `civicProposals` state, `activeCivicProposals` derivation, and civic proposals rendering block. Simplified data fetching to just `listProcesses()`.

### Files created (2)
- `ui/src/pages/Propose.tsx`
- `ui/src/pages/Propose.css`

### Files modified (12)
- `ui/src/components/FeedVotesTabs.tsx` — Propose tab
- `ui/src/components/Nav.tsx` — Propose drawer link
- `ui/src/App.tsx` — route changes, banner route
- `ui/src/pages/ProposeDraft.tsx` — 2-step flow, rebrand
- `ui/src/components/DraftingForm.tsx` — idea/concern toggle, simplified
- `ui/src/components/DraftingForm.css` — subtype pill styles
- `ui/src/services/api.ts` — DraftCategory extended
- `ui/src/pages/ProposalDetail.tsx` — support rebrand
- `ui/src/pages/Votes.tsx` — civic proposals removed
- `ui/src/App.css` — supporters detail style
- `src/modules/civic.proposals/index.ts` — remove auto-promotion
- `src/controllers/proposalDraftController.ts` — remove steward bypass, add concern
- `src/modules/civic.proposal_assistant/models.ts` — add concern category

### What's next
- Verify in browser: listing page, drafting flow, support button, Votes page clean
- Commit and push to staging for preview verification
- Slice C: Projects module
- Slice D: Navigation + feed integration for all three types
- Slice E: Assistant module rename (civic.drafting_assistant)

---

## Slice A: Vote Module + Generic Feed Fallback — 2026-05-23

**Status:** Complete. All 8 phases implemented, builds pass, verified in browser. Not yet committed or deployed.

### What was built

**Phase 1 — Database Migration:**
- `supabase/migrations/20260524000000_vote_drafts.sql` — `vote_drafts` table with title, description, sources, `voting_duration_ms` (default 30 days), conversation_history (JSONB), last_review_result, status. No category or considerations columns (vote-specific). Index on `(user_id, status)`.

**Phase 2 — Backend Module `civic.vote_drafts`:**
- `src/modules/civic.vote_drafts/models.ts` — VoteDraft, CreateVoteDraftInput, UpdateVoteDraftInput types.
- `src/modules/civic.vote_drafts/index.ts` — Full CRUD: createVoteDraft (`vdraft_<hex>` IDs), getVoteDraft, listUserVoteDrafts, updateVoteDraft (validates duration 2 weeks–3 months), appendVoteConversation, saveVoteReviewResult, applyVoteDraftProposal, setVoteDraftStatus.

**Phase 3 — Assistant Module Vote Support:**
- Added `ProcessType = "proposal" | "vote"` to models, threaded through service.ts → buildSystemPrompt.
- Added `VOTE_BEST_PRACTICES` content constant (title-as-question guidance, balanced framing, duration awareness).
- System prompt conditionally adapts brainstorm questions, category handling, review phase, and best-practices document based on processType.

**Phase 4 — Controller + Routes:**
- `src/controllers/voteDraftController.ts` — 7 handlers: create, list, get, update, assistant message, review, submit. Submit handler: creates `civic.vote` process with `activation_mode: "direct"` + chosen `voting_duration_ms`, then `executeAction("process.activate")` to auto-activate, sets draft status to "submitted", returns `process_id`.
- `src/routes/voteDraftRoutes.ts` — Express router at `/votes/drafts`.
- `src/app.ts` — Mounted vote draft routes before vote log routes. Removed `PROPOSAL_ASSISTANT_ENABLED` toggle — proposal drafts now mount unconditionally.

**Phase 5 — Frontend Vote Drafting:**
- `ui/src/components/VoteDraftingForm.tsx` + `.css` — Slimmed form: title ("Vote question"), description ("Context for voters"), sources, duration `<select>` (2 weeks / 1 month / 2 months / 3 months). No category selector, no considerations field, no dispute button.
- `ui/src/pages/ProposeDraftVote.tsx` + `.css` — Two-step flow (path → drafting). Two-pane layout (assistant left, form right), mobile FAB pattern. Submit confirmation modal shows chosen duration. On submit navigates to `/process/<id>`.
- `ui/src/services/api.ts` — Added VoteDraft interface and 6 API functions (create, get, update, sendVoteAssistantMessage, reviewVoteDraft, submitVoteDraft).

**Phase 6 — Routing + Toggle Cleanup:**
- `ui/src/App.tsx` — Added `/votes/new` route → ProposeDraftVote. Changed `/propose` from conditional `hub.proposal_assistant ? ProposeDraft : Propose` to unconditional `ProposeDraft`. Removed Propose import.
- `ui/src/pages/Votes.tsx` — CTA links now point to `/votes/new` instead of `/propose`.
- `ui/src/config/hub.ts` — Removed `proposal_assistant` field.
- Deleted `ui/src/pages/Propose.tsx`.

**Phase 7 — Generic Feed Fallback:**
- `ui/src/components/FeedPost.tsx` — Added `"generic"` to FeedPillKind. Unknown `result_published` shapes and unknown event types render as generic "Activity" cards instead of being silently dropped.
- `ui/src/components/Feed.tsx` — Added `"generic"` to ProcessKind. `kindFromEvent` returns `"generic"` for unknown `result_published` shapes and truly unknown event types, but keeps returning `null` for known lifecycle events (created, updated, ended, etc.) that shouldn't render in the feed. Generic metadata fetch calls `getProcessState()` for title/description.
- `ui/src/components/Feed.css` — Added `.feed-post--generic` (gray border) and `.feed-pill--generic` (gray pill) styles.

### Files created (7)
- `supabase/migrations/20260524000000_vote_drafts.sql`
- `src/modules/civic.vote_drafts/models.ts`
- `src/modules/civic.vote_drafts/index.ts`
- `src/controllers/voteDraftController.ts`
- `src/routes/voteDraftRoutes.ts`
- `ui/src/components/VoteDraftingForm.tsx` + `.css`
- `ui/src/pages/ProposeDraftVote.tsx` + `.css`

### Files modified (10)
- `src/modules/civic.proposal_assistant/models.ts` — ProcessType
- `src/modules/civic.proposal_assistant/content.ts` — VOTE_BEST_PRACTICES
- `src/modules/civic.proposal_assistant/systemPrompt.ts` — processType branching
- `src/modules/civic.proposal_assistant/service.ts` — thread process_type
- `src/modules/civic.proposal_assistant/index.ts` — re-export ProcessType
- `src/app.ts` — mount vote draft routes, remove toggle
- `ui/src/services/api.ts` — vote draft API functions
- `ui/src/App.tsx` — route, remove toggle
- `ui/src/pages/Votes.tsx` — CTA link → /votes/new
- `ui/src/config/hub.ts` — remove proposal_assistant field
- `ui/src/components/FeedPost.tsx` — generic fallback
- `ui/src/components/Feed.tsx` — generic kind handling + CSS

### Files deleted (1)
- `ui/src/pages/Propose.tsx`

### What's next (Slice B+)
- Apply migration to dev Supabase (`supabase db push`)
- End-to-end test: sign in, brainstorm a vote, submit, verify auto-activation and voting_closes_at
- Slice B: Propose module rebrand (rename from "suggest a vote" proposal flow to dedicated proposal drafting)
- Slice C: Projects module
- Slice D: Navigation + feed integration for all three types
- Slice E: Assistant module rename (civic.proposal_assistant → civic.drafting_assistant)
- Slice F: Cleanup + migration of existing data

### Future enhancement: Cross-process-type routing in AI assistant
When all three process types (Vote, Propose, Projects) are live, the AI assistant should detect when a user's idea would be better suited for a different process type and suggest switching. For example: a user starts in the vote drafting flow but describes a community garden initiative — the assistant could say "This sounds more like a project than a vote. Would you like to start a project instead?" and link them to `/projects/new`. This requires all three process types to exist first, so target Slice E (assistant modularity) or later. See `~/Documents/vote-propose-project-process-prompt.md` for the full design context.

---

## AI Assistant Polish + Three Process Types Design — 2026-05-22

**Status:** AI drafting assistant is beta-complete and deployed to production (floyd.civic.social). Comprehensive design document created for the next phase: splitting civic engagement into three independent modules (Votes, Propose, Projects). Design doc saved outside repo at `~/Documents/vote-propose-project-process-prompt.md`.

### What was built / changed

**AI Assistant Bug Fixes & Polish:**

- **Prompt caching** — added Anthropic `cache_control: { type: "ephemeral" }` on system prompt blocks in `callClaudeMultiTurn` to reduce token costs on multi-turn conversations.
- **Lowered maxTokens** — reduced from 4096 to 1536 for assistant responses (responses are short).
- **Raw JSON in chat fix** — assistant sometimes returned markdown code fences or raw JSON. Added `cleanMessage()` to fix escaped newlines/quotes, code fence stripping before JSON parse, and `extractFallbackMessage()` regex-based extraction when JSON parse fails entirely.
- **Suggestion card overflow** — added `overflow-wrap: break-word` and `word-break: break-word` to `.suggestion-card` CSS.
- **Mobile FAB hidden** — floating action button was inside an `overflow: hidden` container. Moved FAB and overlay outside the scroll container using a fragment.
- **Mobile footer bleed** — wrapped in viewport-height flex container with overflow handling.
- **Desktop footer visible** — added `overflow: hidden` to `.propose-draft-page`.
- **Old suggestions piling up on re-review** — review now strips `suggestions` from previous messages before appending new results.
- **Apply suggestion invalidating review** — added `skip_modified_flag` parameter to `updateDraft`. When applying AI suggestions, the `draft_modified_since_review` flag is not set, so users don't need to re-review after clicking Apply.
- **Considerations dropped on submit** — `handleSubmitDraft` now appends considerations to description under a "Considerations:" heading.
- **Link display fix** — proposal detail page now parses URLs from labeled text (e.g., "Label: https://...") and renders label + clickable URL separately.

**Review Button Consolidation:**
- Removed review button from AssistantPanel (left pane)
- Added review button to DraftingForm (right pane) — blue background, white text, more pronounced
- Status bar text improved with "Status:" prefix and clearer messaging about draft state

**System Prompt Updates:**
- Review phase now requires `suggested_revision` on ALL suggestions including hard blocks
- Added empty field nudge: after review, assistant mentions empty optional fields and offers to help fill them, while making clear user can submit without them

**Rename "Submit suggestion" → "Submit proposal"** throughout UI (DraftingForm, ProposeDraft confirmation modal, Propose page).

### Three Process Types — Design Document

Created comprehensive session prompt at `~/Documents/vote-propose-project-process-prompt.md` (intentionally outside repo). Key design decisions:

1. **Three independent modules:** Votes (modify existing), Propose (rebrand existing pipeline), Projects (new build). Each independently toggleable by hub operator.
2. **Remove steward review gate** — AI assistant's CoC hard blocks replace the manual steward review. Content goes live on submit after passing AI review.
3. **Remove endorsement pipeline** — no more 5-supporter threshold, "gathering support" status, or steward conversion step.
4. **User-selectable vote duration** — 2 weeks to 3 months, default 1 month.
5. **Changeable votes/sentiments** — citizens can change their vote or project sentiment before closing.
6. **Projects as living pages** — creator-editable, with updates, media, comments, support/oppose sentiment.
7. **Separate drafting pages per process type** — each gets its own page component, sharing lower-level components (AssistantPanel, SuggestionCard) but distinct orchestration.
8. **Shared AI assistant module** — one engine (`civic.assistant/`) with per-process best practices documents.
9. **Admin digest notifications** — new posts included in admin email digest (no approval gate).
10. **Nav update:** Feed | Votes | Projects | Propose

Implementation slices: A (clean up votes) → B (propose tab) → C (project backend) → D (project UI) → E (AI assistant modularity) → F (admin digest).

### Files changed this session

**Modified (backend):**
- `civic-hub/src/utils/anthropic.ts` — prompt caching on system blocks
- `civic-hub/src/modules/civic.proposal_assistant/service.ts` — lower maxTokens, cleanMessage, extractFallbackMessage, code fence stripping
- `civic-hub/src/modules/civic.proposal_assistant/systemPrompt.ts` — require suggested_revision on hard blocks, empty field nudge
- `civic-hub/src/modules/civic.proposal_drafts/models.ts` — add `skip_modified_flag` to UpdateDraftInput
- `civic-hub/src/modules/civic.proposal_drafts/index.ts` — conditional `draft_modified_since_review` based on skip flag
- `civic-hub/src/controllers/proposalDraftController.ts` — accept `skip_modified_flag`, merge considerations into description on submit

**Modified (frontend):**
- `civic-hub/ui/src/components/AssistantPanel.tsx` — remove review button, update empty state text
- `civic-hub/ui/src/components/AssistantPanel.css` — remove review button styles, add suggestion card word-break
- `civic-hub/ui/src/components/DraftingForm.tsx` — add review button, improve status text
- `civic-hub/ui/src/components/DraftingForm.css` — review button styles
- `civic-hub/ui/src/pages/ProposeDraft.tsx` — mobile layout fix, FAB positioning, suggestion clearing on re-review, skip_modified_flag on apply
- `civic-hub/ui/src/pages/ProposeDraft.css` — mobile layout, overflow fixes
- `civic-hub/ui/src/pages/ProposalDetail.tsx` — link parsing fix
- `civic-hub/ui/src/pages/Propose.tsx` — "Submit proposal" rename
- `civic-hub/ui/src/services/api.ts` — skip_modified_flag parameter

### What's next

The three process types implementation, following the session prompt at `~/Documents/vote-propose-project-process-prompt.md`. Start with Slice A (clean up votes) and work through the slices in order.

### Open questions

1. **Projects media upload** — storage backend for user-uploaded images (Supabase Storage, S3, etc.) needs to be decided before Slice D.
2. **Admin digest frequency** — daily? configurable? Needs decision before Slice F.
3. **Propose sub-types** — "idea" vs "concern" — is this the right framing, or should it be simpler?

---

## AI-Augmented Proposal Process — Slices A & B — 2026-05-19

**Status:** Backend foundation (Slice A) and frontend UI shell (Slice B) complete. Builds clean (both backend `tsc --noEmit` and frontend `npm run build`). Not yet tested against a live database or with real Claude API calls. Slices C (orientation modal, polish) and D (steward dispute flow) remain.

### What was built

**Backend (Slice A):**

- **Database migration** (`civic-hub/supabase/migrations/20260520000000_proposal_drafts.sql`) — adds `category` and `assistant_helped` columns to existing `proposals` table; creates `proposal_drafts` table with conversation history (JSONB), review results, edit-invalidation flag, steward approval, and status lifecycle.
- **Multi-turn Claude client** (`civic-hub/src/utils/anthropic.ts`) — new `callClaudeMultiTurn()` function accepting a `messages` array for multi-turn conversations. Existing `callClaude()` untouched. Same retry, timeout, and error handling.
- **Hub config files** (`civic-hub/config/hubs/floyd/code-of-conduct.md`, `proposal-best-practices.md`) — runtime documents loaded by the assistant service. CoC defines hard blocks; Best Practices defines soft suggestions and draft generation guidance. Editable without code changes.
- **Proposal assistant module** (`civic-hub/src/modules/civic.proposal_assistant/`) — `models.ts` (Phase, Category, Suggestion, DraftState types), `systemPrompt.ts` (builds the full system prompt from template + runtime docs with file caching), `service.ts` (callAssistant function that orchestrates Claude calls and parses structured JSON responses).
- **Draft persistence module** (`civic-hub/src/modules/civic.proposal_drafts/`) — full CRUD for proposal drafts: create, get, list, update, appendConversation, saveReviewResult, applyDraftProposal, setDraftStatus.
- **Routes and controller** (`civic-hub/src/routes/proposalDraftRoutes.ts`, `civic-hub/src/controllers/proposalDraftController.ts`) — 7 endpoints: POST create, GET list, GET by ID, PATCH update, POST assistant message, POST review, POST submit. All require `requireResident`. Owner-only access enforced.
- **Existing file updates** — `app.ts` mounts draft routes before proposal routes (avoids route shadowing); `civic.proposals` module accepts `category` and `assistant_helped` in createProposal; controller passes them through.

**Frontend (Slice B):**

- **API service** (`civic-hub/ui/src/services/api.ts`) — added `ProposalDraft`, `DraftSuggestion`, `AssistantResponse` types; `createDraft`, `getDraft`, `updateDraft`, `sendAssistantMessage`, `reviewDraft`, `submitDraft` functions. Updated `CivicProposalSummary` and `CivicProposalDetail` with `category` and `assistant_helped` fields.
- **CategorySelector** (`civic-hub/ui/src/components/CategorySelector.tsx`) — three radio cards for Issue/Idea/Project with descriptions.
- **SuggestionCard** (`civic-hub/ui/src/components/SuggestionCard.tsx`) — renders soft/hard suggestions with severity badge, quoted text, revision preview, Apply/Dismiss actions.
- **AssistantPanel** (`civic-hub/ui/src/components/AssistantPanel.tsx` + `.css`) — left-pane chat interface with message thread, inline suggestion cards, text input, Review button with edit-emphasis animation.
- **DraftingForm** (`civic-hub/ui/src/components/DraftingForm.tsx` + `.css`) — right-pane form with category selector, title/description/sources/considerations fields, category-adaptive placeholders, status indicator, Submit/Dispute action row. Debounced auto-save on field changes.
- **ProposeDraft page** (`civic-hub/ui/src/pages/ProposeDraft.tsx` + `.css`) — three-step flow: category selection → path choice (brainstorm/write-my-own) → two-pane drafting view (40/60 split on desktop, single-pane + floating FAB on mobile). Submit confirmation modal with disclosure.
- **Routing** — `/propose` now renders `ProposeDraft` instead of `Propose` (old page stays in codebase but unrouted).
- **"Drafted with assistant help"** label added to `ProposalDetail.tsx` when `assistant_helped` is true.

### Architecture decisions

- **No Anthropic SDK** — extended existing `callClaude` with `callClaudeMultiTurn` (~90 lines). Keeps the no-SDK philosophy consistent with the rest of the codebase.
- **No streaming in v1** — request-response only. Assistant responses are short enough that waiting is acceptable. Streaming is a v1.1 enhancement.
- **Conversation history in JSONB** — full chat history stored in the `proposal_drafts` row. Sent on each API call. Avoids a separate messages table.
- **Config files on filesystem** — CoC and Best Practices read from `config/hubs/floyd/` at startup, cached in module-level variables. Env vars `CIVIC_COC_PATH` and `CIVIC_BEST_PRACTICES_PATH` allow override.
- **Draft routes mounted before proposal routes** — `/proposals/drafts` registered before `/proposals` in `app.ts` so Express doesn't match "drafts" as a proposal `:id`.
- **Edit-invalidation state machine** — `draft_modified_since_review` flag tracks whether the draft has changed since the last review. Submit and Dispute are both gated by this flag plus the review verdict.

### Files changed

**New files (backend):**
- `civic-hub/config/hubs/floyd/code-of-conduct.md`
- `civic-hub/config/hubs/floyd/proposal-best-practices.md`
- `civic-hub/supabase/migrations/20260520000000_proposal_drafts.sql`
- `civic-hub/src/modules/civic.proposal_assistant/models.ts`
- `civic-hub/src/modules/civic.proposal_assistant/systemPrompt.ts`
- `civic-hub/src/modules/civic.proposal_assistant/service.ts`
- `civic-hub/src/modules/civic.proposal_assistant/index.ts`
- `civic-hub/src/modules/civic.proposal_drafts/models.ts`
- `civic-hub/src/modules/civic.proposal_drafts/index.ts`
- `civic-hub/src/controllers/proposalDraftController.ts`
- `civic-hub/src/routes/proposalDraftRoutes.ts`

**New files (frontend):**
- `civic-hub/ui/src/components/CategorySelector.tsx`
- `civic-hub/ui/src/components/SuggestionCard.tsx`
- `civic-hub/ui/src/components/AssistantPanel.tsx` + `.css`
- `civic-hub/ui/src/components/DraftingForm.tsx` + `.css`
- `civic-hub/ui/src/pages/ProposeDraft.tsx` + `.css`

**Modified files:**
- `civic-hub/src/app.ts` — mount draft routes
- `civic-hub/src/utils/anthropic.ts` — add `callClaudeMultiTurn`
- `civic-hub/src/modules/civic.proposals/models.ts` — add category, assistant_helped
- `civic-hub/src/modules/civic.proposals/index.ts` — pass new fields through
- `civic-hub/src/controllers/proposalController.ts` — accept category from request
- `civic-hub/ui/src/services/api.ts` — draft API functions + updated types
- `civic-hub/ui/src/App.tsx` — route change
- `civic-hub/ui/src/App.css` — assistant-helped label style
- `civic-hub/ui/src/pages/ProposalDetail.tsx` — assistant-helped indicator

### What's incomplete (Slices C & D)

**Slice C — Orientation modal + polish:**
- First-time orientation modal (3 screens, localStorage flag)
- Apply-suggestion-to-form visual feedback polish
- Free-form chat phase refinement
- Mobile assistant overlay interaction polish

**Slice D — Steward dispute flow:**
- `proposal_disputes` table migration
- Dispute button functionality (currently wired to no-op)
- Admin dispute review page
- Steward actions (approve/suggest revisions/decline)
- Email notifications to stewards
- Integration with admin digest

### Open questions

1. **Migration deployment** — the `update_updated_at()` function used in the trigger must already exist from the initial schema migration. Verify before running.
2. **Config file paths on Vercel** — the `config/` directory needs to be included in the Vercel deploy. Verify the build output includes it, or use env vars for content.
3. **Claude API costs** — each brainstorm/review/chat call sends the full conversation history + system prompt (~4-5K tokens of system prompt). Monitor usage.

---

## Slice 14 — Welcome page + homepage promotion — 2026-05-19

**Status:** Complete. Public `/welcome` page renders the curated community introduction with PDF download and feedback links. Dismissible banner on the home page and nav drawer link provide discoverability.

### Changes

- **Welcome content file** — `civic-hub/ui/src/content/welcome/welcome.md`. Copied from the operator's curated document with the closing italic Mosaic Foundation line removed (redundant on-site). Prose is untouched.
- **Welcome page** — `civic-hub/ui/src/pages/Welcome.tsx` + `Welcome.css`. Public, unauthenticated. Reuses `ReactMarkdown` + `remark-gfm` and the `legal-page` / `legal-prose` CSS classes for visual consistency with legal pages, but is a standalone component (not `LegalPage`) so it can host the PDF download link at top and feedback CTA at bottom.
- **PDF static asset** — `civic-hub/ui/public/floyd-civic-hub-introduction.pdf`. Copied as-is from the operator's source. Linked from the Welcome page as "Download as PDF (4 pages)".
- **Dismissible welcome banner** — `civic-hub/ui/src/components/WelcomeBanner.tsx` + `WelcomeBanner.css`. Renders between `HubInfo` and `FeedVotesTabs` on the home page. Dismissal persists via `localStorage` key `welcome-banner-dismissed-v1` (bump the version suffix to re-show after meaningful content changes).
- **Nav drawer link** — "Welcome" added to `DRAWER_LINKS` in `Nav.tsx`, positioned between "Votes" and "About". Ensures the page stays discoverable after banner dismissal.
- **Route registration** — `/welcome` → `<Welcome />` added to `App.tsx`.
- **IntroPopup update** — "Learn more" button now navigates to `/welcome` instead of `/about`, so the first-visit popup funnels to the richer introduction page.

### Files changed

UI only (no backend, no DB migration):
- `civic-hub/ui/src/content/welcome/welcome.md` — new
- `civic-hub/ui/src/pages/Welcome.tsx` — new
- `civic-hub/ui/src/pages/Welcome.css` — new
- `civic-hub/ui/src/components/WelcomeBanner.tsx` — new
- `civic-hub/ui/src/components/WelcomeBanner.css` — new
- `civic-hub/ui/public/floyd-civic-hub-introduction.pdf` — new (static asset)
- `civic-hub/ui/src/App.tsx` — import + route for Welcome
- `civic-hub/ui/src/pages/Home.tsx` — mounts `<WelcomeBanner />` between HubInfo and FeedVotesTabs
- `civic-hub/ui/src/components/Nav.tsx` — added "Welcome" to `DRAWER_LINKS`
- `civic-hub/ui/src/components/IntroPopup.tsx` — "Learn more" navigates to `/welcome`

### Verified manually

- `/welcome` renders full markdown content (headings, lists, bold, italic, links) for unauthenticated visitor. Document title: "Welcome · Floyd Civic Hub".
- "Download as PDF (4 pages)" link opens the PDF in a new tab.
- Home page shows the "New to the Floyd Civic Hub?" banner between HubInfo and tabs.
- Dismissing the banner (× button) hides it; reload confirms `localStorage` persistence.
- Nav drawer: Feed · Votes · Welcome · About — divider — Send feedback — legal links.
- IntroPopup "Learn more" routes to `/welcome`.
- `npm run build` (tsc) and `npx vite build` both pass cleanly.

### Decisions worth flagging

- **Welcome is standalone, not `LegalPage`.** It reuses the same CSS classes (`legal-page`, `legal-prose`) for visual consistency but doesn't use the `LegalPage` component because it needs utility rows (PDF link, feedback CTA) that `LegalPage` doesn't support. Avoids modifying `LegalPage` and risking side effects on the three legal pages.
- **IntroPopup and WelcomeBanner are independent.** They use separate `localStorage` keys. A first-time visitor may see both; the IntroPopup is a modal that dismisses first, then the banner is visible on the home page. This is acceptable — the popup is a 3-sentence teaser, the banner links to the full introduction.
- **Banner version key.** The key `welcome-banner-dismissed-v1` includes a version suffix. Bumping to `v2` will re-show the banner to all visitors — useful if the welcome content changes significantly.

---

## Test infrastructure + Cron route fix — 2026-05-12

**Status:** Tests passing locally. Cron fix ready for deploy.

### What was built

**Automated test suite (45 tests total):**
- 30 API integration tests (Vitest) covering health/discovery, events, processes, auth, proposals, search
- 15 E2E browser tests (Playwright/Chromium) covering navigation, feed, votes, search
- Shared test helpers in `tests/fixtures/helpers.ts` with auth bypass via CIVIC_DEMO_BYPASS_CODE
- `vitest.config.ts` and `playwright.config.ts` with auto-server-start

**TESTING.md** — living coverage tracker with flow inventory tables and quick-start commands.

**CLAUDE.md updated** — added `npm run test:e2e`, `npx playwright*` to allowed commands; added TESTING.md update requirement to session rules.

**Package.json scripts:** `test`, `test:watch`, `test:e2e`, `test:e2e:ui`, `test:e2e:headed`.

### Cron route HTTP method fix
All four Vercel Cron routes were registered as POST but Vercel Cron sends GET requests, causing 404s in production. Changed `.post()` → `.get()` on:
- `src/routes/floydNewsSyncRoutes.ts`
- `src/routes/digestRoutes.ts`
- `src/routes/meetingSummaryRoutes.ts`
- `src/routes/adminDigestRoutes.ts`

Root cause: the handlers don't read `req.body` and auth uses the `Authorization` header, so GET is the correct method for cron-triggered endpoints.

### Incomplete / needs attention

- **Deploy required** for cron fix to take effect in production
- **ANTHROPIC_API_KEY** and **MEETING_SOURCE_URL** env vars should be verified in Vercel production settings for meeting summary cron to work
- Banner overlay experiment (Floyd county seal) was explored and reverted — no changes shipped

### Commits (in `civic-hub/`)

- `f7b2110` Test infrastructure (Vitest API + Playwright E2E)
- *(cron fix uncommitted — ready for commit)*

---

## Slice 13 — Change-your-vote-while-open + UI polish round — 2026-05-08

**Status:** Shipped to prod (Floyd). Migration applied, all vote/endorsement state wiped on prod for a clean rollout. Verified end-to-end in browser on the live site.

### What was built

**Vote-changing.** Residents can now update their vote any number of times while a vote is `active`. Receipt ID stays stable across changes — any previously-shown receipt still verifies to the user's current choice. Tally updates in real time, post-close anonymity guarantee preserved.

### Trust model

The receipt schema previously enforced a hard rule: `vote_records` and `vote_participation` share no join key. To allow vote-changing the server has to know "this user's receipt is X." We added a *transient* third table, `active_vote_keys (user_id, process_id, receipt_id)`, populated only while a vote is active and cleared on `closeVote`. Post-close, no persisted row links a user to their choice — privacy guarantee is identical to pre-Slice-13.

Paper-ballot mental model: ballots can be changed before the box closes; once closed, only counted ballots remain.

### Backend changes

- `supabase/migrations/20260508120000_active_vote_keys.sql` — new table, `(user_id, process_id)` PK, FORCE RLS.
- `src/modules/civic.receipts/index.ts` — `recordOrUpdateVote` (insert-or-update; same-receipt update path on duplicate participation), `clearActiveVoteKeysForProcess`. Old `recordVote` kept as a deprecated alias. Header rewritten to document the trust model.
- `src/modules/civic.vote/index.ts` — `submitVote` short-circuits same-option re-submits with `unchanged: true` (no spurious events). Read model exposes `your_current_vote`.
- `src/processes/voteProcess.ts` — calls `recordOrUpdateVote`; `process.close` calls `clearActiveVoteKeysForProcess` to drop the bridge.

### Frontend changes

- `ui/src/services/api.ts` — `VoteState.your_current_vote: string | null`.
- `ui/src/components/VotePanel.tsx` — heading flips to "Your vote" once the user has voted; privacy notice mentions change-anytime; all option buttons stay enabled with the current choice highlighted; "Your vote has been updated" copy after a change.

### UI polish (preceded slice 13 in the same session)

- **Vote option buttons** restyled as full-width ballot cards: dark-blue border, light-blue hover, solid filled "voted" state with white checkmark.
- **Content-first layout** on Process detail pages — `IssueContent` now renders before `VotePanel` / `ProposalPanel` / `ProposalCommentForm` so residents read the question and tradeoffs before they act.
- **"Back to votes" pill button** with sticky positioning across Process, ProposalDetail, VoteResults pages.
- **"What happens after this vote?"** heading: added question mark, font-size up to 1.25rem.

### Migrations + data wipe

- `active_vote_keys` table created in **both** dev (`urfmvqhzmamigssqwsya`) and prod (`nfhyypwoporfggqcerli`).
- Per user request, all vote and endorsement actions wiped clean on prod: `TRUNCATE vote_participation, vote_records, active_vote_keys, proposal_supports`; `UPDATE proposals SET support_count = 0`; `state.{votes, supporters, support_count}` reset on every `civic.vote` row. Proposals/votes themselves untouched.

### Edge case worth knowing

If a user votes *before* the migration deploys (i.e. has a `vote_participation` row but no `active_vote_keys` row for an active process), the change-vote path refuses with "You have already voted on this process" — there's no DB-level link to look up their receipt. Mitigated on prod by the wipe; new voters going forward all get the change-vote affordance.

### Commits (in `civic-hub/`)

- `da4889f` Style vote option buttons as full-width ballot cards
- `8eb8b0a` UI polish: content-first layout, pill back-nav, after-vote heading
- `bbc982c` Slice 13: allow residents to change their vote while voting is open

---

## Proposal commenting + comment phase carryover — 2026-05-07 / 2026-05-08

**Status:** Complete and verified in dev browser.

### What was built

**Part 1 — Proposal commenting:** Users can submit free-text comments on proposals in "submitted" or "endorsed" status, using the existing `civic.input` module as the data layer.

**Part 2 — Comment phase carryover:** Comments carry forward from proposals to votes when a proposal is converted. Each comment is tagged with `phase: "proposal"` or `phase: "vote"` and the UI renders phase dividers to distinguish them.

### Backend changes

- `src/controllers/inputController.ts` — `proposalExists()` fallback for 404s. Auto-tags `phase: "proposal"` on proposal comments, `phase: "vote"` on vote comments. GET handler merges proposal-phase comments into vote comment lists when the vote has a `source_proposal_id`.
- `src/modules/civic.input/models.ts` — New `CommentPhase` type, `phase` field on `CommunityInput`.
- `src/modules/civic.input/index.ts` — `submitInput` accepts optional `phase` param, stores via two-step insert+update (workaround for PostgREST schema cache lag).

### Frontend changes

- `ui/src/components/ProposalCommentForm.tsx` — New standalone comment form (textarea + submit, 500-char limit, auth-gated).
- `ui/src/pages/ProposalDetail.tsx` — Mounts `ProposalCommentForm` + `CommunityInputPanel` below endorsement section. Comment form suppressed for converted/archived proposals.
- `ui/src/components/CommunityInputPanel.tsx` — Renders phase dividers ("Comments from the proposal period" / "Comments during the voting period") when comments span both phases.
- `ui/src/services/api.ts` — `CommunityInput` type includes `phase`.
- `ui/src/App.css` — Styles for `.input-phase-divider` and `.proposal-comment-form`.

### Migration

- `supabase/migrations/20260508000000_add_comment_phase.sql` — Adds `phase text` column to `community_inputs`.
- Helper function `set_comment_phase()` created in Supabase for RPC access (workaround for schema cache).
- **Both dev and prod Supabase projects** have the migration applied.

### Spec compliance
- Comments emit `civic.process.comment_added` events (inherited from `civic.input` module)
- Admin moderation (hide/restore) works on proposal comments (inherited from `CommunityInputPanel`)
- `civic.input` module stays decoupled — no import of `civic.proposals`

### Note on Supabase environments
Dev and prod are separate Supabase projects. Schema migrations must be applied to both. Dev = `urfmvqhzmamigssqwsya`, Prod (Floyd) = `nfhyypwoporfggqcerli`.

---

## Slices 16 → 19d + demo-hub.civic.social launch — 2026-04-29 / 2026-04-30

**Status:** Shipped end-to-end. The hub evolved from single-tenant Floyd to multi-deployment-capable, and the first non-Floyd deployment — a public demo set in the fictional Town of Athens, Virginia — is live at `demo-hub.civic.social`. Eight related slices landed across two sessions, each individually-revertible but stronger together.

**Net effect:**
- Floyd production runs unchanged at `floyd.civic.social`.
- A public demo (`demo-hub.civic.social`) shows the same product running for a fictional jurisdiction. Same `main` branch, same codebase, different env vars + different Supabase + different Vercel project. Sign in with code `123456` (no real OTP email is sent).
- The same multi-deployment recipe can spin up additional hubs (other counties, other towns) without code changes.

### Slice 16 — Admin queue digest (`ff87d48`)

A new daily cron emails admins a digest of pending-review queue items: civic proposals awaiting review, vote results awaiting approval, meeting summaries awaiting publication. Empty digests skipped silently (matches user-digest pattern).

- Module: `civic-hub/src/modules/civic.admin_digest/{models,service,index}.ts` — `buildAdminDigest()` reads queues; `renderAdminDigestEmail()` produces subject/html/text; `runAdminDigest(recipients[])` fans out via Resend.
- Controller + route: `POST /internal/admin-digest/run` (CRON_SECRET bearer) at 13:30 UTC daily — after meeting-summary (11:30) and floyd-news-sync (12:00) so the day's freshly-ingested items are already in the queue.
- Email subject pattern: `[Floyd Civic Hub] Admin queue: 2 proposals, 1 vote result, 7 meeting summaries`. Each non-empty queue gets a section with up to 5 items + "+ N more" overflow + deep link to the panel. Brand-navy headings; pluralization correct.
- Optional kill switch: `ADMIN_DIGEST_ENABLED` (default true). New `scripts/dryRunAdminDigest.ts` for verifying payload + render against dev Supabase without dispatching.
- No new schema, no new env var beyond the optional kill switch. Reuses CRON_SECRET, CIVIC_ADMIN_EMAILS, RESEND_API_KEY, RESEND_FROM, HUB_NAME.

### Slice 17 — Clickable digest rows (`2a10ab0`)

Every row in the user-facing digest email (`civic.digest/service.ts::renderGroupHtml`) is now wrapped in a single `<a href="..." style="display:block;text-decoration:none;color:inherit;">` so the entire row — title, summary, pill, whitespace — is one click target. The previous design only made the title and thumbnail clickable; pill and gaps were dead pixels.

- Inner anchors removed (nested anchors are invalid HTML).
- Title is now a `<span>` with the same color/weight; outer wrapper-anchor routes the click.
- New 16px chevron (`>`) column on the far right in muted gray (`#9ca3af`) — reads as "tap me / there's more" without the blue-underlined-link look.
- Architectural property: every digest item, regardless of `DigestItemKind` (announcement / vote_open / vote_results / meeting_summary), flows through this single template. Future kinds inherit the affordance with no per-kind work; only `PILL_COLORS[kind]` differs per type.
- Plain-text path unchanged — plaintext rows already include both title and URL on each item.

### Slice 17.1 — Shortened event pill labels (`c9ce641`)

Pill labels were doing two jobs (role + type) and wrapping rows on longer authors. The section context already says "Announcements" — the trailing " announcement" suffix was redundant. "Government" was the biggest contributor to width.

Two rules applied to both feed pill renderer (FeedPost.tsx) and digest pill renderer (civic.digest/service.ts):

1. Drop trailing " announcement" — `"Admin announcement"` → `"Admin"`, `"Floyd County Government announcement"` → `"Floyd County Government"`, etc.
2. Abbreviate `\bGovernment\b` → `Gov` via a small case-insensitive helper. `"Floyd County Government"` → `"Floyd County Gov"`.

Both helpers (`abbreviateGovernment`) are documented as MUST-stay-in-sync between the email and the feed surfaces. Floyd's "FLOYD COUNTY GOV" pill on synced announcements visibly cleaner; row never wraps.

Tracking issue [civic-hub#11](https://github.com/creatinglake/civic-hub/issues/11) opened for a future polish slice that adds per-kind icons (megaphone / ballot / etc.) to pills — discussed and deliberately deferred. Pill colors already discriminate kind.

### Slice 17.2 — Mobile same-tab, desktop new-tab for external links (`a73a04d`)

The Floyd-news-sync feed cards (and any other external-`action_url` posts) were unconditionally opening in a new tab via `target="_blank"`. On mobile, that loses iOS Safari's native "back to Floyd Civic Hub" chip and forces a tab-switcher trip to return. On desktop, multi-tab is the dominant research pattern and works fine.

- New `ui/src/hooks/useIsWideViewport.ts` — `useSyncExternalStore`-backed hook over `matchMedia('(min-width: 769px)')`. Re-evaluates live on viewport resize. SSR-safe (defaults to true on server; client hydrator updates on mount).
- `FeedPost.tsx`: external-link anchors spread `{...(isWideViewport ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" })}`. Internal SPA `<Link to=...>` routes unchanged.
- Power users can still Cmd-click / middle-click to force a new tab on either device.
- The 769px breakpoint matches the existing mobile/desktop cutover used by `Nav.css`'s hamburger toggle and `Feed.css`'s image-stacking.

### Slice 18 — Env-driven hub branding (`e157f76`, `df12383`)

Refactor the UI to read all hub-branding values from `VITE_HUB_*` build-time env vars, with Floyd defaults baked in. This is the core unlock for multi-deployment: the same `main` branch can power Floyd production AND a separate demo Vercel project, each with its own name, banner, jurisdiction, tagline, and metadata via Vercel env-var overrides.

Env-driven:
- `VITE_HUB_NAME` — wordmark / display name (top nav, footer, intro popup, etc.)
- `VITE_HUB_JURISDICTION` — geographic place (banner, residency copy)
- `VITE_HUB_LABEL` — small-caps type label under the jurisdiction
- `VITE_HUB_TAGLINE` — one-sentence tagline
- `VITE_HUB_BANNER_URL` + `VITE_HUB_BANNER_ALT` — banner image path + alt text
- `VITE_HUB_PAGE_TITLE` + `VITE_HUB_DESCRIPTION` — browser tab title + meta description (also og:title / og:description)

Files:
- `civic-hub/ui/src/config/hub.ts` — reads `import.meta.env.VITE_HUB_*` with Floyd defaults baked in via `??` fallbacks.
- `civic-hub/ui/index.html` — title and OG metadata use Vite's native `%VITE_VAR%` substitution so per-deployment values bake in at build time.
- Component updates: Nav.tsx (wordmark), App.tsx (footer brand), IntroPopup.tsx, ReAcceptModal.tsx, AuthModal.tsx, Settings.tsx, Search.tsx — all source from `hub.*` instead of hardcoded "Floyd Civic Hub" strings.
- New `civic-hub/ui/.env` — committed Floyd defaults for index.html `%VAR%` substitution. Whitelisted in `.gitignore` (existing `.env` rule was hiding it). UI env file holds only public branding strings — secrets stay in `civic-hub/.env` which remains gitignored.
- New `civic-hub/ui/.env.example` — operator-facing docs with a demo-deployment override example.

Two layers of Floyd defaults (committed `ui/.env` values + `??` fallbacks in code) ensure Floyd's strings are present even if one mechanism somehow fails. Floyd production rendered identically before/after merge.

### Slice 19a — Governance terminology env vars (`ba084c3`)

Slice 18 covered branding (name, banner, etc.) but didn't generalize **governance-specific copy** — "Board of Supervisors," "BOS meeting summary," the IntroPopup body referencing "Floyd County residents," the AuthModal residency-step intro. Those stayed Floyd-specific until Slice 19a.

New env vars (all Floyd-defaulted):
- `VITE_HUB_GOVERNING_BODY_NAME` (long form, e.g. `"Board of Supervisors"` / `"Town Council"`) — used in delivered-to text, admin pages, vote-results subline.
- `VITE_HUB_GOVERNING_BODY_SHORT` (abbreviation, e.g. `"BOS"` / `"Town Council"`) — used in pill labels and filter labels where width matters.
- `VITE_HUB_INTRO_BODY` — full freeform paragraph for the IntroPopup welcome copy. Different jurisdictions need genuinely different framing here, so it's a body-level override rather than a templated placeholder.
- `VITE_HUB_RESIDENCY_INTRO` — single sentence for the AuthModal residency-step description.

Components updated to source from these:
- `IntroPopup.tsx` (body uses `hub.intro_body`)
- `AuthModal.tsx` (residency-step description uses `hub.residency_intro`)
- `FeedPost.tsx` (meeting-summary pill `${hub.governing_body_short} meeting summary`; vote-results delivered-to uses `hub.governing_body_name`)
- `FeedFilter.tsx` (meeting-summary filter pill uses `${hub.governing_body_short} meeting summaries`)
- `VoteResults.tsx` (both delivered-to renderings)
- `AdminMeetingSummaries.tsx` (title placeholder + page subtitle)
- `AdminVoteResults.tsx` (page subtitle)
- `Propose.tsx` ("official advisory vote" copy uses `hub.jurisdiction`)

Out of scope: `About.tsx` is deeply Floyd-specific content; deferred. Demo's About page still shows Floyd content. Either hide the link via a flag or replace with generic copy in a future slice.

### Slice 19b — Athens seed fixture + selector (`ba084c3`)

New seed-data file (`src/debug/seedDataAthens.ts`) mirroring `seedData.ts` but rebranded for the fictional Town of Athens, Virginia. Same civic issues (green-box dumpsters, Flock Safety cameras) — those topics generalize cleanly across jurisdictions — but every Floyd-specific name, body, and after-vote recipient swaps to Athens-equivalent. Two scenarios:

- `ATHENS_GREEN_BOX` — active vote, "Should the town of Athens invest in additional fenced-in dumpster sites?" Three options, 14-day voting window, direct activation.
- `ATHENS_FLOCK_CAMERA` — proposed (gathering-support) vote, recipients `Athens Town Council` + `Athens Police Department`, three pre-loaded support actions, three pre-loaded community comments.

Selector: `autoSeed.ts::selectScenarios()` reads `CIVIC_SEED_FIXTURE` env var.
- `floyd` (default) → Floyd scenarios
- `athens` → Athens scenarios
- unknown values → log warning + fall back to Floyd

`.env.example` documents the var with the demo example.

What's NOT in this slice (deferred):
- Athens announcement seed scenarios. The current `SeedScenario` shape works for `civic.vote` and `civic.proposal` but not for `civic.announcement` (announcements emit `result_published` outside the standard handler-action flow).
- Athens Town Council meeting summary scenarios. Same reason — `civic.meeting_summary` uses a different creation flow.

Extending `runScenario()` to support those is a follow-up.

### Slice 19c — Skip OTP email on demo deployments (`385f095`, `b286e6d`)

When `CIVIC_DEMO_BYPASS_CODE` is set on a deployment (the public demo at `demo-hub.civic.social`), `requestVerification()` short-circuits before:

1. Generating an OTP
2. Inserting a `pending_verifications` row
3. Calling `sendEmail()` via Resend

Effects on the demo:
- No real emails go to throwaway / fake addresses (sender-rep risk eliminated).
- Resend quota isn't burned for demo signups.
- Visitors who don't expect an email don't get one with a different code than the IntroPopup told them to use.

Why it's safe: `verifyCode()` already accepts the bypass code without needing a `pending_verifications` row (the existence check is wrapped in `if (pending) { delete }` — just cleanup, not a precondition). Floyd production has `CIVIC_DEMO_BYPASS_CODE` unset → the new short-circuit branch never fires → existing OTP flow byte-identical.

### Slice 19d — Athens announcements + Town Council meeting summaries in seed (`8aaafab`, `4f73fc9`)

The Slice 19b seed only had 2 votes (Green Box + Flock Cameras), leaving the demo's Announcements / Meeting summaries / Vote results filter pills empty. Slice 19d fills out the rest of the feed so the demo at `demo-hub.civic.social` looks lived-in rather than half-populated.

Seed runner extended (`src/debug/autoSeed.ts`):
- `runScenario()` now dispatches by process type:
  - `civic.vote` / `civic.proposal`: existing path (action loop + civic.input community comments)
  - `civic.announcement`: new `runAnnouncementSeed()` — calls `emitPublicationEvents()` (which fires `created` + `result_published`) and finalizes the row, mirroring how floyd-news-sync and the announcement controller publish.
  - `civic.meeting_summary`: new `runMeetingSummarySeed()` — `emitCreationEvents()` then `approveMeetingSummary()` then finalize. Walks the state machine `pending → approved → published` so demo summaries appear in the public feed without an admin step.
- `SeedScenario.actions` made optional (announcement + meeting summary scenarios don't use it). `debugController.ts` updated to handle undefined `actions[]`.

Athens content (`src/debug/seedDataAthens.ts`):
- 6 announcements: Town Council Meeting May 7, water main flush, spring festival, park benches survey, downtown sidewalk project, recycling pickup change. Author role `"Town of Athens Government"` — abbreviated to "Town of Athens Gov" in the pill via Slice 17.1's `abbreviateGovernment` helper.
- 2 published meeting summaries: April 23 regular meeting (FY26 budget first reading, sidewalk contract award, recycling renewal, public comment) and April 16 budget workshop (department-by-department review). Block structure mirrors the AI pipeline output: 4–5 topic blocks per meeting, each with title + narrative summary, `action_taken` flagged where votes/motions were taken. `start_time_seconds` is null (no real recording).

Selector updated:
- `selectScenarios()` in `autoSeed.ts` spreads `ATHENS_ANNOUNCEMENTS` and `ATHENS_MEETING_SUMMARIES` alongside the two votes when `CIVIC_SEED_FIXTURE=athens`.
- Order: votes → announcements → meeting summaries.

Operational gotcha worth recording for future seed-fixture work:
- The auto-seed has a `seedPromise` memoization within a single serverless instance. After a wipe, just hitting the demo URL won't trigger a fresh seed if the running function instance has already memoized "seed ran, skipped." Force fresh instances via a Vercel manual redeploy (Deployments → ... → Redeploy, uncheck cache) after any wipe-then-reseed flow.
- Even with that, ordering matters: if a request hits the demo between a wipe and a code-deploy that introduces new scenarios, the OLD code's seed runs first and populates the OLD scenario set, blocking the new code's seed via the `count > 0` guard. Recipe: code-deploy first (so the new code is the only code reachable), THEN wipe, THEN manual redeploy. We hit this once during Slice 19d's first activation — recovery was re-wipe + manual redeploy.

### demo-hub.civic.social — operator runbook

Documenting the recipe for spinning up a non-Floyd hub from the same codebase. To create another (e.g. for a different county or another demo), repeat with different values.

**1. Supabase project**
- Create new Supabase project (Pro tier required if you already have 2 projects on the org).
- Region: match Floyd's (East US — N. Virginia) for consistency.
- Apply all 10 migrations from `civic-hub/supabase/migrations/*.sql` in chronological order via the SQL Editor (each as a separate paste-and-run; clear the editor between each so leftover SQL doesn't replay).

**2. Vercel project**
- New Project → import the same `creatinglake/civic-hub` repo.
- Project name unique (cannot duplicate Floyd's `civic-hub`). Used `civic-hub-demo` for the demo.
- Framework Preset: **Other** (NOT Express). Express expects a server entrypoint in the build output; we have a static SPA + `api/index.ts` serverless function.
- Root Directory: `civic-hub`.
- Build/Output settings: don't override — `vercel.json` provides them.

**3. Env vars (Production scope, Production+Preview is also fine)**
- Demo-specific values: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from the new Supabase), `BASE_URL` and `CIVIC_UI_BASE_URL` and `CIVIC_ALLOWED_ORIGINS` set to `https://demo-hub.civic.social`, `CIVIC_ALLOW_SEED=true`, `CIVIC_DEMO_BYPASS_CODE=123456`, `CIVIC_SEED_FIXTURE=athens`, `HUB_NAME=Athens Civic Hub`, `DIGEST_ENABLED=false`, `ADMIN_DIGEST_ENABLED=false`, `MEETING_SUMMARY_ENABLED=false`, `FLOYD_NEWS_SYNC_ENABLED=false`.
- Copied from Floyd: `RESEND_API_KEY`, `RESEND_FROM`, `CIVIC_ADMIN_EMAILS` (or generated fresh).
- Generated fresh: `CRON_SECRET` and `DIGEST_UNSUBSCRIBE_SECRET` via `openssl rand -hex 32`.
- Skipped: `ANTHROPIC_API_KEY` (only needed when meeting-summary is enabled).
- Slice 18/19a UI overrides: `VITE_HUB_NAME`, `VITE_HUB_JURISDICTION`, `VITE_HUB_LABEL`, `VITE_HUB_TAGLINE`, `VITE_HUB_BANNER_URL` (kept Floyd's `/floyd-banner.jpg` for v1 — it's a generic-looking small-town photo), `VITE_HUB_BANNER_ALT`, `VITE_HUB_PAGE_TITLE`, `VITE_HUB_DESCRIPTION`, `VITE_HUB_GOVERNING_BODY_NAME=Town Council`, `VITE_HUB_GOVERNING_BODY_SHORT=Town Council`, `VITE_HUB_INTRO_BODY` (Athens demo welcome), `VITE_HUB_RESIDENCY_INTRO` (Athens residency intro).

**4. Custom domain**
- Vercel demo project → Settings → Domains → add `demo-hub.civic.social`.
- Vercel emits a CNAME instruction; add the record at the registrar where `civic.social` is registered (subdomain part only as the Name field; full target as Vercel's `cname.vercel-dns.com`).
- Wait 5–30 minutes for DNS propagation + Vercel auto-provisioned SSL cert.

**5. First seed**
- After deploy, the auto-seed middleware runs on first request. It checks the processes table and skips if any rows exist, so wipe the table first if it has stale data:

```sql
DELETE FROM events;
DELETE FROM community_inputs;
DELETE FROM proposal_supports;
DELETE FROM vote_records;
DELETE FROM vote_participation;
DELETE FROM proposals;
DELETE FROM processes;
```

Order matters because of foreign keys. After the wipe, redeploy (Vercel → Deployments → ... → Redeploy, uncheck cache to force fresh function instances). On the first request after redeploy, the auto-seed runs and loads `CIVIC_SEED_FIXTURE` value's scenarios.

### Verified end-to-end

- Floyd production rebuilt after each merge — every visible surface unchanged.
- Demo deploy at `demo-hub.civic.social`: Athens-branded chrome (wordmark, banner, footer, tab title), Athens IntroPopup welcome, Athens-jurisdiction residency intro, Athens-themed seeded votes (Green Box + Flock Cameras), no OTP email sent on signin (verified — entered `test@notreal.test`, got signed in via `123456` code, no email arrived).
- Custom domain `demo-hub.civic.social` resolves with valid HTTPS.
- Backend `npm run build` clean across all six slices.
- UI `npm run build` clean.

### What's still open / future polish (not blocking)

- **Athens-specific banner image** — currently `/floyd-banner.jpg`. Drop a generic small-town image into `civic-hub/ui/public/demo-hub-banner.jpg` and flip `VITE_HUB_BANNER_URL` on the demo project.
- **Athens announcements + Town Council meeting summaries in seed data** — requires extending `runScenario()` to support `civic.announcement` and `civic.meeting_summary` creation flows. Would make the demo feel more lived-in (current demo has only the 2 votes and an empty rest-of-feed).
- **About page demo content** — still shows Floyd content. Either hide via a `VITE_HUB_HIDE_ABOUT` flag or override copy with `VITE_HUB_ABOUT_BODY`. Lowest priority — most demo visitors don't reach `/about`.
- **`%VITE_VAR%` build warning** — from a literal `%VITE_VAR%` string in an HTML comment in `index.html`. Cosmetic only; build still succeeds. Worth a small polish commit.
- **Email scope hygiene on Floyd Vercel project** — pre-existing flag from Vercel's "Needs Attention" warning that `RESEND_API_KEY` is set in all environments instead of Production-only. Best-practice cleanup; not urgent. Tracked under email deliverability section of [civic-hub#13](https://github.com/creatinglake/civic-hub/issues/13).

### Tracking issues opened during the work

- [civic-hub#11](https://github.com/creatinglake/civic-hub/issues/11) — per-kind pill icons (deferred polish from Slice 17.1)
- [civic-hub#12](https://github.com/creatinglake/civic-hub/issues/12) — pre-scale safety net (tests, CI, error tracking, cron alerts)
- [civic-hub#13](https://github.com/creatinglake/civic-hub/issues/13) — scale concerns (rate limiting, /events pagination, digest batching, email deliverability)
- [civic-hub#14](https://github.com/creatinglake/civic-hub/issues/14) — demo deployment runbook (now mostly fulfilled by this slice — keep open as the canonical reference for spinning up future hubs)

### Multi-tenant SaaS path — context for future-you

What landed in this batch is **multi-deployment**: one codebase serves multiple Vercel projects, each fully isolated (separate Supabase, separate domain, separate env vars). Adding a new hub today is manual operator work (~15-30 min following the runbook above).

To get to **multi-tenant SaaS** (one deployment serves many tenants, self-service onboarding, single bill, RLS-isolated data) you'd:
1. Move the `VITE_HUB_*` config from env vars into a `tenants` DB table with the same field shape
2. Add tenant-resolver middleware that reads request hostname and picks the right tenant row
3. Replace `import.meta.env.VITE_HUB_NAME` etc. with `tenant.name` from the resolved row
4. Move data isolation from "separate Supabase" to "tenant_id column on every table + RLS policies"
5. Build a `/admin/new-hub` self-service flow

The config schema you've now validated in production (`name`, `jurisdiction`, `governing_body_name`, `intro_body`, `residency_intro`, etc.) transfers directly. Today's work proves the schema; the migration to SaaS is mechanical, not exploratory. Natural moment to commit: when manual setup becomes a bottleneck (e.g. 10+ hubs) or a paying customer needs self-service onboarding.

---

## Slice 15 — Share votes (Web Share + clipboard fallback) — 2026-04-29

**Status:** Shipped end-to-end to production (civic-hub commit `94be093`). A single "Share" button on `/process/:id` and `/proposal/:id` opens the OS-native share sheet on mobile / modern desktop browsers and falls back to copying the URL to the clipboard everywhere else. Static `og:image` added to `index.html` so paste-and-unfurl renders a clean preview card in iMessage, WhatsApp, Facebook groups, and Slack.

### Decisions worth flagging

- **No platform-specific buttons.** Civic content gets shared into Facebook groups, iMessage threads, WhatsApp DMs, neighborhood listservs — not posted to public Facebook / X walls. The OS share sheet covers all of those; per-platform buttons cover one each and clutter the UI. The user explicitly noted this mid-design and the implementation reflects it.
- **Web Share API → clipboard → inline error.** Three-stage fallback. `navigator.share` when available; on `AbortError` (user dismissed the sheet) we silently exit; on any other share-API failure we fall through to `navigator.clipboard.writeText` so an iOS quirk or permission denial doesn't strand the user. Clipboard failure shows "Couldn't copy the link. Try selecting the URL in the address bar." for 4s. Real browser context succeeds at one of the first two paths in practice.
- **Status-gated visibility.** The button only renders where sharing actually drives action:
  - `/process/:id`: `civic.vote` in `{active, proposed, threshold_met}`; `civic.proposal` (process type) until status === `closed`.
  - `/proposal/:id`: `civic-proposal` (the user-suggested-issue flow) in `{submitted, endorsed}`.
  - Suppressed for `closed` / `finalized` / `converted` / `archived`. The URL still works for anyone who copies from the address bar; the button presence is a CTA, and there's no CTA value once voting has ended.
- **Skip the listing pages for v1.** `/votes` and `/` show many cards; per-card share buttons would multiply CTA noise and most users don't share from a list. Detail pages only — once the user has committed to reading.
- **Single shareText shape per surface.** Active votes get `"Vote on: <Title>"`; proposals get `"Endorse this proposal: <Title>"`. Some apps (Twitter, SMS) pre-fill this in the body; others (iMessage) attach it as a separate line; some ignore it entirely. The URL does the heavy lifting; the text is a contextual nudge.
- **Static `og:image` only — per-vote OG deferred.** Paste-and-unfurl preview cards in iMessage / WhatsApp / Facebook / Slack now show the Hub banner + generic title + generic description. Per-vote unfurls (showing the actual vote title and description) would require a Vercel bot-detection rewrite that returns server-rendered HTML for known crawler User-Agents — the SPA can't inject `<meta>` tags for crawlers because crawlers don't run JavaScript. Tracked as a Slice 15.1 candidate if real residents share enough that the generic-card-for-every-link feels lossy.
- **Pill style + size matches the brand action color, not a system "share" affordance.** Navy-on-white at 36px tap height with a chain-link icon — same palette as the Suggest-a-vote CTA so the surface reads as a primary civic action, not a generic OS button. Variant prop ("default" / "ghost") is in the component for future reuse but only "default" is consumed today.
- **No analytics event for share initiation.** A `civic.share_initiated` event was considered and skipped — the click is a UX moment, not a civic action. If sharing volume becomes a real metric later, it goes through whatever frontend telemetry pipeline lands first (none today).

### Files added / changed

UI only (no backend / migration / new env vars):
- `civic-hub/ui/src/components/ShareButton.{tsx,css}` (new) — reusable component, two visual variants, inline error state, copy-success flash.
- `civic-hub/ui/src/pages/Process.tsx` — mounts `<ShareButton>` between the meta row and the interaction panel; status-gated for `civic.vote` and `civic.proposal` process types.
- `civic-hub/ui/src/pages/ProposalDetail.tsx` — same pattern for the user-facing civic-proposal flow in `submitted` / `endorsed` states.
- `civic-hub/ui/src/App.css` — `.process-share-row` spacing rule (negative top margin + 2rem bottom to sit cleanly below the meta row without doubling its bottom margin).
- `civic-hub/ui/index.html` — added `og:image` (`/floyd-banner.jpg`), `og:image:alt`, and `twitter:card=summary_large_image`. The pre-existing `og:title` + `og:description` + `og:type` stayed.

### Verified manually (in dev preview)

- Active vote (`proc_greenbox_floyd_001`, status=active): "Share" button renders with `aria-label="Share: Add More Secure Dumpster (Green Box) Sites"`, sits between meta row and the Cast Your Vote panel.
- Proposed vote (`proc_flockcam_floyd_001`, status=proposed): "Share" renders with the "gathering support" badge, same placement.
- `navigator.share` is undefined in the Chromium preview iframe → falls through to `navigator.clipboard.writeText` → that's blocked without a trusted user gesture → inline error renders correctly. The path is provable; the surface that fails in iframe succeeds on a real device.
- Build clean both roots; no console errors.

### Deploy

`git push origin main` → Vercel production build. No migration, no new env vars, no admin setup. Pure UI ship.

### Trade-offs / future work

- **Per-route OG tags would land bigger unfurl cards.** A `vercel.json` rewrite + a Vercel Edge / serverless function that returns server-rendered HTML for known crawler User-Agents (Twitterbot, facebookexternalhit, WhatsApp, Slackbot, Discordbot, LinkedInBot, etc.) would inject the actual vote title / description / image into the unfurl. Hold until residents actually share enough that generic-card-for-every-link feels lossy.
- **`og:image` is a static banner — no per-vote graphic.** Even with per-route OG, drawing a per-vote card image (e.g. dynamic SVG with vote title + tally + Hub branding) is a separate slice. Cheapest path: a Vercel Edge function with `@vercel/og` rendering a templated card. Worth doing if and only if per-vote OG ships first.
- **No share counter / analytics.** Both share initiations and successful copies are silent. If later we want to measure which votes get shared most, the natural surface is a `POST /process/:id/share-initiated` ping with no body — keeps it out of the events table and out of `/events`, since this is product telemetry, not civic action.
- **`shareText` is hard-coded per surface.** "Vote on: <Title>" / "Endorse this proposal: <Title>" — fine for v1. If different surfaces want different framing later (e.g. results pages saying "See the result of: <Title>"), the prop is already there.
- **Component supports a "ghost" variant that's unused today.** Outlined instead of filled. Kept in the component because if any second placement appears (e.g. inline next to a result-card link), a less-prominent variant is one prop away.

---

## Slice 14 — Send feedback (form + drawer/footer link + persistence) — 2026-04-29

**Status:** Shipped end-to-end to production (civic-hub commit `b05b276`). A new operator-facing `/feedback` page captures product feedback (idea / bug / moderation / general), persists it to a new `feedback_submissions` table, and best-effort emails the operator. "Send feedback" links live in the drawer secondary group (above the legal docs) and in the footer.

### Decisions worth flagging

- **"Send feedback", not "Contact".** Active language signals we want input, not just an escape hatch. "Contact" reads as customer support; "Send feedback" frames the surface as catching feature requests, moderation flags, and general thoughts equally. One label, not three (Contact / Feedback / Suggest), so the user doesn't have to choose between near-synonyms.
- **Single page, four-pill category.** Idea / Bug / Moderation / General as radio pills with per-pill hint text. The form server-validates the category against an enum-style CHECK constraint, so any client-side bypass returns a 400. Tagging at submit time is cheaper than triaging by reading every message later.
- **Honeypot, not CAPTCHA.** A `.fb-honeypot` `<input>` rendered off-screen at `left: -9999px` with `tabIndex={-1}`. Real users never see it; bots that auto-fill every field trip it. The controller returns 200 with a normal success shape when the honeypot is set, so spammers can't probe the difference between accept and reject. No CAPTCHA, no rate limit, no stored IP — start simple.
- **Anonymous and authenticated both work; signed-in users get auto-attribution.** When a Bearer token is present and valid, the controller resolves it to a `user_id` and stores that on the row. The form omits the name/email inputs in that case (they're redundant — the user record has them). When unauthenticated, name + email are optional and free-text. The endpoint never requires auth; legal-text changes, moderation flags, etc. shouldn't be gated.
- **Persistence outside the events table.** `feedback_submissions` is its own table — feedback isn't a civic event (it's operator-facing product input) so it doesn't flow through `emitEvent()` and never appears on `/events`. The naming `civic.feedback` mirrors the other module folders for consistency, but that's surface-level only — the spec compliance bar at "all civic actions emit events" doesn't apply because feedback isn't a civic action.
- **`user_id` is `ON DELETE SET NULL`.** A self-service account deletion (Slice 13.11) preserves the feedback row but drops attribution. Operator triage value persists; the deleted user's identity goes. Same anonymization model as comments and endorsements.
- **Operator email is best-effort, never blocks success.** `submitFeedback()` returns the persisted row regardless of mail-send outcome. A failure logs `[feedback] Operator email NOT sent for fb_xxx: <reason>` and the operator backfills via DB triage. Users see "Thanks for the feedback" either way.
- **Drawer placement: secondary link above legal, with primary-link styling.** The drawer used to be `[Feed · Votes · About] → divider → [legal links, muted]`. Slice 14 adds a `DRAWER_SECONDARY_LINKS` group between the divider and the legal block — currently just `Send feedback`, rendered with the regular `civic-nav-drawer-link` style (full weight, normal size). The muted `civic-nav-drawer-link-legal` styling is reserved for the policy reference links; "Send feedback" is an active-input affordance and reads as more inviting at full weight.
- **Footer order: Send feedback · Privacy · Terms · Code of Conduct.** "Send feedback" leads because it's the action item — an aria-label change to `"Legal and feedback"` reflects the broadened group.
- **Maintainer vs. admin separation noted, but deferred.** During verification the user asked who receives the operator email. Today the recipient is a single env var (`FEEDBACK_RECIPIENT_EMAIL`, fallback `contact@civic.social`) — fine for a single-operator hub. The bigger architectural split (admin = community moderator, multiple per hub; maintainer / operator = instance runner, one per hub) wasn't necessary to address for v1. Future Slice 14.1 candidate: add an `operator_email` field to the existing `hub_settings` row (Slice 4.2) and surface it on `/admin/settings`.

### Files added / changed

Backend (`civic-hub/src/`):
- `supabase/migrations/20260429000000_feedback_submissions.sql` (new) — table, two CHECK constraints, two indexes (created_at DESC, category).
- `modules/civic.feedback/{models,service,index}.ts` (new) — types, validation (`FeedbackValidationError`), persistence, operator-email render.
- `controllers/feedbackController.ts` (new) — `handleSubmitFeedback` with honeypot drop, optional bearer→`user_id` resolution.
- `routes/feedbackRoutes.ts` (new) — mounts `POST /` (parent path = `/feedback`).
- `app.ts` — mounts `/feedback`; doc string lists `POST /feedback`.

Frontend (`civic-hub/ui/src/`):
- `pages/Feedback.tsx`, `pages/Feedback.css` (new) — pill radios, message + counter, name/email (anonymous-only), signed-in pre-fill notice, mailto fallback (inline-on-error and footer-affordance), success state with thank-you copy.
- `services/api.ts` — `submitFeedback()` client + `FeedbackCategory` type.
- `App.tsx` — `/feedback` route + footer "Send feedback" link (footer aria-label updated to "Legal and feedback").
- `components/Nav.tsx` — `DRAWER_SECONDARY_LINKS` array, rendered with primary drawer-link styling between the divider and the legal group.

### Verified end-to-end (in production)

- Migration applied to prod Supabase via SQL editor before code deploy. Pure additive — no existing rows touched, no schema altered, reversible with `DROP TABLE feedback_submissions`.
- `git push origin main` triggered Vercel production deploy of commit `b05b276`.
- `/feedback` renders cleanly: heading, four category pills with switching hint text, message textarea + character counter (4000 cap), name/email (anonymous), submit gating on non-empty message, mailto fallback, off-screen honeypot.
- Submitted a real test feedback as the production operator; row persisted to `feedback_submissions`; operator email arrived in inbox (Resend delivery against `FEEDBACK_RECIPIENT_EMAIL` after the operator set it in Vercel Production-scope env vars).
- Drawer order verified: `Feed · Votes · About → divider → Send feedback (full weight) → Code of Conduct · Privacy · Terms (muted)`.
- Footer order: `Send feedback · Privacy · Terms · Code of Conduct`.
- No console errors.

### Deploy sequence used

1. Run migration against prod Supabase (paste SQL in Supabase SQL editor).
2. `git push origin main` from `civic-hub/` → Vercel production build.
3. Verify on prod URL.

User opted to skip the staging-preview verification step for Slice 14 — the migration is purely additive and the new code path is isolated (no existing endpoint touched), so the blast radius if anything broke would have been contained to `/feedback` itself. Pattern not recommended as a default; was acceptable here because the surface is genuinely new and self-contained.

### Trade-offs / future work

- **Operator-email recipient is an env var, not an admin setting.** `FEEDBACK_RECIPIENT_EMAIL` (Production scope in Vercel). If/when the maintainer rotates or the hub is operated by someone without Vercel dashboard access, lift this into `hub_settings` and surface on `/admin/settings` (Slice 14.1 candidate — see "maintainer vs. admin" decision above).
- **No admin triage UI.** Submissions live in the DB only. Admins read them via Supabase or a future `/admin/feedback` list view. For Floyd's submission volume that's fine; revisit when triage friction shows up.
- **Honeypot only.** No rate limit, no IP logging, no CAPTCHA. If real spam volume materializes the next escalations are: (1) per-IP rate limit (1/minute, say) using an in-memory or Redis counter; (2) Resend's bot-detect SDK; (3) Cloudflare Turnstile. Hold until needed.
- **No edit / delete after submit.** Submissions are write-once from the user's perspective. If a user types a typo and submits, they'd need to send a second submission with a correction. Acceptable for v1.
- **Anonymous email field doesn't validate beyond browser-default.** The form uses `<input type="email">` so the browser blocks obviously malformed addresses, but the server doesn't re-validate. Worst case is a feedback row with a junk `email` string, which doesn't break anything — operator just can't reply.

---

## Slices 13 → 13.11 — Floyd news auto-sync + auth modal hardening + self-service account deletion — 2026-04-28 / 2026-04-29

**Status:** Shipped end-to-end across the civic-hub subrepo (commits `5ab62cd` → `c536194`, plus housekeeping `c72b178`). Three loosely-related threads landed in this batch — a new ingestion module that auto-publishes Floyd County news posts as announcements, a hardening pass on the sign-in / sign-up flow, and a self-service account-deletion control in Settings. They're consolidated here because they shipped in one continuous push and share no cross-cutting refactor; each sub-slice is independently revertible.

> **Repo note:** these commits live in the `civic-hub/` subrepo, which has its own git history separate from the mono-repo root. This HANDOFF entry lives in the mono-repo as the canonical build log; the per-commit messages in `civic-hub/` are the detail source.

### Slice 13 — `civic.floyd_news_sync` module (`5ab62cd`)

A new module under `civic-hub/src/modules/civic.floyd_news_sync/` that pulls posts from `floydcova.gov/news` daily and creates one `civic.announcement` per new post, auto-published to the feed and digest. Click on the synced feed card opens the post on Floyd's site externally — no admin review queue, no internal `/announcement/:id` page navigation.

- `POST /internal/floyd-news-sync/run` (CRON_SECRET bearer) discovers entries via `fetchHtml` + cheerio trim + Claude extraction (later replaced — see 13.1).
- Date filter excludes entries with a strictly-past `event_date` in the title or URL slug. Open-ended announcements (null date) and future-dated events are kept.
- Dedupe is by `share_url` against existing `civic.announcement` rows. One row per `share_url`, ever — re-runs are idempotent.
- Per-run cap defaults to 3 (`FLOYD_NEWS_SYNC_MAX_PER_RUN`).
- Daily Vercel Cron at 12:00 UTC, between digest and meeting-summary crons in `vercel.json`.

`civic.announcement` extension to support synced posts:
- Optional `state.source` field `{ origin: "floyd-news"; share_url; ingested_at }` records provenance and acts as the dedupe key.
- `sanitizeContent` gains an `allowEmptyBody` option, used only when `source` is set — synced announcements have no body since the click goes external.
- `emitEvent` accepts absolute URLs in `action_url_path`; when the path starts with `http(s)://` it's used verbatim instead of being prefixed with the hub UI base. This is what routes feed-card clicks on synced announcements straight to `floydcova.gov`.

Required env vars (Vercel, Production + Preview): `ANTHROPIC_API_KEY` (existing), `CRON_SECRET` (existing), `FLOYD_NEWS_SOURCE_URL` (optional, defaults to the news listing URL), `FLOYD_NEWS_SYNC_ENABLED` (optional, default true), `FLOYD_NEWS_SYNC_MAX_PER_RUN` (optional, default 3).

### Slice 13.1 — switch to RSS, drop thumbnails (`fb8431c`)

After 13 shipped, synced cards looked rough — Wix thumbnails were document-scan PDFs and we had no body content because Wix renders post bodies via client-side JS. Probing showed Floyd's RSS feed (`/blog-feed.xml`) is the cleaner data source: structured XML, real publication dates, more posts than the listing page (19 vs 3), and ~25% of items carry a real `<description>` the author wrote.

- `connector.ts` now parses RSS via cheerio xmlMode. `parseRssFeed` returns `{ title, share_url, body, event_date, pub_date_iso }`. No Claude required for discovery.
- `pipeline.ts` dropped `buildDiscoveryPrompt` + the Claude call.
- `prompts.ts` deleted (unused).
- Controller dropped the up-front `ANTHROPIC_API_KEY` check (no longer needed for discovery), changed `source_url` default to `/blog-feed.xml`, populates body from the RSS description when present, always sets `image_url` to `null`. Default per-run cap raised from 3 to 5 since the operation is now ~free.
- New `src/utils/http.ts::fetchXml` helper (mirrors `fetchHtml` but with an Accept header for RSS / Atom / XML).

What we are NOT doing: inventing body descriptions via Claude from titles alone (civic content shouldn't carry hallucinated specifics), nor running a headless browser to scrape the JS-rendered post body (cost-benefit doesn't justify it for ~3 posts/week).

### Slice 13.2 — Claude paraphrase fallback for body-less RSS items (`e109b72`)

About 75% of Floyd's RSS items have no `<description>` — only a title and (sometimes) an event_date in the slug. Title-only cards looked empty. Per user direction: derive the description from facts we already have (title, event_date) without inventing specifics.

- New `civic.floyd_news_sync/paraphrase.ts`: Claude call with a tight prompt that forbids inventing times, locations, attendees, agenda items, or department names not in the title. Output capped to one sentence ≤ 200 chars, stripped of accidental quotes / fences.
- Controller invokes `paraphraseTitle` for entries with empty body; RSS description still takes precedence when present.
- Paraphrase failures are non-fatal — log + fall back to empty body.
- `ANTHROPIC_API_KEY` check is conditional: only required when an entry needs paraphrase. Cards with RSS descriptions still ingest cleanly on a hub without an Anthropic key configured.
- Per-entry log line distinguishes `body_source=rss / paraphrase / empty` for diagnostic visibility in Vercel logs.
- Cost: one Claude call per body-less entry on first ingest only. Subsequent runs skip already-ingested rows via dedupe.

### Slice 13.3 — synced announcements share the admin pill palette (`eeb9524`)

The Floyd-news-sync cron sets `author_role = "Floyd County Government"`, which the existing `FeedPost` branching treated as a non-admin author and rendered with the lavender announcement-author palette. Visually that read as a different category from admin-authored announcements, even though both still match the "Announcements" filter pill.

- Detect synced cards via `data.announcement.source.origin === "floyd-news"` (emitted alongside the announcement payload by `emitAnnouncementResultPublished` since Slice 13) and bump them into the admin pill palette.
- The "Floyd County Government announcement" label stays — only the color changes.
- Effect: admin announcements → orange "Admin announcement" pill (unchanged). Floyd-news-sync → orange "Floyd County Government announcement" pill (was lavender). Board member / committee announcements → still lavender.

### Slice 13.4 — BOS label + backdated event timestamps (plumbing) (`c0ed013`)

Two changes:

1. Meeting summary pill label: "Meeting summary" → "BOS meeting summary" (Board of Supervisors). Single string change in `FeedPost.tsx`.
2. Plumbing for backdating events to a caller-supplied timestamp:
   - `CreateEventInput` gains optional `timestamp`. `emitEvent` uses it when present, else stamps `now`.
   - `CreateProcessInput` gains optional `eventTimestamp` so the auto-emitted `civic.process.created` event can be backdated alongside manually-emitted module events.
   - `civic.announcement` `EmitEventFn` + `emitAnnouncementCreated` + `emitAnnouncementResultPublished` accept an `opts.timestamp` pass-through.
   - The floyd-news-sync controller initially passed `entry.pub_date_iso` (parsed from RSS) into both the `createProcess` call and the `emitAnnouncementResultPublished` call.

Intent was to interleave backfilled posts naturally with other feed activity instead of clustering them at "now."

### Slice 13.5 — revert active use of backdating, keep the plumbing (`285ab48`)

Reverted the controller change from 13.4 for two reasons:
- Going forward, posts come in same-day, so `pubDate ≈ now` anyway and the override has no observable effect.
- Backdated events fall outside the digest's 24h window, which would silently drop synced announcements from the daily email if Floyd's pubDate is even slightly behind ingest time.

The `eventTimestamp` / `timestamp` override plumbing on `createProcess` + `emitEvent` + `emitAnnouncement*` stays — it's optional, callable by any future backfill or migration that needs it. Reordering the existing 11 backfilled rows in production is now a one-time SQL `UPDATE` on the events table (drop the `events_no_update` trigger for the duration of the migration).

### Slice 13.6 — pre-filter feed to renderable events before pagination (`754ee2e`)

The feed page rendered empty for the "All" filter while "Announcements" rendered correctly — caused by `PAGE_SIZE` budget being starved by non-renderable events.

The events stream contains many event types (`civic.process.created`, `aggregation_completed`, `updated`, etc.) that the feed UI does not render. Only `civic.process.started` (vote-open) and `civic.process.result_published` (everything else) produce a card. Before this fix the pipeline was: fetch all events DESC → take first 50 → map to posts → non-renderable events silently drop. That broke after the production backfill backdated 10 announcement `result_published` events to March/April, leaving the now-recent 50 events dominated by sync-run `civic.process.created` events.

Fix in `Feed.tsx`: filter events through `kindFromEvent` first, then apply the user's type filter, THEN paginate. So `PAGE_SIZE` counts visible cards, not raw events. The Announcements filter "worked" before because its predicate already implicitly stripped non-announcement events; same mechanism, made universal.

### Slice 13.7 — rename feed filter pill (`b503145`)

`FeedFilter.tsx`: "Meeting summaries" → "BOS meeting summaries". Matches the per-card pill label updated in 13.4. Distinguishes from any future Planning Commission / School Board / etc. meeting kinds.

### Slice 13.8 — favicon (`647978c`)

Replaces the prior purple starburst with a simple navy circle (matches the suggest-a-vote button color, `--pill-vote-fg = #1e3a5f`), white capital "F" centered using Manrope with system-sans fallback. Single inline SVG, no PNG fallbacks (modern browsers all support image/svg+xml favicons).

### Slice 13.9 — tighten AuthModal (`2484fc3`)

Three behavioral changes after watching the sign-in flow in production:

1. **Click-outside no longer dismisses the modal.** The X button (or Escape) is the only way to close. Rationale: accidental outside-clicks were losing form state mid-sign-up, especially disruptive after the OTP was already on its way. The `.intro-overlay` div lost its `onClick={onDismiss}` and the modal `div` lost its now-unnecessary `stopPropagation`. Other components using `.intro-overlay` are unaffected — only `AuthModal`-specific markup changed.
2. **Email step no longer has the Terms / Privacy / CoC checkbox.** Existing users who had already accepted at sign-up were re-encountering it for no reason.
3. **Residency step is now a single combined gate.** One checkbox confirming residency AND legal-doc acceptance, shown only when the verified user is NOT yet a resident (brand-new sign-ups). Returning residents skip the step entirely; the existing `ReAcceptModal` at the app root still catches them if their stored `tos_version` is stale.

Implementation: `handleVerifyCode` no longer auto-`acceptTos`; it just logs in and routes new users to the combined gate. `handleResidency` calls both `affirmResidency` and `acceptTos`. `acceptTos` failure is non-fatal (re-acceptance modal will retry). Single `gateChecked` state replaces separate `residencyChecked` + `legalAccepted`.

### Slice 13.10 — defer `login()` until residency + legal gate passes (`8c1ca8e`)

User reported being able to close the modal at the residency step and still end up signed in — because `login()` was firing as soon as the verification code was accepted, before they confirmed residency or accepted the legal docs.

Fix: hold the `verifyCode` result in local state (`pendingAuth`) and only call `login()` once the residency gate completes successfully. If the user closes the modal at the gate, no session was ever established — they have to start over with email + code, which is the correct behavior for an incomplete sign-up. Returning residents (`is_resident=true` at `verifyCode`) `login()` immediately and complete — the gate never blocks them.

`handleResidency` picks the right token: `pendingAuth.token` for brand-new sign-ups, falling back to `useAuth`'s token for users who re-opened the modal already-logged-in (rare path: their `is_resident` is still false from a partial sign-up on another device).

End-to-end deferred-login behavior requires a real backend; user verifies on production after deploy.

### Slice 13.11 — self-service account deletion in Settings (`c536194`)

Adds a danger zone on `/settings` where any signed-in user can delete their own account. Frees their email for re-use, removes the user record, cascades sessions. Public-record references (comments, endorsements, vote-participation rows) become orphaned by design — the civic record (vote tallies, comment threads) stays intact, but attribution to the deleted user disappears. **Vote secrecy is preserved automatically because `vote_records` has never carried a `user_id`.**

Backend:
- `civic-hub/src/modules/civic.auth/index.ts::deleteAccount(userId, email)`. Deletes `pending_verifications` by email first (so a stale OTP can't race a fresh sign-up), then deletes the user row (sessions cascade via FK `ON DELETE CASCADE`).
- `civic-hub/src/controllers/authController.ts::handleDeleteAccount` resolves the bearer token to a user, calls `deleteAccount`, returns 200.
- `civic-hub/src/routes/authRoutes.ts`: `DELETE /auth/me` wired up.

Frontend:
- `civic-hub/ui/src/services/auth.ts::deleteAccount(token)` API client.
- `civic-hub/ui/src/pages/Settings.tsx`: danger-zone panel at the bottom of `/settings`. Two-step confirmation — user must type their own email to enable the destructive button. On success, the auth context is logged out locally and we `navigate("/", { replace: true })`.
- `civic-hub/ui/src/pages/Settings.css`: red-bordered panel + destructive-button styling distinct from regular settings panels.

What is intentionally NOT done:
- **Cool-off / undo period.** Civic platforms generally don't need it; hard-delete is cleaner and matches the simpler privacy model. Can add a 30-day grace later if real users ask.
- **Cascade-delete of comments/endorsements.** Those become orphan rows whose foreign-key strings no longer resolve to a user — the UI already renders that as no attribution. Preserves the civic record while erasing identity.
- **Admin-side delete (`DELETE /admin/users/:id`).** Future slice for moderation-driven deletes.

End-to-end testing requires a real session against a real backend; user verifies on production after deploy by deleting + re-signing-up with the same email.

### Files changed (across all sub-slices)

Backend (`civic-hub/src/`):
- New module: `modules/civic.floyd_news_sync/{connector,pipeline,paraphrase,models,index}.ts` (`prompts.ts` introduced in 13, deleted in 13.1).
- New controller / routes: `controllers/floydNewsSyncController.ts`, `routes/floydNewsSyncRoutes.ts`.
- Auth: `modules/civic.auth/index.ts` (`deleteAccount`), `controllers/authController.ts` (`handleDeleteAccount`), `routes/authRoutes.ts` (`DELETE /auth/me`).
- Event / process plumbing: `events/eventEmitter.ts`, `models/event.ts`, `models/process.ts`, `services/processService.ts` (timestamp override).
- `civic.announcement`: `events.ts`, `index.ts`, `models.ts`, `service.ts` (synced-source field, `allowEmptyBody`, timestamp pass-through).
- `civic.meeting_summary/index.ts`: exports `parseJsonArray` for reuse.
- `processes/announcementProcess.ts`: timestamp pass-through.
- `utils/http.ts`: new `fetchXml` helper.
- `app.ts`: mounts `/internal/floyd-news-sync/run`.
- `vercel.json`: daily cron entry at 12:00 UTC.

Frontend (`civic-hub/ui/src/`):
- `components/AuthModal.tsx` (13.9, 13.10 — substantial rewrite of the gate flow).
- `components/Feed.tsx` (13.6 — pre-filter pagination).
- `components/FeedFilter.tsx` (13.7 — pill rename).
- `components/FeedPost.tsx` (13.3 — synced-card palette, 13.4 — pill string).
- `pages/Settings.tsx`, `pages/Settings.css` (13.11 — danger zone).
- `services/auth.ts` (13.11 — `deleteAccount` client).
- `public/favicon.svg` (13.8).

### Verified manually (across slices)

- Floyd-news-sync end-to-end via `POST /internal/floyd-news-sync/run` against staging — backfill produced 11 rows, deduped on subsequent runs.
- Feed renders correctly under the "All" filter after the 13.6 pre-filter fix; previously empty.
- AuthModal flow: email step has 0 checkboxes; click-outside doesn't dismiss; closing at residency gate does NOT establish a session; returning residents log in immediately.
- `/settings` danger zone gates the destructive button on email-match; success logs out and routes to `/`.
- Favicon renders as navy circle with white "F" in dev preview.
- `npm run build` clean across both roots.

### Trade-offs / future work

- **Synced-card body coverage.** ~25% real RSS descriptions, ~75% Claude-paraphrased one-liners, small minority empty (Claude failure or no key). Admins can `PATCH /announcement/:id` to manually annotate any synced row.
- **Backdate plumbing is unused in the active code path.** Optional `timestamp` / `eventTimestamp` arguments stay in the signatures for future migration / backfill use; current callers don't pass them. If the abstraction stays unused for two more slices, consider removing.
- **Account deletion has no admin variant.** `DELETE /admin/users/:id` is a future slice for moderation-driven deletes; today admins cannot remove a user except by going through the user's own session.
- **AuthModal end-to-end behavior (deferred-login, account deletion) needs production verification.** Local preview confirms UI shape; real-backend verification is post-deploy.

---

## Slice 12.3 — Universal drawer + sticky chrome + image thumbnail layout — 2026-04-28

**Status:** UI polish pass driven by direct user feedback after Slice 12.2 landed. Four discrete fixes: bring the hamburger back as the universal nav drawer (with legal pages added), give announcement-with-image cards a different layout so a 16:9 hero doesn't dominate the feed, make the Feed | Votes tab strip + filter pills stick under the top nav so they remain reachable while the page scrolls, and clean up two crowding issues on the Votes page.

### Changes

- **Hamburger drawer is now the universal nav entry point at every breakpoint.** Slice 12.2 hid it on desktop because the in-page tab strip covered Feed/Votes — but that meant routes without the strip (`/privacy`, `/admin/*`, `/search`) had no visible link to anything but the wordmark. The hamburger is back at every breakpoint, About is removed from the top nav (top nav is now wordmark + search + sign-in only), and the drawer now lists Feed · Votes · About followed by a visual divider then Code of Conduct · Privacy · Terms. Legal links are intentionally smaller / muted so they read as secondary policy footer pages, not primary surfaces.
- **Image-bearing feed cards switch to a thumbnail layout.** The Slice 9 design used `aspect-ratio: 16/9` on a 100%-width image, which at the 1100px page-shell width rendered ~620px tall — visually dominating one card per scroll. New layout: when `imageUrl` is present the article gains a `has-image` class and `.feed-post-link` becomes a flex row with the text body on the left and a 144x144 square thumbnail on the right. On mobile (<= 600px) the layout switches to `flex-direction: column-reverse` so the image stacks above the text capped at 180px tall — still a recognizable visual anchor, never a scroll-eating hero. Imageless cards are unchanged.
- **Persistent chrome stack on `/` and `/votes`.** Banner + HubInfo (jurisdiction name, "CIVIC HUB" label, tagline) scroll away normally as before. The Feed | Votes tab strip (`.feed-votes-tabs`) is `position: sticky; top: var(--nav-h)` — sticks immediately under the top nav. The filter pill row (`.feed-filter` on Home, `.votes-filter` on Votes) is `position: sticky; top: calc(var(--nav-h) + var(--tabs-h))` — sticks under the tabs. The result is a 3-row sticky chrome (nav + tabs + pills, ~182px tall) that remains reachable through arbitrary scroll depth while the resident is reading the feed.
- **Votes page polish.** Removed the inline `+ Suggest a vote` green link next to the "Proposed Votes" heading — it duplicated the pinned suggest-a-vote CTA card at the top of the page and crowded the heading. Added `padding-bottom: var(--space-md)` to `.votes-filter` so the "Active Votes" heading underneath gets breathing room from the pill row instead of sitting flush against it.

### Decisions worth flagging

- **Sticky offsets are token-based, not magic numbers.** Two new tokens in `:root` — `--nav-h: 61px` and `--tabs-h: 45px` — are referenced by both filter rows and the tab strip. If the nav padding or hamburger size changes, updating one place updates the whole stack. Verified live: `getBoundingClientRect` returns `nav.top: 0`, `tabs.top: 61`, `filter.top: 106` once the page is scrolled past the chrome.
- **Drawer divider is a `<li role="separator">`, not a CSS-only border.** Lets screen readers announce the visual grouping and keeps the markup semantic. Legal links use a `civic-nav-drawer-link-legal` modifier (smaller font, muted color) so the priority hierarchy reads at a glance.
- **Mobile image layout is `flex-direction: column-reverse`, not a JSX reorder.** With the image as the second JSX child (after `.feed-post-body`), `column-reverse` on mobile flips visual order to put image on top while keeping the desktop thumbnail-on-right layout default. One source of truth in the JSX, one CSS rule per breakpoint — no per-breakpoint conditional rendering.
- **Top nav `<ul>` renders only when `TOP_LINKS.length > 0`.** Easier to add a top-nav link later than to maintain a hidden empty list. Currently `TOP_LINKS` is `[]` and the wrapper element is omitted entirely.

### Files changed

UI only:
- `civic-hub/ui/src/components/Nav.tsx` — empty `TOP_LINKS`; new `DRAWER_LEGAL_LINKS`; conditional top-nav `<ul>` render; drawer renders primary links + divider + legal links.
- `civic-hub/ui/src/components/Nav.css` — hamburger default `display: inline-flex`; mobile media query no longer toggles its display; new `.civic-nav-drawer-divider` and `.civic-nav-drawer-link-legal` styles.
- `civic-hub/ui/src/components/FeedPost.tsx` — wrapped non-image content in `.feed-post-body`; added `has-image` class to article when `imageUrl` is set; image moves to last child for the flex-row layout.
- `civic-hub/ui/src/components/Feed.css` — `.feed-post.has-image .feed-post-link` flex row; `.feed-post-image` is now `flex: 0 0 144px` square (was `width: 100%; aspect-ratio: 16/9`); mobile `column-reverse` with capped 180px image height.
- `civic-hub/ui/src/components/FeedVotesTabs.css` — sticky `top: var(--nav-h)`, z-index 90, page-bg background.
- `civic-hub/ui/src/components/FeedFilter.css` — sticky `top: calc(var(--nav-h) + var(--tabs-h))`, z-index 89, page-bg background; bumped bottom padding to `var(--space-md)`.
- `civic-hub/ui/src/App.css` — new `--nav-h` / `--tabs-h` tokens on `:root`; `.votes-filter` gets the same sticky treatment as `.feed-filter` plus the bottom padding fix.
- `civic-hub/ui/src/pages/Votes.tsx` — removed the `.section-header-row` wrapper + inline `+ Suggest a vote` link; "Proposed Votes" heading + section description render directly.

### Verified manually (in dev)

- Desktop home (1280x900): hamburger | wordmark | search | Sign in. No About in top nav. Hub info, tab strip, filter pills, feed cards aligned at 1100px shell width.
- Hamburger drawer (any breakpoint): Feed (active) · Votes · About — divider — Code of Conduct · Privacy · Terms (smaller, muted).
- Sticky chrome math (`getBoundingClientRect` after scroll): `nav.top: 0`, `tabs.top: 61`, `filter.top: 106` — exact stack.
- Image card layout (DOM-injected for verification since seed has no announcements): desktop renders body left + 144px square thumbnail right; mobile (375 wide) renders 180px-capped image on top + body below.
- Mobile Votes (375 wide): chrome stack (nav + Feed/Votes tabs + All/Active/Proposed/Finalized pills) sticks at top while the suggest-a-vote CTA, sections, and footer scroll under it.
- Votes page: "Proposed Votes" heading no longer paired with an inline green link; "Active Votes" heading sits below the pill row with visible padding instead of touching it.
- `npm run build` clean (UI only — backend not modified). No console errors.

### Trade-offs documented

- **Sticky chrome footprint at small viewports.** On a 375-wide / 600-tall mobile viewport the persistent chrome (nav + tabs + filter) eats ~182px of viewport height — about 30%. Acceptable for a primarily reading-oriented feed but worth watching if real residents complain about content density on small screens. Easiest knob: drop the filter row from sticky on mobile (keep tabs only) or collapse tabs into the nav.
- **`--nav-h: 61px` / `--tabs-h: 45px` are measured constants.** They depend on the actual rendered heights of `.civic-nav` and `.feed-votes-tab` (44px tap target + 1px border + chrome). If those internal heights ever change, the offsets must be re-measured. A more robust solution would be a `ResizeObserver` driving the offset via a CSS custom property, but it's not worth the complexity for the current static chrome.

### Future work / not in this slice

- Sticky chrome on `/announcement/:id`, `/process/:id`, etc. The tab strip only renders on `/` and `/votes` so the sticky logic is moot elsewhere — but if/when residents land on a process detail and want a one-click hop back to the feed, a smaller persistent affordance (a back-to-feed pill?) might help.
- The drawer's divider + legal-link grouping is hand-rolled; if a third group ever appears (e.g. admin tools when logged in as admin), the structure should generalize to `Array<{ heading?: string; links: Link[] }>`.

---

## Slice 12.2 — Visual width alignment + desktop hamburger off — 2026-04-28

**Status:** Polish pass. Slice 12.1 fixed the navigation IA but left a width inconsistency: in-page elements (tab strip, filter pills, feed list, suggest-vote CTA) were capped at 640px while the hub info and Votes-page sections used the full 1100px page-shell width. The two widths fought each other visually. This pass aligns everything to the same width and removes the desktop hamburger now that the in-page tab strip is the primary access path.

### Changes

- **All in-page elements now use `--max-width-shell` (1100px)** instead of `--max-width-feed` (640px). The narrower token is preserved in `theme.css` for any future component that still wants single-column reading width, but no element uses it currently. Affected: `.feed-votes-tabs`, `.feed-filter`, `.feed`, `.suggest-vote-cta`, `.votes-filter`.
- **Desktop hamburger removed.** The mobile-only media query is restored (`@media (max-width: 768px) { .civic-nav-hamburger { display: inline-flex } }`). Desktop top nav is now: wordmark | About | search | Sign in. Feed and Votes are reachable via the in-page tab strip on `/` and `/votes`. From any other route (e.g. `/privacy`, `/admin/*`, `/search`) a desktop user clicks the wordmark to return to `/`, which is the Feed; from there the tab strip takes them to Votes — two-click max from anywhere.

### Files changed

- `civic-hub/ui/src/components/Nav.css` — hamburger default `display: none`; mobile media query restores it.
- `civic-hub/ui/src/components/FeedVotesTabs.css` — `max-width-feed` → `max-width-shell`.
- `civic-hub/ui/src/components/FeedFilter.css` — same.
- `civic-hub/ui/src/components/Feed.css` — same.
- `civic-hub/ui/src/App.css` — same on `.suggest-vote-cta` and `.votes-filter`.

### Verified manually

- Desktop home: top nav is wordmark | About | search | Sign in (no hamburger). Hub info, Feed/Votes tabs, filter pills, and feed cards all share the same left/right edges.
- Desktop Votes: same alignment — hub info, tabs, suggest-vote CTA, status pills, sections all flush.
- Mobile home: hamburger | wordmark | Sign in. Drawer shows Feed | Votes | About.
- Mobile Votes: same. Filter pills + CTA + sections all viewport-width aligned.
- `npm run build` clean.

### Trade-off documented

- **Two-click navigation from chrome routes.** From `/privacy`, `/admin/*`, or `/search` a desktop user has no direct "Votes" link in the top nav. The wordmark → Feed → tab → Votes path keeps it to two clicks; if/when someone reports it, easiest fix is re-adding `Votes` (without a badge) to the top nav links list or bringing back the hamburger on desktop.

---

## Slice 12.1 — Feed | Votes tab strip — 2026-04-27

**Status:** Slice 12's first attempt promoted Votes into the top nav with an active-count badge — felt crowded next to the wordmark on mobile, and the home-feed Suggest-a-vote button surfaced even when the user was filtering by Announcements (wrong context). This follow-up replaces all that with a clean two-tab in-page strip below the banner.

### Decisions worth flagging

- **Tabs as routes, not a single-page state toggle.** The two tabs are React Router `<NavLink>`s — clicking "Feed" navigates to `/`, clicking "Votes" navigates to `/votes`. Active state comes from the URL. Bookmarkable, back-button-safe, no parallel UI state to keep in sync.
- **"Feed" + "Votes" labels (one word each).** Considered "Civic Feed" / "Floyd Feed" — "Feed" pairs symmetrically with "Votes," is short on mobile, and "Civic Feed" is redundant when the whole site is a Civic Hub.
- **Top nav slimmed to the secondary link only.** Feed and Votes are no longer in the top nav at any breakpoint — they live exclusively in the in-page tab strip and the hamburger drawer. The top nav now carries just `About` (plus search + sign-in), so the wordmark area stays calm.
- **Hamburger now visible on every breakpoint, not mobile-only.** With Feed/Votes moved out of the top nav, the drawer is the universal escape hatch for routes that don't show the tab strip (e.g. `/privacy`, `/admin/*`, `/search`). On those routes a desktop user still has one click to Feed, Votes, or About.
- **Suggest-a-vote stays out of the home feed entirely.** The home page filter pills are a *visual* discriminator (event-type filter); injecting a creative-action CTA there caused the user-reported confusion ("why does Announcements have a Suggest-a-vote button?"). The CTA only lives on the Votes page now, where the context is unambiguous.
- **Drawer link list and top-nav link list separated explicitly.** `Nav.tsx` now has `TOP_LINKS` (About) and `DRAWER_LINKS` (Feed, Votes, About). About appears in both intentionally — top nav for desktop discovery, drawer for the universal-access pattern.

### Files added / changed

- `civic-hub/ui/src/components/Nav.tsx` — split into `TOP_LINKS` / `DRAWER_LINKS`. Active-vote badge fetch and promoted-link rendering reverted.
- `civic-hub/ui/src/components/Nav.css` — hamburger now always visible; promoted-link / badge rules removed; mobile media query no longer toggles hamburger display.
- `civic-hub/ui/src/components/FeedVotesTabs.{tsx,css}` (new) — the two-tab strip. Underline-style active state, sticky-friendly, single border-bottom that the active tab's underline replaces.
- `civic-hub/ui/src/pages/Home.tsx` — mounts `<FeedVotesTabs>`; the action-row + Suggest-a-vote button removed.
- `civic-hub/ui/src/pages/Votes.tsx` — mounts `<FeedVotesTabs>` directly above the suggest-a-vote CTA card.
- `civic-hub/ui/src/components/FeedFilter.css` — `.home-action-row` and `.home-suggest-vote-button` rules removed (no longer used).

### Verified manually (in dev)

- Desktop: hamburger | wordmark | About | search | Sign in. Tab strip below banner.
- Mobile: hamburger | wordmark | Sign in. Tab strip below banner.
- Hamburger drawer: Feed, Votes, About — all three reachable from any route.
- Clicking Votes tab navigates to `/votes`; clicking Feed tab navigates to `/`.
- Home page: pills + feed; no Suggest-a-vote button.
- Votes page: pinned suggest-a-vote CTA + status pills + sections.
- Switching home-feed filter (e.g. Announcements) does NOT show a Suggest-a-vote button anywhere on the page.
- `npm run build` clean both roots.

### Future work

- The legacy primary-link styles in `Nav.css` (`.civic-nav-links`, `.civic-nav-link`) still exist but only render `About` now. Could simplify to a single inline About link if we never plan to add another top-level link, but keeping the list makes future additions trivial.
- Consider unifying `FeedFilter` and `votes-filter` styling into one shared pill component (currently there's CSS duplication between `FeedFilter.css` and the `.votes-filter*` rules in `App.css`).

---

## Slice 12 — Make votes prominent + "Suggest a vote" — 2026-04-27

**Status:** Shipped end-to-end. Votes are now the most prominent thing on the Hub — a sticky nav link with an active-vote count badge (visible even on mobile), a "+ Suggest a vote" button paired with the home feed's filter pills, a pinned suggest-a-vote CTA card at the top of the Votes page, and pill-based status filtering (All / Active / Proposed / Finalized) on the Votes page that matches the home-feed pill pattern.

The "issue" → "vote" terminology is now consistent across the UI: "Propose an issue" became "Suggest a vote" everywhere it appeared, with body copy that gently explains the proposal-needs-citizen-support flow.

### Decisions worth flagging

- **"Suggest a vote", not "Propose a vote".** The user pushed back on my naming concern (a citizen submits a `civic.proposal` which only *becomes* a `civic.vote` after enough endorsements — strictly they're proposing a topic, not a vote). The compromise: "Suggest" is softer than "Propose," doesn't promise a vote will happen, and keeps the word "vote" in the user's eyeline so the cognitive load stays low. The body copy on the Propose page explains the citizen-support gate explicitly.
- **Promoted-link pattern in the nav.** Rather than a separate "promoted button" element, the existing `PRIMARY_LINKS` array gained an optional `promoted: true` flag. Render still uses one `<ul>`, but a CSS rule (`.civic-nav-link-item-promoted { display: list-item }` on mobile) keeps the promoted link visible while siblings collapse into the hamburger drawer. Easier to extend later (e.g., promote two items) without restructuring.
- **Active-vote badge fetches via `listProcesses()`.** No new endpoint. Component-local fetch on mount, filter to `civic.vote` + `status === "active"`, count. At MVP scale (a handful of processes) the cost is negligible; if/when this becomes hot, a dedicated `/process/counts` endpoint is a one-line follow-up. Failure is non-fatal — badge stays hidden if the fetch errors.
- **Home-feed filter pills + Suggest-a-vote button share one row.** A new `.home-action-row` wraps `<FeedFilter>` and the CTA `<Link>`. On wide screens they sit side-by-side; on narrow screens (<= 600px) the row stacks (pills first, button full-width below). The CTA reuses the same primary-button color (`--pill-vote-fg` / brand navy) as the Votes-page CTA so they read as the same action.
- **Votes-page filter is its own thing, not the Slice 10 `<FeedFilter>` reused.** The home filter is a *visual* discriminator (event-type predicate). The Votes-page filter is a *data* discriminator (active vs proposed vs finalized status). Different mental model, different state shape — making one component cover both would be lossy. The styling is duplicated (~30 lines of CSS) but kept consistent visually so users perceive them as the same pattern.
- **Pinned CTA card uses the vote-pill color palette.** Light-blue background (`--pill-vote-bg`), brand-navy border + heading + button (`--pill-vote-fg`). Reads as "vote-related action" without competing with the brand chrome.
- **Promoted-link active state suppresses the underline on mobile.** The desktop primary nav uses an underline-style active state (`border-bottom: 2px solid`). On mobile, where Votes sits next to the wordmark and hamburger, the underline visually clashes with the surrounding chrome — so the mobile rule sets the active border-bottom to transparent. The link is still aria-current="page"; only the visual underline goes away.

### Files added / changed

UI only (no backend work):
- `civic-hub/ui/src/components/Nav.tsx` — `PRIMARY_LINKS` gains `promoted` flag, badge fetch + render.
- `civic-hub/ui/src/components/Nav.css` — `.civic-nav-badge` styles, mobile rule that shows promoted items only.
- `civic-hub/ui/src/pages/Home.tsx` — wraps `<FeedFilter>` + `+ Suggest a vote` `<Link>` in `.home-action-row`.
- `civic-hub/ui/src/components/FeedFilter.css` — `.home-action-row`, `.home-suggest-vote-button`, mobile-stack rule.
- `civic-hub/ui/src/pages/Votes.tsx` — full rewrite: pinned CTA card, pill filter (URL-bound `?status=`), section visibility derived from filter, "Propose an Issue" → "Suggest a vote" copy.
- `civic-hub/ui/src/pages/Propose.tsx` — title, description, submit-button copy updated.
- `civic-hub/ui/src/App.css` — `.suggest-vote-cta*` and `.votes-filter*` styles.

### Verified manually (in dev)

- Mobile (375 wide): nav shows hamburger | wordmark | "Votes 1" badge | Sign in. Feed and About fall into hamburger drawer.
- Mobile home: filter pills row + full-width "+ Suggest a vote" button below.
- Mobile Votes page: CTA card at top with full-width "+ Suggest a vote" button, then pill filter row, then sections.
- Desktop (1280 wide): nav shows wordmark | Feed | Votes (with badge, underlined when active) | About | search | Sign in. Layout same as before.
- Desktop home: filter pills + button on the same row.
- Desktop Votes page: CTA card sized to content with the button on its own line, filter pill row, sections.
- Filter pill click on Votes page updates URL to `?status=<key>`, shows only the matching section.
- Propose page reads "Suggest a vote" with the citizen-support explainer.
- `npm run build` clean both roots.

### Future work / not in this slice

- Dedicated lightweight count endpoint if `listProcesses()` becomes a hot-path cost.
- Live-updating badge (currently fetched once on Nav mount; doesn't update if a vote is created/closed in the same session).
- Empty-state polish on the Votes page when a filter matches nothing (currently the section just shows its existing empty state copy).
- Slight redundancy with the home page: the home feed filter pill "Votes" still surfaces vote events chronologically, while the Votes page surfaces vote *processes* by status. Both are useful but the overlap is real — track whether real users notice / complain.

---

## Slice 11 — Legal docs + minimal moderation — 2026-04-27

**Status:** Shipped end-to-end. Three legal documents (Privacy Policy, Terms of Service, Code of Conduct) ship as React-Router pages rendered from bundled markdown via `react-markdown`. Footer carries the three links plus an operator tagline. Sign-up gates on a legal-acceptance checkbox; existing users hit a blocking re-acceptance modal when their stored version is null or stale. Admins can hide community-input comments and remove announcements; both actions emit restricted-visibility audit events and render tombstones to non-admins. A new `/admin/moderation` log lists every moderation action newest-first.

This slice is the last pre-launch gate. The remaining blockers are operator-side: substituting placeholder strings in the legal markdown and getting a lawyer review.

### Decisions worth flagging

- **Render markdown, don't author copy.** The three legal markdown files came in pre-drafted (with a "Draft starter content — review before launch" callout at the top of each). Operator handles placeholder substitution and lawyer review; the build pipeline just bundles them. Vite `?raw` imports give us no network fetch, no CMS, and the docs ship inside the JS bundle — bumping a doc is a code change visible in git history.
- **`{OPERATOR_NAME}`, `{CONTACT_EMAIL}`, `{OPERATOR_MAILING_ADDRESS}` are intentional literals.** They render verbatim on the public legal pages and in the footer until the operator does the find-and-replace. See "Operator setup" below for the exact substitution checklist.
- **Internal cross-links route through React Router.** A custom `<a>` renderer on `react-markdown` swaps anchors whose href starts with `/` for React Router `<Link>`. External URLs and `mailto:` keep the default. Keeps the three docs feeling like one site instead of three full reloads.
- **Fonts: Manrope for headings, Inter for body.** The slice spec mentioned Fraunces but the codebase actually uses Manrope (`--font-heading`). I used the existing tokens — defer to the deployed truth. Width capped at 70ch for readability.
- **`CURRENT_LEGAL_VERSION = "1.0"` is hardcoded in `civic-hub/ui/src/config/legal.ts`.** Not an env var. Bumping it requires a code change so the trigger for forcing all users back through re-acceptance is traceable in git. Bump in the same commit as the markdown edits to keep version + content aligned.
- **Acceptance is a single bundle.** The three docs are versioned together — accepting "1.0" accepts all three. Splitting them into three separate version cursors gives the user three modals on the next bump, which is worse UX for a marginal modeling improvement. Revisit if/when individual doc revs become more independent.
- **Acceptance is recorded after `verifyCode()`.** The acceptance checkbox lives on the email step (it gates `Continue`), but the actual `/auth/accept-tos` POST happens immediately after the OTP verifies — that's the first moment we have a session token. If the call fails, the session still proceeds; the re-acceptance modal will catch the user on next page load. Failure is logged, not surfaced to the user, so a transient 500 doesn't break sign-up.
- **Re-acceptance modal is blocking.** Mounted at the app root; renders whenever a signed-in user's `tos_version_accepted` is null or `!= CURRENT_LEGAL_VERSION`. No close affordance. Two actions: "Review and accept" and "Decline and sign out".
- **Moderation events use `civic.process.updated` with `meta.visibility = "restricted"`.** No new event types. The `data.moderation` object discriminates: `{ action, target, reason, hidden_by | restored_by | removed_by }`. Restricted events are filtered out of the public `/events` feed (admin-only via Bearer token), out of the digest, and stay invisible to search. The Civic Event Spec §7 visibility model already supported this — the slice just exercises it.
- **Comment hide is reversible — single most-recent-action shape.** `community_inputs` gains four columns (`hidden_at`, `hidden_by`, `hidden_reason`, `restored_at`). The `hidden` boolean is derived (`hidden_at IS NOT NULL AND (restored_at IS NULL OR restored_at < hidden_at)`). The full audit trail lives in the events table; the columns just carry current state for the public read filter. Re-hiding overwrites these columns.
- **Announcement removal lives in `state.moderation` JSON.** No new column. The Slice 10.5 search migration already had a moderation predicate (`state -> 'moderation' ->> 'removed'`) anticipating this, so search excludes removed announcements automatically. The public `/announcement/:id` endpoint redacts body / image / links / link previews when `removed === true`; admins still receive the original via the same endpoint with their token attached. The list endpoint and the feed both exclude removed announcements entirely (rationale: an announcement is an affirmative publication; once retracted, we shouldn't keep broadcasting its presence).
- **Comments stay in context with a tombstone; announcements drop out of the feed.** Different rationale per surface: a vote thread loses meaning if you simply delete a comment, so the tombstone preserves context ("a comment was here, the moderator hid it for a CoC violation"). An announcement on the feed is a publication act — once revoked, leaving it on the feed re-broadcasts the existence of the post we're trying to retract.
- **Tombstones link to `/code-of-conduct`.** This is the canonical reason — even when the moderator's internal reason is "Spam" or "Doxxing", the public tombstone says "violating the Code of Conduct" and links there. The internal reason is admin-audit only.
- **Caller identification on read endpoints uses a best-effort token check.** `/events`, `/process/:id/input`, and `/announcement/:id` decode the Bearer token (if any) and check `isAdminEmail()`. Any failure short of an admin-positive identification falls back to the public view — fail-closed. Avoids gating these reads behind `requireAuth` (which would break unauthenticated browsing).
- **Reason chips are admin-friendly defaults, not an enum.** "Personal attack", "Harassment", "Doxxing", "Spam", "Other". The textarea remains the source of truth — chips just click-to-fill. Stored as the verbatim string in both the row and the event.
- **Moderation log is read-only and unfiltered for MVP.** Newest-first scrolling list. Adding filters / search / pagination is additive when volume warrants it.
- **Five-tab AdminTabs.** Order is now Proposals · Vote results · Moderation · Meeting summaries · Settings (per the slice IA spec).

### Files added / changed

Backend:
- `civic-hub/supabase/migrations/20260427230000_legal_acceptance_and_moderation.sql` — adds `users.tos_version_accepted`, `users.tos_accepted_at`, and four moderation columns (`hidden_at`, `hidden_by`, `hidden_reason`, `restored_at`) on `community_inputs`. Documents that announcement moderation lives in JSONB `state.moderation` — no schema change needed.
- `civic-hub/src/modules/civic.auth/{models.ts, index.ts}` — `User` interface gains the two TOS columns; `acceptLegalTerms(userId, version)` writes them.
- `civic-hub/src/controllers/authController.ts` — `handleAcceptTos` for `POST /auth/accept-tos`. Token-gated.
- `civic-hub/src/routes/authRoutes.ts` — route registration.
- `civic-hub/src/modules/civic.input/{models.ts, index.ts}` — `CommentModeration` shape; `hideComment`, `restoreComment`, `getInputById`. Reasons capped at 500 chars. EmitEventFn extended with optional `visibility`.
- `civic-hub/src/modules/civic.announcement/{models.ts, service.ts, index.ts}` — `AnnouncementModeration` on state; `removeAnnouncement`, `restoreAnnouncement`. New `getAdminReadModel` (full content) vs `getPublicReadModel` (redacted when removed). EmitEventFn extended with optional `visibility`.
- `civic-hub/src/controllers/moderationController.ts` (new) — five admin endpoints: hide / restore comment, remove / restore announcement, GET log.
- `civic-hub/src/routes/adminRoutes.ts` — mounts the five moderation routes under `/admin/moderation/*` (all gated by `requireAdmin`).
- `civic-hub/src/controllers/eventController.ts` — filters restricted events for non-admin callers.
- `civic-hub/src/controllers/inputController.ts` — public list redacts hidden comment bodies; admin sees full content.
- `civic-hub/src/controllers/announcementController.ts` — admin-aware read; public list excludes removed announcements.
- `civic-hub/src/controllers/digestController.ts` — drops restricted events and removed-announcement events from the digest window.

Frontend:
- `civic-hub/ui/src/content/legal/{privacy.md, terms.md, code-of-conduct.md}` — pre-drafted content (operator-supplied, render verbatim).
- `civic-hub/ui/src/config/legal.ts` — `CURRENT_LEGAL_VERSION = "1.0"`, `CURRENT_LEGAL_LAST_UPDATED = "2026-04-24"`.
- `civic-hub/ui/src/components/LegalPage.{tsx, css}` — shared markdown renderer with custom anchor mapping.
- `civic-hub/ui/src/pages/{Privacy, Terms, CodeOfConduct}.tsx` — three-line page wrappers that import the markdown via `?raw`.
- `civic-hub/ui/src/components/ReAcceptModal.tsx` — blocking modal mounted at the app root.
- `civic-hub/ui/src/components/AuthModal.tsx` — acceptance checkbox on the email step; calls `/auth/accept-tos` after verify.
- `civic-hub/ui/src/services/auth.ts` — `acceptTos()`; `AuthUser` gains the two TOS fields.
- `civic-hub/ui/src/services/api.ts` — moderation API helpers (`adminHideComment`, `adminRestoreComment`, `adminRemoveAnnouncement`, `adminRestoreAnnouncement`, `adminGetModerationLog`); `CommunityInput.moderation`, `Announcement.moderation`.
- `civic-hub/ui/src/components/CommunityInputPanel.tsx` — tombstone for hidden comments + admin "Hide for Code of Conduct violation" inline button + reason modal with chips. Restore button on existing tombstones.
- `civic-hub/ui/src/pages/Announcement.tsx` — admin moderation toolbar (Remove / Restore), tombstone replaces body/image/preview/links when removed.
- `civic-hub/ui/src/components/Feed.tsx` — drops posts whose underlying announcement has been removed.
- `civic-hub/ui/src/pages/AdminModeration.tsx` (new) — read-only newest-first table.
- `civic-hub/ui/src/components/AdminTabs.tsx` — Moderation tab inserted between Vote results and Meeting summaries.
- `civic-hub/ui/src/App.tsx` — three legal routes, `/admin/moderation`, `<ReAcceptModal>` mount, two-row footer with Privacy / Terms / Code of Conduct links and operator tagline.
- `civic-hub/ui/src/App.css` — footer rework, legal-acceptance checkbox, tombstone, moderation chips/modal/toolbar/table styles.
- `civic-hub/ui/package.json` — `react-markdown` and `remark-gfm` added.

### Restricted events: how they're filtered out of the public feed

Every moderation action emits a `civic.process.updated` event whose `meta.visibility` is set to `"restricted"`. Three filters cooperate to keep them invisible to non-admins:

1. **`GET /events`** — `eventController.handleGetEvents` decodes the Bearer token (if any), checks `isAdminEmail`, and filters `e.meta?.visibility === "restricted"` for everyone else.
2. **The daily digest** — `digestController` filters restricted events out of the cron window before fanning out to users; it also tracks `removedAnnouncementIds` and drops any event whose `process_id` belongs to one (so the publish event doesn't re-broadcast a since-removed announcement).
3. **Search** — Slice 10.5's `search_processes` RPC already has the `state -> 'moderation' ->> 'removed'` predicate.

To verify manually: hit `GET /events` with no token. The response should never include a `meta.visibility = "restricted"` event. Hit it again with an admin Bearer token — restricted moderation events should appear.

### Verified manually (in dev)

- `/privacy`, `/terms`, `/code-of-conduct` render with proper typography. Cross-document links resolve via React Router (no full reload).
- Footer shows Privacy · Terms · Code of Conduct on every page including the legal pages themselves; the operator tagline shows `Operated by {OPERATOR_NAME}` literally (placeholder is intentional).
- AuthModal email step shows the legal-acceptance checkbox below the email input. The three doc links open in new tabs (`target="_blank"`, `rel="noopener noreferrer"`). `Continue` is disabled until both email is non-empty AND the checkbox is checked.
- AdminTabs renders five tabs in the right order: Proposals · Vote results · **Moderation** · Meeting summaries · Settings.
- `/admin/moderation` shows the empty state ("No moderation actions yet…") on a clean DB.
- `GET /events` with no token → 200, zero restricted events in the response.
- `POST /auth/accept-tos` with no token → 401.
- `GET /admin/moderation/log` with no token → 401.
- `npm run build` clean both roots.

### Incomplete / future work

- **Resident-initiated content reports / flagging** — admins moderate by encountering content. Adding a "Report" button and a reports queue is its own slice.
- **Moderation queue / dashboard / metrics UI** — out of scope. The log page is read-only.
- **Appeal workflow** — the Code of Conduct says "email {CONTACT_EMAIL} and a human will review." No structured appeal pipeline.
- **Account bans (temporary or permanent)** — not implemented; only individual content removal.
- **Public moderation transparency report** — the Code says we *can* publish aggregate stats on request. The mechanism is a future concern.
- **Per-document version tracking** — the three docs share a single version cursor. Splitting (so a Privacy bump doesn't force re-acceptance of Terms / CoC) is a future refinement.
- **i18n / translations** of legal content — not in scope.
- **PDF export** of legal docs — residents can use the browser's print-to-PDF.
- **CSP, cookie consent banner, GDPR-specific tooling** — the privacy policy covers rights; if EU-bound compliance becomes necessary, that's its own slice.

### Operator walkthrough — final pre-launch checklist

1. **Apply the migration in Supabase.** Open SQL Editor → New query → paste `civic-hub/supabase/migrations/20260427230000_legal_acceptance_and_moderation.sql` → run. Verify with:
   ```sql
   SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name IN ('tos_version_accepted', 'tos_accepted_at');
   SELECT column_name FROM information_schema.columns
     WHERE table_name = 'community_inputs'
       AND column_name IN ('hidden_at', 'hidden_by', 'hidden_reason', 'restored_at');
   ```
   Each should return its expected rows.

2. **Fill in the legal placeholders.** This is a *blocker* — three placeholder strings appear ~10–15 times across the three files, but you only need to decide three actual values. Open each file in `civic-hub/ui/src/content/legal/` and find-and-replace:

   | Placeholder | Example value |
   | --- | --- |
   | `{OPERATOR_NAME}` | "Floyd Civic Hub LLC" or your own name |
   | `{CONTACT_EMAIL}` | "contact@floyd.civic.social" |
   | `{OPERATOR_MAILING_ADDRESS}` | Your operating mailing address |

   Files to edit:
   - `civic-hub/ui/src/content/legal/privacy.md`
   - `civic-hub/ui/src/content/legal/terms.md`
   - `civic-hub/ui/src/content/legal/code-of-conduct.md`

   Also update the footer in `civic-hub/ui/src/App.tsx` — the "Operated by {OPERATOR_NAME}" string is a literal too. Search/replace in App.tsx the same way.

   Commit and redeploy.

3. **Have the legal docs reviewed by a lawyer.** Pre-launch *blocker*, not a suggestion. Each doc opens with a "Draft starter content — review before launch" callout that should be removed only after that review is done. Find a lawyer familiar with Virginia and US privacy / consumer law. Update the docs based on their feedback. Bump `CURRENT_LEGAL_VERSION` in `civic-hub/ui/src/config/legal.ts` if any change is material; bump the `*Last updated*` and `*Version*` lines in each markdown file too.

4. **Decide who the moderation admin is.** If it's just you, the Code of Conduct's promise that "if the admin is the subject of the complaint, we'll escalate to an independent reviewer" needs a real person you can route those complaints to. Identify one before launch.

5. **Read the Code of Conduct end-to-end yourself.** What's shipped is the policy you're committing to. If anything in it doesn't match your intent, edit it before public sign-ups open.

### Legal version bump protocol (for future revisions)

When any of the three legal documents needs a substantive update:

1. Edit the markdown file(s) under `civic-hub/ui/src/content/legal/`.
2. Update the `*Last updated: YYYY-MM-DD*` and `*Version: X.Y*` lines at the top of the changed file(s).
3. Bump `CURRENT_LEGAL_VERSION` in `civic-hub/ui/src/config/legal.ts` (and `CURRENT_LEGAL_LAST_UPDATED`).
4. Commit all of that together. Every existing user will hit the re-acceptance modal on their next sign-in until they accept the new version.
5. Optional but recommended: keep a `CHANGES.md` in `civic-hub/ui/src/content/legal/` summarizing what changed, why, and when.

### What stayed the same on purpose

- All Civic Event Spec compliance — moderation reuses `civic.process.updated` and the existing visibility model. No new event types.
- All five required Civic Hub endpoints unchanged.
- The Slice 8.5 vote-results rename, Slice 9 image / link-preview structure, and Slice 10 / 10.5 feed surfaces — moderation is layered on top, not into.
- Vote-results, meeting-summary, and proposal moderation — none of those are resident-authored, so moderation doesn't apply.
- Comments inside the vote-results page (admin-curated) — those are not `civic.input` rows; this slice's hide tooling does not apply.

---

## Slice 10.5 — Full-text search across the Civic Hub — 2026-04-27

**Status:** Shipped end-to-end. A search icon now lives in the nav (between primary links and the avatar on desktop, top of the mobile drawer). Submitting takes the resident to a `/search?q=...` page with relevance ranking, multi-select post-type filtering, date-range buckets, sort toggle, and pagination — all bookmarkable via URL params. Backend uses Postgres FTS via two RPC functions defined in the new migration; the `civic.search` service module follows the same pluggability rules as `civic.digest` (pure functions + injected callbacks).

### Decisions worth flagging

- **Postgres FTS, not Elasticsearch / Algolia.** A `tsvector` column + GIN index + trigger + two RPC functions handle everything for the foreseeable hub scale. Free, integrated, sufficient. Documented in the migration.
- **RPC, not the JS query builder.** `supabase-js`'s `.textSearch()` operator can't express `ts_rank`-ordered results, so pagination on relevance would break. The migration defines `search_processes(p_q, p_types, p_from, p_to, p_sort, p_limit, p_offset)` and `search_processes_count(...)`; the controller calls them via `.rpc(...)`. SQL stays reviewable in the migration file; the controller is a thin orchestrator.
- **`search_doc` is built from `title || description || state::text`.** Stringifying state captures announcement bodies, meeting block titles, vote_context.description, etc., without per-type extraction logic. Trade-off documented inline: matches can hit JSON keys (e.g. "title") in addition to values, producing occasional false positives. Acceptable for MVP — per-type extraction is a refactor we'll do if the signal/noise drops below useful.
- **Trigger fires on UPDATE OF (title, description, state) only.** Crucially excludes `search_doc` itself, so the migration's backfill UPDATE doesn't recurse and ordinary writes that don't touch indexable columns don't pay tokenization cost.
- **Moderation predicate baked in from day one.** Search excludes any process where `state -> 'moderation' ->> 'removed' = 'true'`. This is a no-op until Slice 11 introduces the field, then quietly does the right thing.
- **Status filter excludes drafts and pending records.** Only `active`, `closed`, `finalized` are searchable — no leak of vote-results records that are still in admin review, no leak of unpublished votes.
- **Empty `q` short-circuits server-side.** The controller / module returns `{ hits: [], total: 0, took_ms: 0 }` without a DB hit. The `/search` page's no-query state uses this.
- **URL is the single source of truth on the page.** Every filter / sort / pagination change rewrites params via React Router; the page reads URL state on mount and on every URL change. Bookmarkable, shareable, back/forward-friendly.
- **Multi-select type filter is a fresh component, not Slice 10's `<FeedFilter>` reused.** Slice 10's filter is single-select event-predicate-based; the search page wants multi-value (`?type=vote&type=announcement`) with different selection semantics. The pill *styles* are shared via a `FeedFilter.css` import in `Search.tsx`.
- **`/` keyboard shortcut focuses the search bar.** Skips when an input/textarea/contenteditable already has focus — standard pattern, cheap, useful.
- **Comment search is future work.** Comments live in `civic.input` rows; including them needs a second indexed table, a separate result type in the UI, and careful moderation. Skip for MVP. Documented in code comments.
- **Hub boots cleanly without `civic.search` mounted.** If `searchRoutes` isn't in `app.ts`, every other code path is unchanged — the search bar's submit just produces a 404 on `/api/search`, and the page surfaces that as an error.

### Files added / changed

Backend:
- `civic-hub/supabase/migrations/20260427200000_add_search_doc.sql` — `search_doc` column, trigger, GIN index, backfill, two RPC functions.
- `civic-hub/src/modules/civic.search/{models,service,index}.ts` — pluggable service module.
- `civic-hub/src/services/searchExecutor.ts` — concrete RPC adapters.
- `civic-hub/src/controllers/searchController.ts` — `GET /search` handler.
- `civic-hub/src/routes/searchRoutes.ts` — wires the controller; mounted in `app.ts` at `/search`.
- `civic-hub/src/app.ts` — route mount + entry in the root `/` JSON.

Frontend:
- `civic-hub/ui/src/services/api.ts` — `search()` wrapper + types.
- `civic-hub/ui/src/components/SearchBar.tsx` + `.css` — reusable search affordance.
- `civic-hub/ui/src/components/Nav.tsx` + `Nav.css` — `<SearchBar>` mounted.
- `civic-hub/ui/src/pages/Search.tsx` + `Search.css` — URL-bound results page.
- `civic-hub/ui/src/App.tsx` — `/search` route registered.

### Incomplete / future work

- **Comment search** (across `civic.input` rows). Out of scope for MVP.
- **Auto-suggest / typeahead.** Defer.
- **`ts_headline` highlighted snippets** in result cards. Skippable for v1.
- **Tag-based filtering / saved searches / search analytics** — separate slices.
- **Cross-hub federated search.** Future federation concern.

---

## Slice 10 — Feed polish: filter pills, engagement counts, popup rewrite — 2026-04-27

**Status:** Shipped UI-only — no backend changes, no migrations, no module edits. Three small features land on top of the post-Slice-9 feed:

1. **Filter pills above the feed.** Five pills (All / Votes / Announcements / Vote results / Meeting summaries) using the Slice 8 color tokens.
2. **Engagement-count line on each card.** Sits between summary and timestamp.
3. **IntroPopup rewrite.** Now a native `<dialog>` element with collapsed copy and two buttons.

### Files added / changed

- `civic-hub/ui/src/components/FeedFilter.tsx` + `.css` — new component.
- `civic-hub/ui/src/components/Feed.tsx` — engagement count fields + helpers.
- `civic-hub/ui/src/components/Feed.css` — `.feed-post-engagement` typography rule.
- `civic-hub/ui/src/components/FeedPost.tsx` — engagement field + restructured summaries.
- `civic-hub/ui/src/pages/Home.tsx` — composes `<FeedFilter>` + `<Feed>`.
- `civic-hub/ui/src/components/IntroPopup.tsx` — rewritten on native `<dialog>`.
- `civic-hub/ui/src/components/IntroPopup.css` — fresh styles.
- `civic-hub/ui/src/pages/About.tsx` + `civic-hub/ui/src/App.css` — "Show me the welcome again" affordance.

---

## Slice 9 — Rich post content: images, link previews, colored card borders — 2026-04-27

**Status:** Shipped end-to-end. Announcements and vote-results records can carry an admin-uploaded featured image (with required alt text), link preview cards for embedded URLs, and feed cards lead with the attached image when present. Email digest gets a small thumbnail when an image is present.

**Design pivot mid-slice:** dropped OG-image fallback and CSS-generated covers in favor of a thin 4px colored top border per kind. Feed page height roughly halved while keeping type signals via pill + border.

### Key files added

Backend:
- `civic-hub/supabase/migrations/20260427100000_post_images_and_link_previews.sql`
- `civic-hub/src/modules/civic.link_preview/{models,scraper,service,index}.ts`
- `civic-hub/src/controllers/uploadController.ts`, `linkPreviewController.ts`
- `civic-hub/src/services/postImageStorage.ts`, `linkPreviewCache.ts`, `linkPreviewFetcher.ts`
- `civic-hub/src/routes/uploadRoutes.ts`, `linkPreviewRoutes.ts`

Frontend:
- `civic-hub/ui/src/components/PostImagePicker.tsx` + `.css`
- `civic-hub/ui/src/components/PostFeaturedImage.tsx` + `.css`
- `civic-hub/ui/src/components/LinkPreviewCard.tsx` + `.css`

---

## Heading typeface swap: Fraunces → Manrope — 2026-04-27

**Status:** Operator decision. Fraunces replaced with Manrope — geometric sans, no serifs. Body face (Inter) unchanged.

---

## Slice 8.5 — Rename Civic Brief → Vote Results — 2026-04-27

**Status:** Cleanup slice. The `civic.brief` module renamed end-to-end to `civic.vote_results` (folder, type identifier, TypeScript symbols, controllers, routes, public + admin URLs, UI pages, API service wrappers, CSS pill tokens). Two visible behavior changes alongside the rename: (1) closed votes now produce exactly **one** feed post (the previous pair of "Civic Brief delivered" + "Vote results published" is gone), and (2) the public results page captures a snapshot of the original vote's description, options, and voting window so a viewer arriving cold can see what was being chosen between. The admin review-and-approve workflow is unchanged in behavior — only the name and presentation changed.

### Summary of name moves

| Old | New |
|---|---|
| `civic-hub/src/modules/civic.brief/` | `civic-hub/src/modules/civic.vote_results/` |
| `src/processes/briefProcess.ts` | `src/processes/voteResultsProcess.ts` |
| `src/controllers/briefController.ts` | `src/controllers/voteResultsController.ts` |
| `src/controllers/adminBriefController.ts` | `src/controllers/adminVoteResultsController.ts` |
| `src/routes/briefRoutes.ts` | `src/routes/voteResultsRoutes.ts` |
| `ui/src/pages/Brief.{tsx,css}` | `ui/src/pages/VoteResults.{tsx,css}` |
| `ui/src/pages/AdminBriefs.{tsx,css}` | `ui/src/pages/AdminVoteResults.{tsx,css}` |
| `BriefProcessState`, `BriefContent`, `BriefSummary`, `BriefDetail`, `PublicBrief`, `BriefContentPatch`, `BriefPublicationStatus`, `BriefPositionBreakdown`, `CreateBriefFromVoteInput` | `VoteResults*` counterparts |
| `createBriefState`, `editBrief`, `approveBrief`, `formatBriefEmail`, `emitBrief*` | `createVoteResultsState`, `editVoteResults`, `approveVoteResults`, `formatVoteResultsEmail`, `emitVoteResults*` |
| `getBriefRecipients`, `setBriefRecipients` | `getVoteResultsRecipients`, `setVoteResultsRecipients` |
| `adminListBriefs`, `adminGetBrief`, `adminPatchBrief`, `adminApproveBrief`, `getPublicBrief` | `adminListVoteResults`, `adminGetVoteResults`, `adminPatchVoteResults`, `adminApproveVoteResults`, `getPublicVoteResults` |
| Public route `/brief/:id` | `/vote-results/:id` (legacy 301 + SPA `<Navigate>`) |
| Admin routes `/admin/briefs/:id` | `/admin/vote-results/:id` (legacy 301 + SPA `<Navigate>`) |
| AdminTabs label "Civic Briefs" | "Vote results" |
| Feed pill class `.feed-pill--brief` | `.feed-pill--vote-results` |
| Theme tokens `--pill-brief-{bg,fg}` | `--pill-vote-results-{bg,fg}` (same hex, color family preserved) |
| Digest kind `brief_published` | `vote_results_published` |
| Digest kind `vote_result_published` | **removed** (vote `result_published` is no longer digest-renderable) |
| Event payload `data.brief_id` | `data.results_id` (both fields accepted indefinitely via shim) |

### What stayed the same on purpose

- **Env vars**: `BOARD_RECIPIENT_EMAIL`, `CIVIC_ADMIN_EMAILS`, `CRON_SECRET`, `RESEND_API_KEY`, `SMTP_*` — all unchanged. Existing Vercel and Supabase configurations don't break.
- **`hub_settings` DB key**: still `brief_recipient_emails`. The JS function name moved (`getBriefRecipients` → `getVoteResultsRecipients`) but the storage key didn't, so a `setBriefRecipients()` call from a previous session writes to the same row a `getVoteResultsRecipients()` call now reads from. Comment in `hubSettings.ts::SETTING_KEYS` documents this on purpose.
- **API field name**: `brief_recipient_emails` is still what `/admin/settings` returns and accepts. The Settings UI consumes that field and is operator-facing config — renaming the wire format would be a bigger coordination job.
- **Approval workflow**: human-in-the-loop admin review → email Board → publish to feed. The seven-step orchestration in `service.ts::approveVoteResults` is the same shape it was in `approveBrief`.
- **Pluggability**: a hub that doesn't register `civic.vote_results` (formerly `civic.brief`) in the registry still works — votes close, no results record is created, no admin review. Same behavior gate as before.
- **Civic Event Spec**: untouched. `civic.process.result_published` is still the event type. Only the discriminator field name in the payload changed.

### Backwards-compat shims (transitional, can be removed later)

Slice 8.5 events emitted on/after the rename carry `data.results_id`. Events emitted before still carry `data.brief_id`. Events are append-only by spec — we never rewrite them. Both fields are accepted indefinitely in:

- `civic-hub/ui/src/components/Feed.tsx::kindFromEvent`
- `civic-hub/ui/src/components/FeedPost.tsx::eventToPost` (announcement / meeting / vote-results discrimination)
- `civic-hub/src/modules/civic.digest/filter.ts::isDigestRenderable` + `classifyItemKind`

Process rows where `processes.type` hasn't yet been migrated still load via a transitional `type === "civic.brief"` alias in:

- `src/controllers/processController.ts::handleListProcesses` (public-list filter)
- `src/controllers/voteResultsController.ts::handleGetVoteResults` (public read)
- `src/controllers/adminVoteResultsController.ts::handleAdminListVoteResults` + `handleAdminGetVoteResults`
- `ui/src/pages/Votes.tsx::voteResultsByVote`
- `ui/src/components/FeedPost.tsx::FeedProcessKind` union
- `ui/src/components/FeedPost.tsx::eventToPost` (`cachedType === "civic.brief"`)

These transitional aliases keep the UI sane during the brief window between deploying the new code and the operator running the SQL migration. **Once the operator has applied the migration and a sufficient grace period for legacy events has passed (~3-6 months), the `civic.brief` branches can be deleted.** The legacy SPA route `/brief/:id` (a `<Navigate>` to `/vote-results/:id`) should stay indefinitely — it costs nothing and keeps stored event `action_url`s clickable forever.

### URL redirects — which path actually fires

Vercel's `vercel.json` rewrites `/(.*)` → `/index.html` for everything that isn't `/api/*`. So in production a browser navigating to a stored event `action_url` of the form `https://floyd.civic.social/brief/proc_abc123` lands on the SPA, not the Express backend. The operative redirect is therefore the React Router route in `ui/src/App.tsx`:

```tsx
<Route path="/brief/:id" element={<LegacyBriefRedirect />} />
// LegacyBriefRedirect pulls :id from useParams and returns
// <Navigate to={`/vote-results/${id}`} replace />
```

Verified live in this session: clicking a `/brief/:id` link in the feed (from a legacy event) takes the user to `/vote-results/:id` via the SPA without a full-page reload, and the page renders.

The Express `app.get("/brief/:id", ...)` 301 redirect is also wired and verified (`curl -is http://localhost:3000/brief/proc_x` returns 301 with `Location: /vote-results/proc_x`). It only fires for direct API/curl clients — but it's cheap and worth keeping for completeness. Same applies to the legacy admin routes; both `/admin/briefs` and `/admin/briefs/:id` redirect via React Router to the new paths.

### Vote-context snapshot

`VoteResultsContent` gained an optional `vote_context: VoteContextSnapshot` field carrying the original vote's `description`, `options` (as `{option_id, option_label}` pairs), and the voting window's `starts_at` / `ends_at`. The snapshot is captured at vote-results creation time inside `voteProcess.ts::spawnVoteResultsFromClosedVote` from the live vote process — so editing the vote process later wouldn't change the snapshot retroactively (intentional).

`vote_context` is **optional on the type and nullable on read** because vote-results records created before Slice 8.5 don't have the field. Both the public page (`VoteResults.tsx`) and the admin review form (`AdminVoteResults.tsx`) defend with a "Original vote context not available for this earlier record" notice rather than crashing. Verified live: legacy records render the fallback notice cleanly.

The slice prompt's example shape used `vote_options: Array<{ id: string; label: string }>`. I used `{option_id, option_label}` instead to match the existing `VoteResultsPositionBreakdown` field names — same data, consistent naming inside the module. This is the only spec deviation.

Vote options on `civic.vote` are stored as bare `string[]` (no separate label). The spawn site maps each option string into `{option_id: opt, option_label: opt}` — same convention `position_breakdown` already uses. When a future slice introduces real option labels distinct from option IDs, both the snapshot and the breakdown can pick them up uniformly.

### Email to Board

`formatVoteResultsEmail` updates:
- Subject: `"<Hub> — Vote results: <title>"` (was `"<Hub> — Civic Brief: <title>"`).
- Body heading: "Vote results" (was "Civic Brief").
- New "About this vote" section in both HTML and plain-text bodies — inline `vote_context.description` + bullet list of `vote_options` so the Board sees the original question, not just the tally and comments.
- Public link points to `/vote-results/:id`.

### DB migration

New file: `civic-hub/supabase/migrations/20260427000000_rename_civic_brief_to_vote_results.sql`.

Two `UPDATE` statements wrapped in a transaction:
1. `UPDATE processes SET type = 'civic.vote_results' WHERE type = 'civic.brief'`
2. `UPDATE processes SET state = jsonb_set(state, '{type}', '"civic.vote_results"', false) WHERE state ->> 'type' = 'civic.brief'`

**Operator-applied — Supabase migrations folder is not run automatically by the deploy.** Apply via Supabase → SQL Editor → New query → paste → Run. Verify with `SELECT type, COUNT(*) FROM processes GROUP BY type;` — expect zero `civic.brief` rows post-run.

The migration is **safe to run before, after, or alongside the code deploy** because of the transitional `civic.brief` aliases in the controllers + UI. Best practice is still: run the migration first, redeploy second.

### Verification done in this session

`npm run build` clean in both `civic-hub/` and `civic-hub/ui/`. UI bundle: 340.88 kB raw / 97.53 kB gzipped (up ~4 kB from Slice 8 — the new VoteResults page + admin vote-context block + legacy redirect components).

Live verification against the dev backend (port 3000, pointed at the Floyd Supabase) + dev UI (port 5173):

- **Pre-migration data** (the seeded DB still has rows of type `civic.brief`):
  - Feed renders **6 posts** (was 8 before this slice). The two pairs of "Civic Brief delivered" + "Vote results published" collapsed into single "Vote results" posts, exactly the duplicate elimination the slice was designed for.
  - All five pill kinds in the wild: VOTE OPEN (light blue), VOTE RESULTS (teal — the keeper), ADMIN ANNOUNCEMENT (orange), MEETING SUMMARY (green). The previous "vote-results" blue pill is gone.
  - Legacy `/brief/:id` action_urls in the feed → click → SPA `<Navigate>` lands on `/vote-results/:id` without a backend round-trip. Verified via `window.location.pathname`.
  - Public `/vote-results/:id` page renders with: VOTE RESULTS eyebrow, Fraunces "Vote results: <title>" heading, teal delivery banner ("Delivered to the Board of Supervisors on April 22, 2026."), "About this vote" section with the legacy fallback notice (italic muted), Results with bar breakdown + "N residents voted", "What residents said" with comments. Provenance footer at bottom.
  - Admin `/admin/vote-results` lists all 7 unmigrated records under the new tab label. Status filters work. Click-through opens the review form with the read-only "About this vote" block + community comments / admin notes textareas + "Approve and publish" button + the new confirmation copy.
  - Backend Express redirect for `/brief/:id`: `curl -is http://localhost:3000/brief/proc_test` returns `HTTP/1.1 301 Moved Permanently` with `Location: /vote-results/proc_test`. Verified.
- **No console errors** on any rendered surface.

End-to-end vote-close → admin review → approve was NOT exercised this session (no fresh vote close was triggered against the live backend). The new spawn-site code path (`spawnVoteResultsFromClosedVote`) and the renamed `approveVoteResults` orchestration build clean and were grep-verified, but a true post-deploy smoke test is in the operator walkthrough.

### Architectural notes — recorded so they outlive this slice

- **The vote `result_published` event is preserved on the event log but excluded from Feed and digest.** Federated consumers + audit tools still see it; resident-facing surfaces don't, because the vote-results publication already covers it. This is the simplest way to honor "events are append-only" while delivering the "one post per closed vote" UX.
- **Setting key vs function name divergence is intentional.** `hubSettings.SETTING_KEYS` says `VOTE_RESULTS_RECIPIENT_EMAILS: "brief_recipient_emails"` — the constant name is the new word, the underlying string remains the old word so the DB row keeps working. Documented at the constant definition.
- **All transitional shims are clearly comment-marked** with the rationale and a "remove after migration applied" note. The shim list above is the full inventory.
- **The legacy SPA redirect should never be removed**, even after the migration. It costs zero bytes once the redirect component is loaded and keeps the historical event log's `action_url`s clickable forever — important for any future federated consumer that mirrors this hub's events.

### Files touched / added

**Added (backend):**
- `civic-hub/supabase/migrations/20260427000000_rename_civic_brief_to_vote_results.sql`

**Renamed via `git mv` then content-edited (history preserved):**
- `civic-hub/src/modules/civic.brief/` → `civic-hub/src/modules/civic.vote_results/` (six files inside: models, service, events, lifecycle, email, index)
- `civic-hub/src/processes/briefProcess.ts` → `voteResultsProcess.ts`
- `civic-hub/src/controllers/briefController.ts` → `voteResultsController.ts`
- `civic-hub/src/controllers/adminBriefController.ts` → `adminVoteResultsController.ts`
- `civic-hub/src/routes/briefRoutes.ts` → `voteResultsRoutes.ts`
- `civic-hub/ui/src/pages/Brief.{tsx,css}` → `VoteResults.{tsx,css}`
- `civic-hub/ui/src/pages/AdminBriefs.{tsx,css}` → `AdminVoteResults.{tsx,css}`

**Modified (backend):**
- `civic-hub/src/processes/registry.ts` — handler key updated; rename comment added
- `civic-hub/src/processes/voteProcess.ts` — `spawnBriefFromClosedVote` → `spawnVoteResultsFromClosedVote`; new vote_context input fields plumbed; `getProcessHandler("civic.brief")` → `"civic.vote_results"`
- `civic-hub/src/services/hubSettings.ts` — function names + setting-key constant updated; storage key preserved
- `civic-hub/src/controllers/adminSettingsController.ts` — caller updated; API field name preserved
- `civic-hub/src/controllers/processController.ts` — public-list filter recognizes both type literals
- `civic-hub/src/routes/adminRoutes.ts` — paths now `/admin/vote-results/*`
- `civic-hub/src/app.ts` — mount `/vote-results`; legacy 301 redirect for `/brief/:id`; root `/` self-describing JSON updated
- `civic-hub/src/modules/civic.vote/index.ts` — two doc comments updated to reference the new module name
- `civic-hub/src/modules/civic.digest/models.ts` — `DigestItemKind`: rename `brief_published`, drop `vote_result_published`
- `civic-hub/src/modules/civic.digest/filter.ts` — top-of-file rule comment rewritten; `isDigestRenderable` + `classifyItemKind` now exclude vote `result_published` and accept either id field
- `civic-hub/src/modules/civic.digest/service.ts` — switch case + `GROUP_LABELS` + `PILL_COLORS` + `KIND_ORDER` use renamed kind

**Modified (frontend):**
- `civic-hub/ui/src/App.tsx` — new routes (`/vote-results/:id`, `/admin/vote-results[:id]`); legacy `/brief/:id` and `/admin/briefs[:id]` registered as `<Navigate>` redirects via `LegacyBriefRedirect` / `LegacyBriefAdminRedirect` wrappers; imports updated
- `civic-hub/ui/src/components/AdminTabs.tsx` — tab label "Vote results", target `/admin/vote-results`
- `civic-hub/ui/src/components/Feed.tsx` — `ProcessKind` union + `kindFromEvent` discrimination shim; metadata loader uses `getPublicVoteResults`
- `civic-hub/ui/src/components/FeedPost.tsx` — `FeedPillKind` collapses brief → vote-results; `FeedProcessKind` keeps `civic.brief` as legacy alias; `eventToPost` returns null for vote `result_published`; brief/vote-results branches collapsed; `classifyHref` recognizes both `/vote-results/:id` (primary) and `/brief/:id` (legacy fallback)
- `civic-hub/ui/src/components/Feed.css` — `.feed-pill--brief` → `.feed-pill--vote-results`; comment block explaining the collapse
- `civic-hub/ui/src/styles/theme.css` — `--pill-brief-*` tokens renamed to `--pill-vote-results-*`; hex values preserved
- `civic-hub/ui/src/services/api.ts` — three Brief* type renames (`PublishedBriefSummary`, `BriefSummary`, `BriefDetail`, `PublicBrief`, `BriefContent`, `BriefContentPatch`, `BriefPositionBreakdown`, `BriefPublicationStatus`); five service-wrapper renames; `VoteContextSnapshot` added
- `civic-hub/ui/src/pages/Votes.tsx` — discriminator updated (legacy alias kept); chip text + link updated
- `civic-hub/ui/src/pages/VoteResults.tsx` — full rewrite per Slice 8.5 §5 layout
- `civic-hub/ui/src/pages/VoteResults.css` — full rewrite; new `.vote-results-*` classes; existing `.brief-bars` / `.brief-comments-list` / `.brief-admin-notes` primitives kept under their old names because the admin page also reuses them
- `civic-hub/ui/src/pages/AdminVoteResults.tsx` — full rewrite per Slice 8.5 §6 (read-only "About this vote" block, vote-results copy throughout)
- `civic-hub/ui/src/pages/AdminVoteResults.css` — additions for `.admin-vote-context*` and `.admin-vote-description-preview`

### Operator setup walkthrough

1. **Apply the migration.** Supabase → SQL Editor → New query → paste contents of `supabase/migrations/20260427000000_rename_civic_brief_to_vote_results.sql` → Run. Verify with `SELECT type, COUNT(*) FROM processes GROUP BY type;` — expect zero rows with `type='civic.brief'`. The transitional shims in the deployed code make this safe to run before, after, or alongside the code deploy.
2. **Redeploy.** Push to GitHub; Vercel auto-deploys. Or **Deployments → latest → Redeploy** in the dashboard.
3. **Verify on the live site:**
   - Open the existing approved vote-results page that was previously titled "Civic Brief". The URL should redirect from `/brief/:id` → `/vote-results/:id`. The page heading should read "Vote results: …". The teal delivery banner should show "Delivered to the Board of Supervisors on …". Legacy records (created before Slice 8.5) should show the "Original vote context not available" notice in place of "About this vote" — that's expected.
   - **Feed: confirm one post per published vote, not two.** Previously you'd see "Civic Brief delivered: …" + "Vote results published: …" for the same close. Now just one "Vote results: …" post.
   - Open the daily digest email or trigger a manual run via `/api/internal/digest/run` (CRON_SECRET bearer required). Confirm vote-results items appear under "New vote results" and there are no "Vote results published" entries from the vote process directly.
   - Open `/admin/vote-results`. Tab label is "Vote results". Page heading is "Vote results". The list shows existing records.
4. **Trigger a fresh end-to-end run** if you have time: create a new vote, vote on it, close it, approve the results. Verify the new flow produces a results page with the **populated "About this vote" section** (vote description + options + voting window) — that's the proof the snapshot path works on fresh records.
5. **No env var changes.** `BOARD_RECIPIENT_EMAIL`, `CIVIC_ADMIN_EMAILS`, `RESEND_*`, `SMTP_*`, `CRON_SECRET`, etc. all keep working.

If anything looks off, the most likely culprits are: migration not applied (rows still type `civic.brief` — the transitional shims should still let everything render, but the admin URL will list 0 records if the shim is missed somewhere); a `data.brief_id` event slipping through the discrimination ladder; or a stale browser cache loading the old CSS without the renamed pill class.

### Flagged for later

- **Slice 10 prompt mentions "Briefs" as a filter pill label** — flag for update when Slice 10 is built. Filter pill labels for the feed should now use "Vote results" instead.
- **Transitional `civic.brief` aliases should be removed** in a future cleanup slice once the operator has confirmed the migration is applied and a grace period for legacy events has passed (suggest ~3-6 months).
- **The legacy SPA `/brief/:id` `<Navigate>` redirect should stay indefinitely.** Stored event action_urls live on the event log forever; removing the redirect would break clickability for any historical or federated consumer.

---

## Slice 8 — Visual redesign, nav restructure, feed post layout — 2026-04-25

**Status:** Frontend-only polish pass before public launch. Nav collapsed from 7 top-level items to 3 public links + role-aware avatar dropdown. Feed posts redone content-first with a colored type pill. Wider 1100px shell. Inter + Fraunces typography. Daily digest email mirrors the new feed layout. No backend changes outside the digest formatter; no data model touches.

### What changed at a glance

- **Nav:** wordmark + Feed/Votes/About + Sign-in (signed out) or avatar dropdown (signed in). Hamburger-driven drawer below 768px.
- **Feed posts:** title is the post's real content; a colored pill (Vote open / Vote results / Civic Brief / Meeting summary / role-aware Announcement) sits on the right of the title and drops below it on narrow viewports.
- **Type system:** Inter (body/UI) + Fraunces (headings), self-hosted via `@fontsource-variable/*`. New 8-step type scale + `--font-size-*` tokens.
- **Palette:** warmer `--color-bg` (#fafaf7), surface tokens, status tokens, and a five-key pill palette (`--pill-vote-bg/fg`, `--pill-results-*`, `--pill-brief-*`, `--pill-announcement-*`, `--pill-meeting-*`).
- **Layout:** `.page-shell` caps content at 1100px on the `<main>`. Banner + nav + footer stretch edge-to-edge; the Feed column stays 640px and centers inside the shell.
- **Timestamps:** unified `relativeTime` / `absoluteTime` helpers exported from `FeedPost.tsx`. Used on feed posts and on detail-page headers (Announcement, Brief, MeetingSummary). Less than 7 days renders relative; older renders absolute. Full datetime exposed via `title` attribute.
- **Empty states:** Feed, Votes (active + completed), and admin lists carry warmer copy.
- **Digest email:** title-first rows with inline-styled pills (hex literals matching the web `--pill-*` tokens). Plain-text alternative gains a `[Pill label]` suffix per row to retain the type signal.

### Font hosting decision

Variable fonts via `@fontsource-variable/inter@5.2.8` + `@fontsource-variable/fraunces@5.2.9`. **Self-hosted** — Vite bundles the woff2 files (10–85 kB each, latin/latin-ext/cyrillic/greek subsets) and emits `@font-face` declarations from the CSS index. No external CDN call, no privacy/CSP concerns, no build-config changes (plain ESM imports from `main.tsx`). Imported via the explicit CSS path:

```ts
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/fraunces/index.css'
```

The bare `@fontsource-variable/inter` form fails TypeScript module resolution because the package's `exports` map only declares `.css` paths (no JS entry).

### Pill colors — final palette + contrast

The `--pill-<kind>-bg/fg` token pairs were verified against WCAG AA at the 12px pill type size. Spot-check (announcement, the lightest fg/bg combo): bg `#fbe5d3`, fg `#8c3210` → 6.75:1 contrast, comfortably above the 4.5:1 small-text threshold. Other combinations (navy on light blue, dark teal on light teal, dark green on light green) all measured higher.

| Kind | Pill label | bg | fg | ~contrast |
|---|---|---|---|---|
| `vote-open` | "Vote open" | `#e0ecfc` | `#1e3a5f` | ≥7:1 |
| `vote-results` | "Vote results" | `#d6e4f7` | `#15325a` | ≥7:1 |
| `brief` | "Civic Brief" | `#d4ede8` | `#0f5a55` | ≥6:1 |
| `meeting` | "Meeting summary" | `#d9ecd9` | `#0f4a26` | 8.2:1 |
| `announcement` | role-aware | `#fbe5d3` | `#8c3210` | 6.8:1 |

Announcement pill text is role-aware: admin → "Admin announcement"; legacy `"board"` → "Board member announcement"; any free-form label → "{Label} announcement". Same normalization runs in the digest formatter so the email and the feed never diverge on labelling.

### Token additions to `theme.css`

Surface (`--color-bg`, `--color-surface`, `--color-surface-alt`, `--color-border`, `--color-border-strong`, `--color-text-muted`, `--color-text-faint`); primary ink (`--color-primary-ink`); status (`--color-success`, `--color-success-bg`, `--color-error`, `--color-error-bg`, `--color-warning`, `--color-warning-bg`); five pill pairs; the type scale (`--font-size-xs` through `--font-size-4xl`); line heights (`tight`/`normal`/`relaxed`); pill radius (`--radius-pill`); popover shadow (`--shadow-popover`); layout caps (`--max-width-shell`, `--max-width-feed`).

`index.css` was repointed to alias the legacy variable names (`--primary-color`, `--page-background`, etc.) onto the canonical tokens, so older component CSS (process cards, vote panel, admin pages) reads from the unified palette without per-file rewrites. Pre-Slice-1 CSS was the long tail flagged in the original `theme.css` header comment; the alias bridge resolves it for this slice without a full migration.

### `eventToPost` — new return shape

`FeedPostView` now carries `{ id, title, pillLabel, pillKind, summary, timestamp, href }` — no more event-type prefix baked into the title. The pill renders as a separate element. Parallel structure in the digest: `DigestItem` gained a `pill_label` field, populated in `eventToItem` and rendered as a colored span in the HTML email.

The component still does no fetching; the Feed container hydrates `processMeta` and feeds `getProcessTitle` / `getProcessDescription` / `getProcessType` callbacks to `eventToPost`. Same lazy-load behavior as before.

### Layout shell

A new `.page-shell` class wraps `<main>`. It is **width-only** (max-width 1100, margin auto) — no horizontal padding — so existing inner-page paddings (`.feed`, `.hub-info`, `.section`, admin bodies) keep working unchanged. Three admin CSS files (`AdminBriefs.css`, `AdminSettings.css`, `AdminMeetingSummaries.css`) had their hardcoded `max-width: 800px` removed; their bodies now stretch to the shell's 1100px cap with their own `padding: var(--space-md) var(--space-lg) var(--space-xl)`. The hub banner image is now 240px tall (up from 200) and the hero text uses `--font-size-3xl` for the jurisdiction name.

### Nav implementation notes

- The signed-out **Sign in** button opens `AuthModal` directly (new behavior — previously the modal only opened via `useRequireAuth` from VotePanel/Propose etc.). The existing `useRequireAuth` paths still work for action gating.
- **Avatar color** is deterministic from the user's email (32-bit hash mod 6 colors). All six backgrounds (navy, teal, terracotta, forest, violet, ochre) sit at low enough luminance that the white initial inside hits AA.
- **Dropdown a11y:** `aria-haspopup="menu"`, `aria-expanded`, `role="menu"` with `role="menuitem"` children. Click-outside / Escape close. Arrow keys cycle items, Home/End jump endpoints, Tab closes. Focus returns to the avatar on Escape.
- **Mobile drawer:** chosen over a full bottom sheet because it's simpler, hits the same thumb-reach goal at 375px (drawer items live at the top-third of the screen, not below the fold), and reuses the same dismiss/keyboard handling. Trade-off documented here in case a future slice wants the bottom-sheet polish.
- **Tap targets:** `min-height: 44px` on every nav link, drawer link, dropdown item, sign-in button, avatar (36×36 with hover halo extending the hit area), hamburger (44×44 explicit).

### Verification done in this session

Both `npm run build` (backend `tsc`) and `cd ui && npm run build` (UI `tsc -b && vite build`) finish clean. UI bundle: 336.66 kB raw / 96.80 kB gzipped (336.64 → 336.66 kB after the role-normalization tweak; previously 332.27 kB at end of Slice 6 — the 4 kB delta is the new pill markup, type scale, popover styles, drawer, and avatar). Font assets: 11 woff2 subsets, ~340 kB total — only the latin subset (~85 kB) loads on a typical en-US session.

Live verification against the dev backend (port 3000) + dev UI (port 5173):

- **Desktop 1440×900:** wordmark + 3 primary links + Sign in / avatar render in the new shell. Hub hero ("Floyd County, Virginia" in Fraunces 32px, "CIVIC HUB" eyebrow uppercase Inter, tagline in Inter at 16px) sits inside the 1100px cap. Feed cards render with title-first layout: meeting summary card shows "Reorganization Meeting" + green MEETING SUMMARY pill on the right; announcement cards show "Fire Ban Until May 31st" + orange ADMIN ANNOUNCEMENT pill; vote-results, brief, vote-open pills all rendering with their distinct colors.
- **Tablet 768×1024:** hamburger replaces the primary-link list; wordmark and Sign in / avatar stay visible. Hamburger-opened drawer renders Feed / Votes / About as full-tap-width rows.
- **Mobile 375×812:** same nav behavior as 768. Feed cards stack; pill drops below the title onto its own line, right-aligned via `margin-left: auto` (verified at 142.47px left margin on a wrapped pill — the wrap pushes it to the right edge).
- **Avatar dropdown (admin user):** click opens a menu containing SIGNED IN AS / email header, Settings / Post announcement / Admin panel / Log out items. Verified via `preview_eval`: 4 menuitems present, `role="menu"`, `aria-label="Account menu"`. Log out colored red via `--color-error`.
- **Pill type coverage:** all five kinds enumerated in the live feed (`feed-pill--meeting`, `--announcement`, `--vote-results`, `--brief`, `--vote-open`).
- **No console errors** on any rendered surface.
- **Sign-in button** opens `AuthModal` from the nav.

### Empty-state copy delivered

| Surface | Old | New |
|---|---|---|
| Feed (no events) | "No civic activity yet." | "Floyd's civic feed is just getting started. Visit **About** to learn how this hub works." (with inline link) |
| Votes / Active (no active, has completed) | "No active votes." | "No active votes right now. When the Board asks for resident input, it'll show up here." |
| Votes / Active (no votes anywhere) | "No active votes." | "Nothing here yet. Come back soon — the first issues will launch shortly." |
| Admin proposals (none) | "No proposals to review." | "No proposals yet. Resident-submitted issues land here for admin review before becoming votes." |
| Admin briefs (none) | already on-spec | unchanged |
| Admin meeting summaries (none) | already on-spec | unchanged |

Brief and meeting-summary admin lists already shipped acceptable empty copy in earlier slices (Slice 3.5, Slice 6); left as-is.

### Digest email cross-slice

`formatDigestHtml` rewritten to use a 2-cell `<table>` per item so the pill aligns to the right edge across email clients (Gmail, Outlook, Apple Mail). Inline styles only — `<style>` blocks get stripped. Hex pill colors mirror the web `--pill-*` tokens. Title font stack is `Fraunces, Georgia, 'Times New Roman', serif`; body is `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` — clients without Inter/Fraunces fall back gracefully.

`formatDigestText` keeps grouping but suffixes each row with `[Pill label]` so the type signal still travels in plain text. No new filter logic — the digest still emits exactly the four kinds it did in Slice 6 (vote/brief/meeting/announcement, with `vote_opened` and `vote_result_published` as separate kinds).

`DigestItem.pill_label` is the only schema addition in `models.ts`. No callers outside the service construct `DigestItem`s, so the change is contained.

### Small drift fixes discovered along the way

- `eventToPost` and `eventToItem` (digest) both treat `author_role: "admin"` (lowercase) the same as missing — both normalize to "Admin" so the pill reads "Admin announcement". The legacy code only checked the capitalized "Admin" form, which would have rendered "admin announcement" lowercase on whatever events were emitted with the lowercase role. The slice spec is explicit about admin → "Admin announcement".
- Removed the duplicated `formatDate` helpers from `Announcement.tsx` and `Brief.tsx` once they switched to the shared `relativeTime` / `absoluteTime` exports from `FeedPost.tsx`. `MeetingSummary.tsx` keeps its `formatDate` for the meeting calendar date itself (which is a fixed event date, not a publish event — should stay absolute) but uses the shared helpers for `published_at`.
- `index.css` no longer defines its own `--primary-color`, `--page-background`, etc. — those names are now aliases pointing into the canonical tokens in `theme.css`. So the warmer `--color-bg` cascades automatically into older component CSS that referenced `--page-background`.
- `prefers-reduced-motion` honored globally in `index.css` (animations + transitions reduced to ~0ms).
- Viewport `<meta>` confirmed correct in `index.html` (was already set).

### What was NOT touched (per slice's non-goals)

Image attachments, link previews, OG scraping, no-image gradient fallback (Slice 9). Filter pills, engagement counts, IntroPopup rewrite (Slice 10). Search / sort. Backend modules outside `civic.digest`. Event model. Process registry. Dark mode.

### Operator verification walkthrough

1. **Redeploy.** Push to GitHub; Vercel auto-deploys. Or **Deployments → latest → Redeploy** in the dashboard.
2. **Three viewports.** Open the live site at:
   - **Phone / 375 px wide:** hamburger left, wordmark middle, avatar (or Sign in) right. Tap hamburger → Feed / Votes / About in a drawer. Posts stack; pill drops below the title (not truncated).
   - **Tablet / 768 px:** same as phone — confirm the transition is clean.
   - **Desktop / 1440 px+:** wordmark + 3 primary links + avatar all on one bar; hub identity wider; the Main Street banner has more breathing room.
3. **Typography.** Headings should read in the warm Fraunces serif; body in clean Inter. If everything looks like the OS system font, the web fonts didn't load — refresh once; if still broken, flag it.
4. **All pill kinds.** Scan the feed for: a vote open (light-blue VOTE OPEN pill), a vote results (slightly-darker-blue VOTE RESULTS), a brief (teal CIVIC BRIEF), an announcement (orange ADMIN ANNOUNCEMENT or "{Label} ANNOUNCEMENT"), a meeting summary (green MEETING SUMMARY). If you can't find one, post a test item via the appropriate flow.
5. **Avatar dropdown.** Click the avatar circle. Confirm the menu shows your email, Settings, Post announcement, Admin panel, Log out. Tab through with the keyboard; Escape closes.
6. **Daily digest.** Open the next scheduled email (or trigger a manual cron run). Confirm titles lead, colored pills follow on the right, grouping is preserved.
7. **Approve or flag.** Iterate on whatever doesn't read right.

**Before / after summary:** Nav went from 7 items to 3 + avatar dropdown. Feed posts went from prefix-titles ("admin announcement: Fire Ban…") to content-first with a color pill ("Fire Ban Until May 31st" + ADMIN ANNOUNCEMENT). Site width 800 → 1100. Typography system fonts → Fraunces (headings) / Inter (body). Empty states warmer. Daily digest mirrors the new feed.

### Files touched / added

**Modified (frontend):**
- `civic-hub/ui/package.json` — added `@fontsource-variable/inter`, `@fontsource-variable/fraunces`
- `civic-hub/ui/src/main.tsx` — import the two font CSS files
- `civic-hub/ui/src/styles/theme.css` — extended palette, type scale, layout caps, pill tokens
- `civic-hub/ui/src/index.css` — body font/bg from new tokens; legacy var aliases; reduced-motion media query
- `civic-hub/ui/src/App.css` — `.page-shell` width cap; banner height; hub-info typography; footer max-width
- `civic-hub/ui/src/App.tsx` — `<main className="page-shell">`
- `civic-hub/ui/src/components/Nav.tsx` — full rewrite (wordmark, hamburger, avatar dropdown, AuthModal hook)
- `civic-hub/ui/src/components/Nav.css` — full rewrite
- `civic-hub/ui/src/components/Feed.tsx` — empty-state copy + inline About link import
- `civic-hub/ui/src/components/Feed.css` — pill row layout, summary clamp, hover state
- `civic-hub/ui/src/components/FeedPost.tsx` — `eventToPost` returns `{ pillLabel, pillKind }`; component renders pill; `relativeTime` / `absoluteTime` exported; lowercase-admin normalization
- `civic-hub/ui/src/pages/Announcement.tsx` — relative timestamps via shared helper; removed local `formatDate`
- `civic-hub/ui/src/pages/Brief.tsx` — same
- `civic-hub/ui/src/pages/MeetingSummary.tsx` — relative `published_at` (kept absolute meeting_date)
- `civic-hub/ui/src/pages/Votes.tsx` — empty-state copy
- `civic-hub/ui/src/pages/AdminProposals.tsx` — empty-state copy
- `civic-hub/ui/src/pages/AdminBriefs.css` — removed 800px cap (shell handles it)
- `civic-hub/ui/src/pages/AdminSettings.css` — same
- `civic-hub/ui/src/pages/AdminMeetingSummaries.css` — same

**Modified (backend):**
- `civic-hub/src/modules/civic.digest/models.ts` — added `pill_label` to `DigestItem`
- `civic-hub/src/modules/civic.digest/service.ts` — populate `pill_label` per kind; HTML rewritten with table-row + pill markup; plain-text suffixed with `[Pill label]`; lowercase-admin normalization

**No additions** of new source files. **No deletions**.

---

## Slice 6 — AI meeting summary process (civic.meeting_summary) — 2026-04-24

**Status:** New `civic.meeting_summary` process type plus a Vercel-Cron-triggered daily pipeline that scrapes the Floyd Board of Supervisors minutes page, pulls each new meeting's PDF minutes + YouTube auto-transcript, asks Claude for a topic-timestamped summary, and creates a draft for admin review. Admin approval emits `civic.process.outcome_recorded` + `civic.process.result_published` and publishes the summary at `/meeting-summary/:id`. Feed + daily digest both surface the new kind.

### Dual-archetype module — process-type + service pipeline in one folder

`civic-hub/src/modules/civic.meeting_summary/` is simultaneously a process-type module (registered in the registry, produces read models, emits lifecycle events) and hosts a service module (the scraping + summarization pipeline invoked by cron). Both halves obey the same portability rule as every other module: no imports from the hub's event store, DB client, other modules, or the routes layer — everything is injected. Worth recording as a design principle alongside the `civic.digest` service-module pattern noted in Slice 5; I elected not to touch CLAUDE.md this pass since the guidance already reads "service modules and process-type modules live under `/modules/`, pluggability rules apply to both." A single CLAUDE.md entry when the third such module lands would consolidate cleanly.

### Lifecycle compliance — skipped phases

Meeting summaries skip Civic Process Spec Phases 1–3 (Framing, Activation, Participation) for the same reason `civic.announcement` does: the process has no participation window. The civic work begins at Phase 4 (Aggregation, the AI summarization step) and completes at Phase 6 (Publication). Emitted events per lifecycle phase:

| Phase | Event | Where emitted |
|---|---|---|
| 0 Initiation | `civic.process.created` | `processService.createProcess` (auto) |
| 4 Aggregation | `civic.process.aggregation_completed` | module, synchronously after creation |
| (admin edits)  | `civic.process.updated` | module, per edit |
| 5 Outcome/Decision | `civic.process.outcome_recorded` | module, on approval (`outcome_type: "informational"`) |
| 6 Publication | `civic.process.result_published` | module, on approval |

No `civic.process.ended` (never participation-active so never ends participation) and no `civic.process.feedback_received` in MVP (no resident-facing feedback surface). Same documented deviation shape as civic.announcement (Slice 4 HANDOFF).

### Process-level status — mirrors civic.brief

Starts `"active"` at creation (Phase 0 + Phase 4 complete together), jumps to `"finalized"` on approval publication. `"draft"` and `"closed"` are both skipped. This is the same deviation from Civic Process Spec §6.2 that civic.brief carries (Slice 3 HANDOFF). Recorded once there, referenced here — no fresh debate.

### Process linking — intentionally none

Meeting summaries do NOT populate `follow_up_process_ids` or `source_process_ids`. Per Civic Process Spec §11.3, process linking is for chains of civic activity *between Civic Processes*. A meeting summary's source is an external meeting (a PDF on a government site + a YouTube recording), not another Civic Process. Provenance lives in `state.source_minutes_url` and `state.source_video_url` instead. This rationale is flagged here so it isn't relitigated in a future compliance pass.

### Things verified before writing code

- **YouTube transcript access.** Used the unofficial `youtube-transcript` npm library (v1.3.0) — consumes YouTube's public `timedtext` endpoint via both the InnerTube API and a webpage-scraping fallback. No API key. **Fragility profile:** unofficial endpoint, can change without notice. `YOUTUBE_API_KEY` env var is reserved but unused in MVP. Transcript failures are non-fatal — the pipeline falls back to PDF-only summarization with a warning log. Documented in `src/utils/youtube.ts` and `.env.example`.
  - Packaging quirk: the library's `package.json` sets `"type": "module"` but points `main` at a CJS-style bundle (`exports.X = …` assignments), so plain `import { YoutubeTranscript } from "youtube-transcript"` fails under ESM Node. We import the ESM file directly: `import ... from "youtube-transcript/dist/youtube-transcript.esm.js"`. If a future release renames that file this one line breaks — comment in `youtube.ts` explains the workaround.
- **Claude PDF input shape.** Anthropic Messages API accepts native PDF document blocks: `{type: "document", source: {type: "base64", media_type: "application/pdf", data: <base64>}}`. No `pdf-parse` or text-extraction step. Size limits of ~32MB/~100 pages are comfortable for Floyd minutes (<2MB typical).
- **Anthropic model choice.** Default `claude-sonnet-4-5-20251022` — Sonnet-tier, cost-reasonable for multi-document summarization. Pinned in `src/utils/anthropic.ts` as `DEFAULT_MODEL`, overridable via `ANTHROPIC_MODEL` env var. The response body carries the model id back, which we record in `state.ai_model` for provenance.
- **Vercel plan constraint.** Added a second daily cron (`/api/internal/meeting-summary/run` at 11:30 UTC, 30 min before the 13:00 UTC digest run). If the deployment is still on Vercel Hobby and Hobby caps daily cron count, upgrade to Pro — flag for the operator, not a known issue.
- **Floyd minutes page characteristics** (verified in the prompt, not re-verified here): server-rendered Wix page, PDF URLs follow `/_files/ugd/{bucket}_{hash}.pdf` pattern across multiple buckets, YouTube watch URLs are canonical, multiple videos per meeting are common, some meetings have no video. Pattern baked into `connectors/floydMinutes.ts`.

### Backend — civic.meeting_summary module

`civic-hub/src/modules/civic.meeting_summary/` — seven files:

- `models.ts` — `SummaryBlock`, `MeetingSummaryProcessState`, `CreateMeetingSummaryInput`, `MeetingSummaryPatch`, `MeetingSummaryConfig`, the pluggable `MeetingSourceConnector` interface + `MeetingEntry`, and all injected-callback types (`EmitEventFn`, `FetchHtmlFn`, `FetchPdfFn`, `FetchYouTubeTranscriptFn`, `CallClaudeFn`). No hub imports.
- `lifecycle.ts` — `canEdit`, `canApprove`, `assertApprovalTransition` mirroring civic.brief.
- `events.ts` — four emitters: `emitMeetingSummaryAggregationCompleted` (Phase 4), `emitMeetingSummaryUpdated` (edits), `emitMeetingSummaryOutcomeRecorded` (Phase 5), `emitMeetingSummaryResultPublished` (Phase 6). All set `action_url_path = /meeting-summary/:id`. `result_published` carries `data.meeting_summary = {id, meeting_title, meeting_date, block_count}` as the primary Feed/digest discriminator, plus provenance links (`source_video_url`, `source_minutes_url`) so consumers don't need a second fetch.
- `prompts.ts` — two exported string builders: `buildDiscoveryPrompt` (minutes-page HTML → JSON array of `MeetingEntry`) and `buildSummarizationPrompt` (PDF + transcript → JSON `{blocks}` object). Both prepend the admin's `MEETING_EXTRACTION_INSTRUCTIONS` verbatim inside `<admin_instructions>` tags. `resolveEffectiveInstructions` returns a generic fallback string when the env var is empty.
- `service.ts` — pure state transitions: `createMeetingSummaryState`, `emitCreationEvents`, `editMeetingSummary`, `approveMeetingSummary`, `getAdminReadModel`, `getPublicReadModel`, `getAdminSummary`, `buildProcessDescription`. Approval is linear (`pending → approved` emit `outcome_recorded` → `published` emit `result_published`); no email delivery, no linked-vote step — simpler than `approveBrief`. Exports `AI_ATTRIBUTION_LABEL` constant shipped on every state so federated consumers see the disclaimer without relying on UI chrome.
- `pipeline.ts` — cron flow as pure functions: `discoverMeetings`, `summarizeMeeting`, `buildCreateInput`, `buildDescription`. No I/O of its own; every effect is injected. The summarizer tolerates transcript failure (falls back to PDF-only), formats transcripts as `[HH:MM:SS] text` lines before sending to Claude, parses Claude's JSON with tolerance for markdown-fenced output (`extractJsonObject` / `parseJsonArray`).
- `connectors/floydMinutes.ts` — ships the `floydMinutesConnector` with id `"floyd-minutes-page"`. Uses `cheerio` to strip Wix chrome (scripts, styles, svgs, images, meta, aria-hidden) and prefer `<main>` over `<body>` before sending to Claude. Preserves `<a href>` attributes. Logs `trimmed html {before}→{after}` for every discovery. Validates returned entries against domain-specific regex (PDF path, YouTube watch pattern, ISO date), drops malformed entries with a warn log.
- `index.ts` — public surface. Exports the `PROCESS_DESCRIPTOR` constant.

### Backend — utility clients

- `src/utils/anthropic.ts` — tiny client posting to `https://api.anthropic.com/v1/messages`. No SDK. Accepts a text prompt + optional base64 document block. One in-function retry on HTTP 5xx / network failure with a 2s backoff, then give up (matches the slice scope — no complex retry). `DEFAULT_MODEL = "claude-sonnet-4-5-20251022"`; override via `ANTHROPIC_MODEL`. Returns `{text, model, usage}`.
- `src/utils/youtube.ts` — `extractVideoId(watchUrl)` + `fetchYouTubeTranscript(watchUrl)`. Thin wrapper over `youtube-transcript` imported via its ESM path. Converts millisecond offsets to seconds for downstream use.
- `src/utils/http.ts` — `fetchHtml` / `fetchPdf` with abort-controller timeouts (15s / 30s), user-agent headers, banned non-http(s) schemes as a minimal hardening step.

None of these are imported by the module itself — they're wired in through the controller. A hub using a different LLM or transcript source plugs in different implementations without touching the module.

### Backend — adapter + controller + routes

- `src/processes/meetingSummaryProcess.ts` — thin `ProcessHandler` adapter. `initializeState` accepts `CreateMeetingSummaryInput` and bakes `status: "active"` into the returned state so `processService.createProcess` reads it as the row's process status. `handleAction` throws (summaries don't route through the generic action dispatcher). Registered in `src/processes/registry.ts` — header comment extended to note the module's opt-in nature.
- `src/controllers/meetingSummaryController.ts` — five handlers:
  - `handleRunMeetingSummary` (cron): CRON_SECRET bearer auth, `MEETING_SUMMARY_ENABLED=false` short-circuit, 500 when `ANTHROPIC_API_KEY` / `MEETING_SOURCE_URL` unset, connector lookup, per-entry dedupe by `source_id`, per-meeting failure isolation, structured `[meeting-summary]` logs, `{discovered, created, skipped_existing, failed, duration_ms}` response shape.
  - `handleAdminListMeetingSummaries` / `handleAdminGetMeetingSummary` / `handlePatchMeetingSummary` / `handleApproveMeetingSummary` — mirror `adminBriefController` patterns. Sort pending first, then approved, then published; newest-first within each bucket.
  - `handleGetPublicMeetingSummary` — public read, 404 for unpublished.
- `src/routes/meetingSummaryRoutes.ts` — `meetingSummaryCronRouter` (cron) + default public router.
- `src/routes/adminRoutes.ts` — four new routes under existing `requireAdmin`.
- `src/controllers/processController.ts::handleListProcesses` — public-list filter extended to also hide non-published meeting summaries (parallels the existing civic.brief filter).
- `src/app.ts` — mounts `/meeting-summary` public, mounts the cron router under `/internal` next to the digest cron, documents all five new endpoints in the root `/` self-describing JSON.

### Frontend — two new pages + cross-slice updates

- `ui/src/pages/AdminMeetingSummaries.{tsx,css}` — list + review. Four-status filter (All / Pending / Approved / Published). Review view: editable meeting title, editable topic-block list (per-row title + summary + HH:MM:SS timestamp + action-taken + reorder ↑/↓ + delete + add-block), editable admin notes, save draft, approve-and-publish with confirmation. Prominent AI-generated disclaimer banner on every admin review view. Timestamp input accepts HH:MM:SS, MM:SS, or plain seconds and parses to `start_time_seconds` (null when the meeting has no video, disabling the input).
- `ui/src/pages/MeetingSummary.{tsx,css}` — public page at `/meeting-summary/:id`. Theme-token styling only. Header + AI disclaimer banner (text differs for video-less meetings: "AI-generated from minutes document only — no video recording available"). Provenance chips: View minutes PDF · Watch recording · Recording (segment N) for each additional video. Topic blocks rendered as cards: clickable HH:MM:SS timestamp chip (absent when `start_time_seconds === null`) linking to `{watch_url}?t=<n>s`, topic title, topic summary, optional "Action taken" callout. Admin notes section at the bottom.
- `ui/src/components/AdminTabs.tsx` — added "Meeting summaries" tab between Civic Briefs and Settings.
- `ui/src/App.tsx` — `/admin/meeting-summaries`, `/admin/meeting-summaries/:id`, `/meeting-summary/:id` routes.
- `ui/src/services/api.ts` — `SummaryBlock`, `MeetingSummarySummary`, `MeetingSummaryDetail`, `PublicMeetingSummary`, `MeetingSummaryPatch` types; `adminListMeetingSummaries`, `adminGetMeetingSummary`, `adminPatchMeetingSummary`, `adminApproveMeetingSummary`, `getMeetingSummary` wrappers.
- `ui/src/components/Feed.tsx` — `FeedProcessKind` extended with `civic.meeting_summary`; `kindFromEvent` branches on `data.meeting_summary` / `data.summary_id`; metadata loader fetches via `getMeetingSummary(id)` (parallel to `getPublicBrief`).
- `ui/src/components/FeedPost.tsx` — `civic.process.result_published` branch for meeting summaries renders `"Meeting summary: <formatted date>"` with summary `"<meeting_title> — <n> topic{s} covered."`. `classifyHref` treats `/meeting-summary/:id` as an internal SPA route.

### Cross-slice — Feed and digest stay in sync (now four kinds)

- `src/modules/civic.digest/models.ts` — `DigestItemKind` extended with `"meeting_summary_published"`.
- `src/modules/civic.digest/filter.ts` — `classifyItemKind` discriminates on `data.meeting_summary` / `data.summary_id`; `KIND_ORDER` places meeting summaries between briefs and announcements. Top-of-file comment updated to list all four kinds as of Slice 6.
- `src/modules/civic.digest/service.ts` — `GROUP_LABELS` gains "New meeting summaries"; `eventToItem` has a `meeting_summary_published` case that builds `"Meeting summary: <formatted date>"` titles with `"<meeting_title> — <n> topic{s} covered."` summaries. Shared `formatMeetingDate` helper.

Invariant: the Feed and the digest filter render the same set of event kinds, in the same discrimination order. Both sides still duplicate the rules (kept in sync by convention, not extraction to a shared module — future cleanup).

### Vercel + environment configuration

`civic-hub/vercel.json` — second cron entry added:

```json
{ "path": "/api/internal/meeting-summary/run", "schedule": "30 11 * * *" }
```

11:30 UTC = 07:30 EDT / 06:30 EST, 90 min before the 13:00 UTC digest. Chosen so newly-generated summaries (in `pending`, don't emit `result_published` until admin approves) are created before the digest window — though in practice there's no race because the digest only sees published events.

`.env.example` — new section for Slice 6 with seven env vars documented:
- `ANTHROPIC_API_KEY` — required. Starts with `sk-ant-…`. Cron returns 500 if unset.
- `ANTHROPIC_MODEL` — optional; overrides `DEFAULT_MODEL = "claude-sonnet-4-5-20251022"`.
- `YOUTUBE_API_KEY` — reserved for future slice; unused in MVP.
- `MEETING_SUMMARY_ENABLED` — `"true"` (default) / `"false"`. Runtime kill-switch.
- `MEETING_SOURCE_URL` — e.g. `https://www.floydcova.gov/agendas-minutes`. Required.
- `MEETING_CONNECTOR_ID` — optional; defaults to `"floyd-minutes-page"`.
- `MEETING_EXTRACTION_INSTRUCTIONS` — optional long-form admin guidance prepended to both Claude prompts. Built-in fallback used when unset. Starter suggestion for Floyd included in the env var comment.

Reused unchanged: `CRON_SECRET`, `BASE_URL`, `CIVIC_UI_BASE_URL`, `HUB_NAME`, `CIVIC_ADMIN_EMAILS`.

### New dependencies

- `cheerio@^1.2.0` — HTML parsing for the Floyd connector's HTML-trimming step.
- `youtube-transcript@^1.3.0` — unofficial YouTube transcript fetcher.

### Preview verification

Both `npm run build` (backend tsc) and `cd ui && npm run build` (UI tsc + vite) complete cleanly with no TypeScript errors. UI bundle sizes 332.27 kB raw / 95.61 kB gzipped (slight increase from Slice 5's 316.75 kB / 92.92 kB — the new page + state types).

Ran the dev UI against the dev backend:
- `/meeting-summary/not-a-real-id` returns the themed 404 page ("Meeting summary not found") — expected.
- `/admin/meeting-summaries` renders the shared AdminTabs (four tabs: Proposals · Civic Briefs · **Meeting summaries** · Settings), the heading, the subtitle, the four status filters (All / Pending / Approved / Published), the "Authentication required" error when unauthed — all expected.
- Direct curl against the three new endpoints without auth returns the correct status codes: public read → 404, cron without `CRON_SECRET` → 401, admin list without session → 401.
- No browser console errors on either page render.

End-to-end (cron discovery → summarization → admin approval → publication) **was NOT exercised in this session** because (a) `ANTHROPIC_API_KEY` is not set in the local `.env`, (b) the minutes page fetch would spend real API credits on every run, and (c) `CRON_SECRET` is not set locally either. Route gates and HTTP plumbing are verified; full-flow smoke testing needs a production or preview Vercel environment with the new env vars configured. Operator walkthrough below covers that setup.

### Architectural decisions — recorded here so they outlive this slice

- **Meeting is the source, not the process.** A Civic Process linking is for chains of civic activity *between* Civic Processes (Process Spec §11.3). A meeting is external to the hub's process graph — the summary's source lives in `state.source_minutes_url` / `state.source_video_url`. If the spec later formalizes external-source linking, this module gains a new field without reshaping.
- **Admin-customizable extraction instructions live in an env var for MVP.** A dedicated admin UI to edit `MEETING_EXTRACTION_INSTRUCTIONS` is a future slice. The env var + fallback string + inline editor UI is a three-slice arc; the first slice (env var only) is MVP-sufficient.
- **One video per meeting in MVP.** The Floyd page commonly carries multiple recordings per meeting (segment 1 / segment 2 when a livestream drops). MVP summarizes only the first — `state.additional_video_urls` captures the rest for transparency (displayed on the public page, not fed into Claude). Full-meeting coverage is a flagged future enhancement.
- **Events don't fire for cron run internals.** No `crawl_started` / `crawl_completed` events. Cron infrastructure isn't civic activity; structured `[meeting-summary]` logs carry the audit trail (same philosophy as `civic.digest`).
- **Approval is linear, not gated by email delivery.** No external-recipient delivery step (unlike civic.brief). Approval → outcome_recorded → result_published, inline.

### Scale limits — flagged for future attention

- **Floyd cadence only.** The pipeline is sized for ~1–2 new meetings per run. On a first-ever run against a fresh deployment, Floyd's page lists dozens of historical meetings — the initial backfill will process all of them (expect several minutes of Vercel function time and $5–15 of API cost). Operator walkthrough step 6 flags this. Beyond Floyd's cadence (>5 new meetings/run), batching / parallelization is a future concern.
- **YouTube transcript fragility.** The `youtube-transcript` library consumes the public `timedtext` / InnerTube endpoints. If either changes upstream, transcript fetches will start failing — pipeline catches and falls back to PDF-only summarization, but summaries lose timestamp grounding. Flagged; future mitigation is either another library or pinning a downloader of our own.
- **Discovery is the critical path.** If Claude fails to parse Floyd's HTML (site-wide Wix rewrite, page renamed), discovery throws and the whole run aborts. Individual-meeting summarization failures are isolated, but discovery is not. Acceptable for MVP — the failure mode is clear and the operator sees a 500 from the cron.
- **Vercel function timeout.** Pro plan = 60s. A 10-meeting first run could push this. If timeouts become a pattern, flip to batched runs (multiple short runs rather than one long one) or raise to Enterprise.
- **No per-meeting retry on a later cron run.** When `summarizeMeeting` throws for a specific meeting, the `source_id` is NOT added to `existingSourceIds` for this run, but on the next day's run the meeting is still "new" (no process row exists) and the pipeline will re-try. A permanent failure mode (corrupted PDF, etc.) will silently fail every day. Acceptable for MVP; a "failed_source_ids" shadow table is a future concern.

### Non-goals honored

- No speaker diarization, no AssemblyAI / Deepgram / Whisper.
- No direct YouTube scraping for meeting discovery.
- No authoritative transcript framing — every surface carries the AI-generated disclaimer.
- No multi-language summaries.
- No admin UI for editing `MEETING_EXTRACTION_INSTRUCTIONS` (future slice).
- No automatic re-summarization of an already-processed meeting.
- No complex retry logic beyond one in-function retry on transient API failure.
- No batching / queue architecture.
- No ActivityPub / federation exposure — data model is federation-ready (events flow through `emitEvent`, `state` is a plain object, provenance links travel on `result_published` data).

### Files touched / added

**Added (backend):**
- `civic-hub/src/modules/civic.meeting_summary/{models,lifecycle,events,prompts,service,pipeline,index}.ts`
- `civic-hub/src/modules/civic.meeting_summary/connectors/floydMinutes.ts`
- `civic-hub/src/processes/meetingSummaryProcess.ts`
- `civic-hub/src/controllers/meetingSummaryController.ts`
- `civic-hub/src/routes/meetingSummaryRoutes.ts`
- `civic-hub/src/utils/{anthropic,youtube,http}.ts`

**Modified (backend):**
- `civic-hub/src/processes/registry.ts` — register civic.meeting_summary; comment extended
- `civic-hub/src/routes/adminRoutes.ts` — four new meeting-summary admin routes
- `civic-hub/src/app.ts` — mount `/meeting-summary` + cron router under `/internal`; document endpoints
- `civic-hub/src/controllers/processController.ts` — public-list filter hides non-published summaries
- `civic-hub/src/modules/civic.digest/{models,filter,service}.ts` — fourth digest kind `meeting_summary_published`
- `civic-hub/package.json` — `cheerio`, `youtube-transcript`
- `civic-hub/vercel.json` — second cron entry
- `civic-hub/.env.example` — seven new env vars documented

**Added (frontend):**
- `civic-hub/ui/src/pages/AdminMeetingSummaries.{tsx,css}`
- `civic-hub/ui/src/pages/MeetingSummary.{tsx,css}`

**Modified (frontend):**
- `civic-hub/ui/src/App.tsx` — three new routes
- `civic-hub/ui/src/services/api.ts` — types + wrappers
- `civic-hub/ui/src/components/AdminTabs.tsx` — Meeting summaries tab
- `civic-hub/ui/src/components/Feed.tsx` — kindFromEvent + metadata loader
- `civic-hub/ui/src/components/FeedPost.tsx` — result_published meeting-summary branch; classifyHref

---

## Slice 5 — Daily email digest — 2026-04-23

**Status:** A Vercel-Cron-triggered daily job assembles a per-user summary of new civic activity since that user's last digest and delivers it via Resend. Users are auto-subscribed on account creation (opt-out) and can unsubscribe via a signed link in every email or a toggle on the new `/settings` page. Digest delivery is infrastructure — no civic events are emitted for sends; structured `console.log` lines carry the audit trail.

### Module archetype — service module, not a process-type module

This is the first **service module** the hub has registered. `civic.digest` is not a civic process; it never appears in the process registry, never stores process state, and never owns a lifecycle. It's a background capability wired into the hub through a single controller.

The pluggability rules from the process-type modules carry over verbatim: `civic.digest/*` does not import from the hub's event store, DB client, other modules, or the route layer. The hub injects everything (event list, user list, email sender) as function arguments. A hub that doesn't want digests simply doesn't mount `digestRoutes.ts` — nothing else in the codebase depends on the module being loaded.

This distinction (service module vs process-type module) is worth formalizing in `CLAUDE.md` as a design principle when the pattern appears again. For now it's flagged here.

### Backend

#### civic.digest module — `civic-hub/src/modules/civic.digest/`

Five files, fully self-contained:
- `models.ts` — `DigestEvent`, `DigestUser`, `DigestHubContext`, `DigestItem`, `DigestEmail`, `DigestAssemblyInput`. Minimal views of the civic objects — the module never imports the hub's `CivicEvent` or `User` types directly.
- `filter.ts` — `isDigestRenderable(event)` + `classifyItemKind(event)` + `sortDigestItems(items)`. Canonical list of which `event_type` / data-shape combinations are "digest-renderable." Comment at the top requires this to stay in sync with the Feed's filter in `ui/src/components/Feed.tsx` + `ui/src/components/FeedPost.tsx`.
- `service.ts` — `assembleDigestForUser(input)` returns a `DigestEmail` or `null` (null = skip). `formatDigestHtml` / `formatDigestText` are exported for direct use / testing. HTML is inline-styled for email-client compatibility; plaintext is grouped the same way.
- `unsubscribe.ts` — `buildUnsubscribeToken`, `verifyUnsubscribeToken`, `buildUnsubscribeUrl`. HMAC-SHA256 over `base64url(JSON.stringify({uid, p: "unsub_digest"}))`. Timing-safe signature compare. No expiry — unsubscribe links work forever.
- `index.ts` — public surface.

#### User schema — migration 005

`civic-hub/supabase/migrations/20260423000000_digest_subscription.sql` adds two columns to `users`:
- `digest_subscribed BOOLEAN NOT NULL DEFAULT TRUE`
- `last_digest_sent_at TIMESTAMPTZ` (nullable — null means never sent)

Plus a partial index on `digest_subscribed = TRUE` so the cron's subscriber scan stays cheap as user count grows. Existing users retroactively enroll (opt-out model).

`civic-hub/src/modules/civic.auth/models.ts` + `index.ts` extended:
- `User` interface gains `digest_subscribed: boolean` and `last_digest_sent_at: string | null`.
- `rowToUser` defaults `digest_subscribed` to `true` when the DB row omits the field (defensive for pre-migration preview environments).
- `verifyCode` (new-user creation path) sets `digest_subscribed: true` explicitly — documents the intent and protects against a future default change.
- Three new service functions: `setDigestSubscription(userId, subscribed)`, `markDigestSent(userId, timestamp)`, `listSubscribedUsers()`.

#### Event store helper

`civic-hub/src/events/eventStore.ts` adds `getEventsSince(sinceIso)` — returns events with `created_at > since`, ascending. Used by the cron to pull one big batch, then filter per-user in memory (avoids N+1 DB fan-out).

#### Three new HTTP surfaces — `civic-hub/src/controllers/digestController.ts`

All three live in one controller; routes split across `digestRoutes.ts` for auth-gate clarity.

- **`POST /internal/digest/run`** — Vercel Cron target. Requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron auto-injects this). Respects `DIGEST_ENABLED=false` (returns `{ skipped: true }`). Pulls all users with `digest_subscribed=true`, computes the earliest `since` cursor across the batch, calls `getEventsSince` once, then for each user: filters events to their window (`since = last_digest_sent_at ?? created_at`, capped to 30 days ago), calls `assembleDigestForUser`, sends via `utils/email.sendEmail` (Resend), and only advances `last_digest_sent_at` on a successful send. Empty digests are skipped silently. Individual-user failures (Resend 4xx/5xx, malformed data, etc.) are caught, logged, counted, and do NOT abort the batch — the next run retries them. Response shape: `{ processed_users, sent_count, skipped_count, failed_count, duration_ms }`.
- **`GET /unsubscribe/digest?token=…`** — No auth. Verifies HMAC token → calls `setDigestSubscription(user_id, false)` → returns a themed HTML confirmation page. Invalid tokens → 400 with a "link is invalid, sign in to manage" page. 500 handler covers DB failures cleanly. All responses are `text/html` so email-client "click to unsubscribe" links land on a human page.
- **`PATCH /user/settings/digest`** — `requireAuth` session bearer. Body `{ subscribed: boolean }`. Returns `{ digest_subscribed }`.

Routes mounted in `src/app.ts`:
- `app.use("/internal", digestCronRouter)`
- `app.use("/unsubscribe", digestUnsubscribeRouter)`
- `app.use("/user/settings", userSettingsRouter)`

All three documented in the root `/` handler.

#### Email formatting

Subject: `{HUB_NAME} — {Weekday, Mon D} update (N new item[s])`. From: existing `RESEND_FROM`. HTML body is a single-column inline-styled layout (560px max-width) with four group headings ("New votes open", "New results published", "New Civic Briefs", "Announcements") — sections render only when non-empty. Each item: title linking to `event.action_url`, 1–2 line summary derived from event data, "Read more →" CTA. Footer: "Unsubscribe" + "Manage subscriptions" + the postal address from `HUB_POSTAL_ADDRESS`. Plain-text alternative included.

### Frontend

- **`ui/src/pages/Settings.tsx` + `.css`** — new page at `/settings`. Single "Daily email digest" panel with a checkbox-toggle. On mount: calls `/auth/me` to fetch the current subscription state (authoritative). On change: `PATCH /user/settings/digest`. Unauthenticated users see a "sign in to manage your settings" message. Styling pulls entirely from `styles/theme.css` tokens — no hardcoded colors or sizes.
- **`ui/src/components/Nav.tsx`** — adds a `Settings` nav link visible only to signed-in users. Placed between Admin and the email/logout block.
- **`ui/src/App.tsx`** — new `<Route path="/settings">`.
- **`ui/src/services/auth.ts`** — `AuthUser` gains `digest_subscribed: boolean`.
- **`ui/src/services/api.ts`** — new `setDigestSubscription(subscribed)` wrapper.

No `/unsubscribed` SPA page — the backend returns a self-contained HTML confirmation, which is simpler and avoids a client-side round-trip on a link that users hit from an email client (possibly without cookies).

### Vercel configuration

`civic-hub/vercel.json` adds:
```json
"crons": [{ "path": "/api/internal/digest/run", "schedule": "0 13 * * *" }]
```

13:00 UTC = 09:00 EDT = 08:00 EST (Floyd County, Virginia).

### Required setup before the cron works in production

1. **Apply migration 005** to Supabase (SQL Editor → paste `supabase/migrations/20260423000000_digest_subscription.sql` → run). Adds the two columns on `users`.
2. **Set Vercel env vars** (Production + Preview):
   - `CRON_SECRET` — `openssl rand -hex 32`. Vercel Cron auto-injects this into request headers.
   - `DIGEST_UNSUBSCRIBE_SECRET` — `openssl rand -hex 32`. MUST persist across deploys (rotating invalidates every outstanding unsubscribe link).
   - `DIGEST_ENABLED=true` (or leave unset — defaults to true).
   - `HUB_NAME=Floyd Civic Hub` (optional, defaults to this).
   - `HUB_POSTAL_ADDRESS=Floyd, VA` (CAN-SPAM-style footer compliance).
3. Verify `RESEND_API_KEY` and `RESEND_FROM` are already set (they're used by the OTP flow from earlier slices). The digest reuses these.

### Env vars introduced in this slice

Documented in `.env.example`:
- `CRON_SECRET` — gate for the cron endpoint. If unset, every request returns 401.
- `DIGEST_ENABLED` — `"true"` (default) or `"false"`. Runtime kill-switch.
- `DIGEST_UNSUBSCRIBE_SECRET` — HMAC-SHA256 signing secret for unsubscribe tokens. Minimum 16 chars.
- `HUB_NAME` — hub name shown in email subject, header, and unsubscribe confirmation page. Defaults to `"Floyd Civic Hub"`.
- `HUB_POSTAL_ADDRESS` — city+state acceptable for pilot; shown in email footer.

Existing `RESEND_API_KEY`, `RESEND_FROM` reused unchanged.

### Preview verification

- Backend (`npm run build` in `civic-hub/`): clean, no TypeScript errors.
- UI (`npm run build` in `civic-hub/ui/`): clean; bundles at 316.75 kB / 92.92 kB gzipped.
- `POST /internal/digest/run` with no/wrong `Authorization`: returns 401 `{ "error": "Invalid or missing cron credential" }` (verified).
- `GET /unsubscribe/digest` with no token OR malformed token: returns the themed HTML error page (verified — 500 in local preview because `DIGEST_UNSUBSCRIBE_SECRET` isn't set in the local `.env`; 400 in production once the secret is configured).
- `PATCH /user/settings/digest` without bearer: returns 401 `{ "error": "Authentication required" }` (verified).
- `/settings` page renders for the signed-in admin: "Settings" heading, "Daily email digest" panel, "Subscribed — daily digest on" toggle. Nav shows the new Settings link.
- `/admin/settings` page unchanged — both Brief delivery and Announcement authors panels still render and function as before (no regression).

Full end-to-end cron → email delivery was NOT smoke-tested in preview because (a) migration 005 hasn't been applied to the local Supabase and (b) `DIGEST_UNSUBSCRIBE_SECRET` / `CRON_SECRET` aren't set locally. The route gates and HTTP plumbing are verified; the DB-write path requires the migration and the Resend path requires a valid API key in the environment. Both are production-deploy concerns.

### Architectural decisions — recorded here so they outlive this slice

**Digest filter must stay in sync with the Feed filter.** `civic.digest/filter.ts` duplicates the rules currently inlined in `ui/src/components/Feed.tsx` + `ui/src/components/FeedPost.tsx`. Neither side imports the other (frontend/backend boundary). Documented at the top of `filter.ts` and flagged here. Extracting both to a shared module is a future cleanup; for Slice 5 scope the rule is: **if the Feed grows a new visible post type, the digest must too, or residents will see things on the feed that never show up in their email** (and vice versa).

**New-vote signal is `civic.process.started`, not `civic.process.created`.** The Slice 5 prompt said to include `created` as the "new-vote-open signal" for `civic.vote`, but the Feed uses `started` (the existing `created` events for votes are silently filtered out of the Feed — noted in Slice 4's HANDOFF). To keep the two filters aligned, the digest follows the Feed's convention: `started` is the "vote is now accepting ballots" signal for residents. If strict spec-prompt matching is needed later, this is a one-line change in `filter.ts`.

**No civic events emitted for digest sends.** The user-facing spec of the hub is civic activity, not infrastructure. Delivery auditability comes from `console.log` lines of the form `[digest] user=<id> events=<N> sent=<true|false> [error=<...>]`, which Vercel surfaces under the function's run logs.

**One big event query per cron run.** The cron computes the earliest `since` across the whole subscribed batch, issues a single `getEventsSince` call, and filters per-user in memory. This keeps the DB fan-out O(1) regardless of user count. The in-memory scan is O(users × events_in_window) — fine up to a few thousand users.

### Scale limits — flagged for future attention

- **Vercel function timeout.** Hobby = 10 s (likely not enough for even modest user counts once a real batch is running); Pro = 60 s; Enterprise = 300 s. For the MVP pilot (~50–500 users) Pro is the right floor. Beyond ~5 000 users the single-function approach breaks regardless of plan and needs batching / a queue — future slice.
- **Resend rate limits.** Not addressed. Current implementation serializes per-user sends; if Resend throttles, per-user failures count toward the summary and get retried next run (because `last_digest_sent_at` doesn't advance on failure). This is acceptable for MVP.
- **Single cron on Hobby.** Vercel Hobby supports daily crons. Pro supports more frequent. If we ever add a second cron, we may need the Pro plan.

### Non-goals honored

- No per-event-type subscription preferences (no "digest for votes only" toggle).
- No per-user digest time preference.
- No weekly / other frequencies.
- No batching, queueing, or rate limiting logic.
- No push / SMS / in-app notifications.
- No open/click analytics.
- No reuse of `services/mailer.ts` (that's reserved for transactional brief delivery) — Resend via `utils/email.ts` is the bulk channel.
- Not registered in the process registry — civic.digest is a service module, not a process type.
- No admin UI for globally toggling digests — `DIGEST_ENABLED` env var is the MVP control.

### Files touched / added

**Added (backend):**
- `civic-hub/supabase/migrations/20260423000000_digest_subscription.sql`
- `civic-hub/src/modules/civic.digest/{models,filter,service,unsubscribe,index}.ts`
- `civic-hub/src/controllers/digestController.ts`
- `civic-hub/src/routes/digestRoutes.ts`

**Modified (backend):**
- `civic-hub/src/modules/civic.auth/models.ts` — two new User fields
- `civic-hub/src/modules/civic.auth/index.ts` — rowToUser defaults, digest_subscribed on create, three new service functions
- `civic-hub/src/events/eventStore.ts` — `getEventsSince(sinceIso)`
- `civic-hub/src/app.ts` — mount routes, document in root handler
- `civic-hub/vercel.json` — `crons` entry
- `civic-hub/.env.example` — 5 new vars documented

**Added (frontend):**
- `civic-hub/ui/src/pages/Settings.{tsx,css}`

**Modified (frontend):**
- `civic-hub/ui/src/App.tsx` — `/settings` route
- `civic-hub/ui/src/components/Nav.tsx` — Settings link
- `civic-hub/ui/src/services/auth.ts` — `AuthUser.digest_subscribed`
- `civic-hub/ui/src/services/api.ts` — `setDigestSubscription` wrapper

---

## Slice 4.2 — Settings tab (admin IA cleanup) — 2026-04-23

**Status:** Pure UI reorganization. No backend changes. Admin panel now has three tabs: **Proposals · Civic Briefs · Settings**. The two settings panels ("Brief delivery" and "Announcement authors") moved out of the Civic Briefs tab, where they were category errors, into a dedicated Settings tab.

### Why

Slice 4.1 parked the Announcement authors panel under Civic Briefs because that's where the hub-settings plumbing already lived (from the Slice 3 addendum). Author management has nothing to do with brief review, though — the user flagged the mismatch. A dedicated Settings tab is the correct IA and accommodates future config (theme, jurisdiction, email templates, etc.) without more tab proliferation.

"Brief delivery" also moved to Settings even though it's brief-related. The distinction: brief *review* is a recurring workflow; brief *delivery recipients* is configuration set once and mostly forgotten. Putting configuration next to configuration (instead of mixed with an operational workflow) is the clearer model.

### Changes

- `ui/src/pages/AdminSettings.tsx` + `.css` — new page, owns both settings panels and their state/handlers. Renders under `AdminTabs` at `/admin/settings`. Heading: "Settings". Subtitle: "Hub-wide configuration. Changes take effect immediately — no redeploy required."
- `ui/src/components/AdminTabs.tsx` — added third tab.
- `ui/src/pages/AdminBriefs.tsx` — removed all settings state (`recipientsText`, `authors`, etc.), their `useEffect` loader, and handlers (`saveRecipients`, `saveAuthors`, `updateAuthor`, `addAuthor`, `removeAuthor`). Removed both `<section className="admin-settings-panel">` blocks from the list view JSX. Dropped unused imports (`adminGetSettings`, `adminPatchSettings`, `AnnouncementAuthor`). The page is purely the brief review queue again, as originally designed.
- `ui/src/pages/AdminBriefs.css` — removed `.admin-settings-panel`, `.admin-settings-actions`, `.admin-settings-message`, `.announcement-author-row` styles (relocated to AdminSettings.css). Other admin-briefs-specific styles stay.
- `ui/src/pages/AdminSettings.css` — new file; owns the relocated panel/row styles plus a small page wrapper.
- `ui/src/App.tsx` — new `/admin/settings` route mounting `<AdminSettings />`.

### Panel renames

- "Delivery settings" → **"Brief delivery"** (more specific; "delivery" alone would collide with future "Announcement delivery" if that ever becomes a thing).

### Preview verification

- `/admin/settings` renders with both panels; previously-saved recipient + author values load correctly on tab switch.
- `/admin/briefs` renders cleanly without settings panels; 4 filter buttons (All/Pending/Approved/Published) remain; brief review unchanged.
- All three tabs highlight correctly; browser back between them works.
- Save round-trip (recipients + authors) verified via `/admin/settings` PATCH.
- Both UI and backend build clean; no TS errors.

### Backend

Untouched. `/admin/settings` endpoint, `hub_settings` table, auth middleware, announcement controller — all identical to Slice 4.1.

### Files touched

- `civic-hub/ui/src/pages/AdminSettings.{tsx,css}` (new)
- `civic-hub/ui/src/components/AdminTabs.tsx` (add tab)
- `civic-hub/ui/src/pages/AdminBriefs.{tsx,css}` (remove settings)
- `civic-hub/ui/src/App.tsx` (add route)

---

## Slice 4.1 — Admin-editable announcement authors with flexible labels — 2026-04-23

**Status:** The list of non-admin users authorized to post announcements is now admin-editable from the UI, with per-entry free-form role labels. Replaces the Slice 4 hardcoded-to-"board" model with a flexible "whatever you want to call them" model, while preserving backward compatibility.

### Why

Slice 4 shipped announcements with a two-role model: `"admin"` or `"board"`. Changing who could post required editing the `CIVIC_BOARD_EMAILS` Vercel env var + redeploying. The user asked for two things:
1. Admin-editable list (no redeploy round-trip) — parity with brief recipient settings from Slice 3 addendum.
2. Flexibility: support roles beyond Board — e.g. "Planning Committee", "Guest speaker" — because announcements may come from more than just the Board of Supervisors.

### Model

Announcement `author_role` is now a **free-form string** display label, not a fixed union. Permission-wise, there are still two internal tiers:

- **`admin`** — always posts as "Admin", always editable by any admin, always has admin-panel access.
- **`author`** — non-admin user in the admin-managed author list. Posts with the admin-configured label. Can only edit their own announcements.

This keeps the permission model simple (binary: admin or not) while letting the display label be anything.

### Precedence + fallback chain

`resolveAuthorship(email)` in `middleware/auth.ts` walks:
1. Is email in `CIVIC_ADMIN_EMAILS`? → `{ role: "admin", label: "Admin" }`.
2. Is email in the `hub_settings.announcement_authors` DB row? → `{ role: "author", label: <configured label> }`.
3. Is email in `CIVIC_BOARD_EMAILS` env var? → `{ role: "author", label: "Board member" }` (env-var fallback, preserves Slice 4 behavior).
4. Otherwise → `null`.

The env-var fallback means deploys that haven't yet visited the admin settings panel keep working without manual DB seeding.

### Backend changes

- **`src/services/hubSettings.ts`** — new `ANNOUNCEMENT_AUTHORS` key; `AnnouncementAuthor {email, label}` type; `getAnnouncementAuthors()`, `setAnnouncementAuthors()`, `lookupAuthorLabel()` helpers. `normalizeAuthors()` trims, dedups by lowercase email, rejects half-filled rows. JSON-serialized value in the key-value table.
- **`src/middleware/auth.ts`** — removed synchronous `roleForEmail()` union. Added `isAdminEmail()` (sync) and `resolveAuthorship()` (async, DB-backed). `requireBoardOrAdmin` is now `requireAnnouncementPoster` — still resolves through email-list + DB, stamps `res.locals.effectiveRole` + `res.locals.authorLabel`. The old name `requireBoardOrAdmin` is re-exported as an alias so no external caller breaks.
- **`src/controllers/authController.ts`** — `/auth/me` + `/auth/verify` responses now include `{role, author_label}`. UI uses both.
- **`src/controllers/announcementController.ts`** — on create, stamps the resolved `authorLabel` onto `state.author_role`. Update handler passes `effectiveRole` (admin | author) to the module's `canEdit`.
- **`src/controllers/adminSettingsController.ts`** — `/admin/settings` now includes `announcement_authors: AnnouncementAuthor[]` on GET and accepts it on PATCH. Rejects malformed bodies with 400.
- **`src/modules/civic.announcement/models.ts`** — `AnnouncementAuthorRole` changed from `"board" | "admin"` union to `string`. Comment clarifies that older announcements may carry the literal `"board"`.
- **`src/modules/civic.announcement/lifecycle.ts`** — `canEdit` now takes an `AnnouncementEditorRole = "admin" | "author"` (permission, not display).
- **`src/modules/civic.announcement/service.ts`** — `updateAnnouncement`'s editor-role param matches the new enum.

### Frontend changes

- **`ui/src/services/auth.ts`** — `AuthRole` is now `"admin" | "author" | null`. `verifyCode` and `getMe` return `author_label` alongside role.
- **`ui/src/context/AuthContext.tsx`** — exposes `authorLabel` in the context value; `login()` accepts it; `logout()` clears it. `canPostAnnouncements` now checks `role === "admin" || role === "author"`.
- **`ui/src/components/AuthModal.tsx`** — passes `result.author_label` through `login()`.
- **`ui/src/services/api.ts`** — `AnnouncementAuthor` type. `AdminSettings` extended with `announcement_authors: AnnouncementAuthor[]`. `AnnouncementAuthorRole` relaxed to `string`.
- **`ui/src/pages/AdminBriefs.tsx`** + `.css` — new "Announcement authors" panel below the Delivery settings panel. Repeatable rows (email + label input + remove button); "+ Add author" button at the bottom; Save button. Empty-state message when no non-admin authors configured. Half-filled rows reject with an inline error before save.
- **`ui/src/pages/Announcement.tsx`** — eyebrow is now `"${label} announcement"` (or just "Announcement" for admin-posted). Legacy `"board"` → `"Board member"` normalization for Slice 4 announcements.
- **`ui/src/components/FeedPost.tsx`** — same label-driven format: admins render as "Announcement: …", everyone else as "{label} announcement: …". Legacy `"board"` same normalization.

### Preview verification

- Backend build clean, UI build clean.
- `GET /admin/settings` returns `{brief_recipient_emails, announcement_authors}`.
- `PATCH /admin/settings` with two authors (different labels) persists and round-trips correctly.
- `/auth/me` for the admin returns `{role: "admin", author_label: "Admin"}`.
- Admin panel shows both "Delivery settings" and "Announcement authors" panels, author rows render the previously-saved values.
- Slice 4 announcements with `author_role: "board"` still render correctly on the public page and feed (backward compat).

### Backward compatibility

- Old announcements with `author_role: "board"` continue to display as "Board member" via a normalization step in the UI.
- `requireBoardOrAdmin` export alias preserves any external code that imported it.
- `CIVIC_BOARD_EMAILS` env var continues to work as a fallback when no DB row exists.
- Admin email handling unchanged (`CIVIC_ADMIN_EMAILS`).

### Files touched

**Backend:**
- `src/services/hubSettings.ts` — new types + helpers
- `src/middleware/auth.ts` — new `resolveAuthorship`, `requireAnnouncementPoster`
- `src/controllers/authController.ts` — /auth/me + /auth/verify return author_label
- `src/controllers/announcementController.ts` — stamp label from middleware
- `src/controllers/adminSettingsController.ts` — handle announcement_authors PATCH field
- `src/modules/civic.announcement/models.ts` — author_role: string
- `src/modules/civic.announcement/lifecycle.ts` — AnnouncementEditorRole enum
- `src/modules/civic.announcement/service.ts` — new editor role enum in update
- `.env.example` — CIVIC_BOARD_EMAILS doc updated to reflect fallback role

**Frontend:**
- `ui/src/services/auth.ts` — AuthRole + author_label on responses
- `ui/src/context/AuthContext.tsx` — authorLabel in context
- `ui/src/components/AuthModal.tsx` — pass author_label through login
- `ui/src/services/api.ts` — AnnouncementAuthor type + AdminSettings extension
- `ui/src/pages/AdminBriefs.tsx` + `.css` — Announcement authors panel
- `ui/src/pages/Announcement.tsx` — label-driven eyebrow
- `ui/src/components/FeedPost.tsx` — label-driven post title

---

## Slice 4 — Board announcements (civic.announcement) — 2026-04-22

**Status:** New one-way communication channel from Board of Supervisors members (and admins) to residents. Announcements are a new `civic.announcement` process type with instant-publish semantics and transparent edits. A narrow Board-member role is introduced, distinct from admin.

### Decisions captured before coding

- **Branched from `main`** (not stacked on `slice-3-5-comments`). Slice 4 doesn't depend on Slice 3.5; they merge cleanly in either order.
- **Plain text body** (not Markdown). Body is stored verbatim and rendered with preserved line breaks. A structured `links: {label, url}[]` array (up to 5) handles the "clickable link" need without introducing Markdown. Easy to swap to Markdown in a future slice if needed.
- **Role exposure via `/auth/me` + `/auth/verify`**. Backend now returns `role: "admin" | "board" | null` derived from env-var email lists. UI reads role from AuthContext. This replaces the hardcoded `const ADMIN_EMAIL = "creatinglake@gmail.com"` check in `Nav.tsx` — no more hardcoded emails anywhere.
- **Narrow Board capability.** Board members can post / edit announcements only. They do NOT get `/admin/*` access. `requireBoardOrAdmin` is a new middleware distinct from `requireAdmin`; existing admin routes are unchanged.

### Spec compliance note (important)

Announcements emit only `civic.process.created` and `civic.process.result_published` (on create) and `civic.process.updated` (on edit). Civic Process Spec §5 Phases 1–5 (Framing, Activation, Participation, Aggregation, Outcome/Decision) are intentionally **skipped** — there is no participation window, no aggregation, no outcome distinct from the posting itself. Emitting placeholder events for phases that don't correspond to meaningful civic activity would be misleading.

This is a documented deviation pending a potential spec extension to recognize informational process kinds distinct from participation-driven and derivative kinds. Logged in `civic-hub/IDEAS.md` under Protocol / Federation for federation-readiness tracking.

### Backend: new module + adapter

`civic-hub/src/modules/civic.announcement/` — portable, pluggable. 5 files: models, lifecycle, events, service, index. State carries `content {title, body, links[]}`, `author_id`, `author_role: "board" | "admin"`, `created_at`, `last_edited_at`, `edit_count`. Length caps (title 200, body 5000, up to 5 links) enforced in the module's `sanitizeContent`. Authorization to edit (`canEdit`) lives in the module so any future non-HTTP caller enforces the same rules.

`civic-hub/src/processes/announcementProcess.ts` — thin adapter. Rejects `handleAction` (announcements don't use the generic action dispatcher; the `/announcement/*` HTTP surface orchestrates create/edit directly via the module).

Registered in `civic-hub/src/processes/registry.ts` alongside vote/proposal/brief. Hub boots cleanly if omitted.

### Backend: auth + routes + controller

- `src/middleware/auth.ts` — new `boardEmails()` helper, exported `roleForEmail(email)` that returns `"admin" | "board" | null` (admin wins if email appears in both), and new `requireBoardOrAdmin` middleware that allows users in either env list and sets `res.locals.effectiveRole`. Existing `requireAdmin` is unchanged — Board members cannot reach `/admin/*` routes.
- `src/controllers/authController.ts` — `/auth/verify` and `/auth/me` responses now include `role: AuthRole`. The UI uses it to gate nav links and edit buttons without hardcoded emails.
- `src/controllers/announcementController.ts` — `handleCreateAnnouncement`, `handleUpdateAnnouncement`, `handleGetAnnouncement`, `handleListAnnouncements`. Create fires `result_published` via the module's emitter after the generic factory has emitted `created`. Update enforces authorship (author or admin only) via `updateAnnouncement` in the module, returns 403 on unauthorized. Auto-finalizes the process status since announcements never participate.
- `src/routes/announcementRoutes.ts` — `POST /announcement` (requireBoardOrAdmin), `PATCH /announcement/:id` (requireBoardOrAdmin, author/admin check inside), `GET /announcement/:id` (public). `GET /announcements` is mounted separately in `app.ts` so it doesn't collide with `/announcement/:id`.
- `src/app.ts` — mounts the new routes, documents all four endpoints in the root handler.
- `.env.example` — new `CIVIC_BOARD_EMAILS` var documented.

### Frontend

- `ui/src/services/auth.ts` — new `AuthRole` type; `verifyCode` and `getMe` return types include `role`.
- `ui/src/context/AuthContext.tsx` — exposes `role`, `isAdmin`, `canPostAnnouncements` in the context value. `login()` accepts optional role. `AuthModal` passes role from the verify response through.
- `ui/src/components/Nav.tsx` — "Post Announcement" link shown when `canPostAnnouncements`. "Admin" link shown when `isAdmin`. **Removed the hardcoded `ADMIN_EMAIL` constant** — all role checks now go through AuthContext.
- `ui/src/services/api.ts` — `Announcement`, `AnnouncementSummary`, `AnnouncementLink`, `CreateAnnouncementInput`, `UpdateAnnouncementInput` types; four wrappers.
- `ui/src/pages/PostAnnouncement.tsx` + `.css` — single page handles both create (`/announcement/new`) and edit (`/announcement/:id/edit`) via URL param. 200-char title, 5000-char body, repeatable link rows (add / remove, up to 5). Client-side gates: residents see a "not available" message; non-author Board members trying to edit someone else's announcement see "not your announcement". Backend enforces the same rules independently.
- `ui/src/pages/Announcement.tsx` + `.css` — public page at `/announcement/:id`. ANNOUNCEMENT eyebrow, title, meta line with "Posted by {role} on {date}", "Last edited {date}" when edit_count > 0, Edit link visible only to author or admin. Body uses `white-space: pre-wrap` to preserve line breaks. Links rendered in a styled panel at the bottom.
- `ui/src/components/Feed.tsx` — metadata loader extended: announcement events fetch from `GET /announcement/:id` (body serves as the feed summary). Kind discrimination uses `data.announcement` presence on `result_published` events.
- `ui/src/components/FeedPost.tsx` — `eventToPost` `result_published` branch now handles three process kinds. Announcements render as **"Board announcement: {title}"** (role=board) or **"Announcement: {title}"** (role=admin). `classifyHref` treats `/announcement/:id` as an internal SPA route.
- `ui/src/App.tsx` — three new routes: `/announcement/new`, `/announcement/:id/edit`, `/announcement/:id`.

### End-to-end verified

Against the local Vercel-connected hub:
- **Auth role** — `/auth/me` for `creatinglake@gmail.com` returns `role: "admin"`.
- **Create** — `POST /announcement` with title + body + one link succeeds, emits `civic.process.created` (generic, `/process/:id` action_url) + `civic.process.result_published` (module, `/announcement/:id` action_url). Returns 201 with the full announcement.
- **Public read** — `GET /announcement/:id` returns full content, 404 for unknown IDs. No auth required.
- **Edit** — `PATCH /announcement/:id` with body-only change bumps `edit_count` to 1, sets `last_edited_at`, returns `edited_fields: ["body"]`. Emits `civic.process.updated`. No-op edits (no actual field change) don't emit events.
- **List** — `GET /announcements` returns newest-first summary rows with `edit_count` and `last_edited_at`.
- **Feed** — UI feed renders the post as "Announcement: {title}" (admin-authored). The generic `created` event is silently filtered out by the existing Slice 1 `started`-only filter — confirmed no duplicate posts.
- **Public page** — renders cleanly with ANNOUNCEMENT eyebrow, meta line with Posted/Last edited dates, body paragraph, Links panel. Edit link visible to the author/admin.
- **Nav** — admin user sees Feed / Votes / About + Post Announcement + Admin + user/logout. Clean role-driven gating replaces the previous hardcoded email.

### Environment variables introduced

- `CIVIC_BOARD_EMAILS` — comma-separated list. Case-insensitive. Admin wins if both lists contain the same email. When unset, only admins can post announcements.

Documented in `.env.example`. Needs to be set on Vercel (Production + Preview) before Board members can post in production.

### Deferred / flagged

- **Board-user preview verification** skipped. Only admin was tested end-to-end because `CIVIC_BOARD_EMAILS` isn't set in the local `.env`. Board role path is identical to admin in code; adding an email to the env var and authing as that user exercises it. Flagged for production verification after Vercel env vars are set.
- **Markdown body rendering** — deferred. Plain text with preserved line breaks + structured links array covers most needs for MVP. Swap-in is a ~15-minute `react-markdown` change if needed.
- **Informational process_kind spec extension** — announcements highlight a third class of civic process (informational, instant-publish) distinct from participation-driven (vote) and derivative (brief). Worth raising in the spec working group. Logged in IDEAS.md.
- **User-record role field** — currently roles come from env-var email lists. Migration to per-user role records in the DB is a future concern; logged in IDEAS.md under Governance.

### Files touched / added

**Added (backend):**
- `civic-hub/src/modules/civic.announcement/{models,lifecycle,events,service,index}.ts`
- `civic-hub/src/processes/announcementProcess.ts`
- `civic-hub/src/controllers/announcementController.ts`
- `civic-hub/src/routes/announcementRoutes.ts`

**Modified (backend):**
- `civic-hub/src/middleware/auth.ts` — `boardEmails`, `roleForEmail`, `requireBoardOrAdmin`
- `civic-hub/src/controllers/authController.ts` — role in /auth/verify and /auth/me
- `civic-hub/src/processes/registry.ts` — register civic.announcement
- `civic-hub/src/app.ts` — mount routes, document endpoints
- `civic-hub/.env.example` — CIVIC_BOARD_EMAILS

**Added (frontend):**
- `civic-hub/ui/src/pages/PostAnnouncement.{tsx,css}`
- `civic-hub/ui/src/pages/Announcement.{tsx,css}`

**Modified (frontend):**
- `civic-hub/ui/src/services/{auth,api}.ts`
- `civic-hub/ui/src/context/AuthContext.tsx`
- `civic-hub/ui/src/components/{Nav,Feed,FeedPost,AuthModal}.tsx`
- `civic-hub/ui/src/App.tsx`

---

## Slice 3.5 — Community comments via civic.input — 2026-04-22

**Status:** Community comments are now submitted via the vote flow and auto-populate the brief's `content.comments`. Also closes a pre-existing spec compliance gap: `civic.input.submitInput` now emits `civic.process.comment_added` events per Civic Event Spec §4.2 and Civic Process Spec §7.5.

### Spec compliance fix

**Gap closed:** `civic.input.submitInput` used to write to `community_inputs` without emitting any event. Participation actions MUST emit events per Civic Process Spec §7.5. Now emits `civic.process.comment_added` on every successful input submission, data shape:

```json
{
  "event_type": "civic.process.comment_added",
  "data": {
    "comment": {
      "id": "input_<hex>",
      "body_preview": "<first 200 chars, trimmed>"
    }
  }
}
```

Body preview truncated to 200 chars so events stay cheap to index/distribute; consumers that want the full body read `/process/:id/input`.

### Architectural decision

`civic.input` follows the same portability pattern as `civic.vote` — the host hub injects its `emit` function via `InputContext`; the module never imports the hub's event system. Preserves the module's guardrail ("MUST NOT import from civic.vote or any lifecycle/results code").

### Changes

**Backend:**
- `src/modules/civic.input/models.ts` — new `EmitEventFn`, `InputContext`, `BODY_PREVIEW_LEN` exports.
- `src/modules/civic.input/index.ts` — `submitInput` signature now requires `ctx: InputContext` with hub_id, jurisdiction, and emit callback. Emits `civic.process.comment_added` post-insert.
- Three callers updated to pass `emitEvent`:
  - `src/controllers/inputController.ts` — HTTP path (`POST /process/:id/input`)
  - `src/controllers/debugController.ts` — dev seed endpoint
  - `src/debug/autoSeed.ts` — startup auto-seed middleware
- `src/modules/civic.brief/models.ts` — `CreateBriefFromVoteInput` accepts optional `comments: string[]`.
- `src/modules/civic.brief/service.ts` — `generateBriefContent` seeds `content.comments` from the passed list via the existing `sanitizeList` (trim + dedup).
- `src/processes/voteProcess.ts` — `spawnBriefFromClosedVote` reads `civic.input.getInputsByProcess(voteId)` and passes the comment bodies to the factory. Read failures are best-effort (warn, proceed with empty list — admin can still add manually).
- `src/processes/briefProcess.ts` — `initializeState` passthroughs `comments` from the state input.

**Frontend:**
- `ui/src/components/VotePanel.tsx` — optional comment textarea above the vote buttons (500-char limit, counter, placeholder guiding the resident). On submit:
  1. Vote first. If vote fails, stop.
  2. If vote succeeded and comment non-empty, submit via `POST /process/:id/input`.
  3. Comment submission failure after vote shows a non-fatal warning; vote stays recorded.
  4. Full-success state shows "Your vote and comment have been submitted."
- `ui/src/components/CommunityInputPanel.tsx` — refactored to read-only display. Submission form removed; the panel now just shows "Community comments" (heading renamed) with the list of past inputs. Actor prop no longer needed.
- `ui/src/pages/Process.tsx` — CommunityInputPanel now renders for any civic.vote (panel returns null when empty), not gated on the per-process `community_input` content config.
- `ui/src/App.css` — `.vote-comment-field` / `.vote-comment-textarea` / `.vote-comment-counter` / `.vote-comment-warning` styles. Tokens-only, no hardcoded values.

### Test coverage

`scripts/testBriefFlow.ts` extended with three new assertions (steps 5b, 5c, 7b):
- Submitting a comment via `POST /process/:id/input` returns 201 with the stored body.
- Exactly one `civic.process.comment_added` event fires, `data.comment.id` matches the returned input id, `body_preview` is ≤200 chars.
- On vote close, the spawned brief's `content.comments` includes the submitted comment (seeded from civic.input before admin PATCH).

All 22 assertions pass end-to-end. Admin PATCH of comments still replaces the seeded list with admin edits (existing behavior).

### Preview verification

- Backend + UI builds clean, no TS errors.
- On a live active vote (Floyd Flock Camera), VotePanel renders the optional comment textarea with a 0/500 counter above the vote buttons, below the privacy notice. No console errors.
- Placeholder text: "Share concerns, suggestions, context, or any thoughts worth passing on to the Board. Submitted when you cast your vote."

### Non-goals honored

- `civic.vote` module untouched — comments go through the parallel `civic.input` module.
- No `kind` / `category` / `type` field added to `CommunityInput`. Generic comments only.
- No separate event types for concerns/suggestions — `civic.process.comment_added` is the single canonical event.
- No AI clustering, summarization, or moderation beyond what exists.

### Files touched

- `civic-hub/src/modules/civic.input/{models,index}.ts` (modified)
- `civic-hub/src/modules/civic.brief/{models,service}.ts` (modified)
- `civic-hub/src/processes/{voteProcess,briefProcess}.ts` (modified)
- `civic-hub/src/controllers/{inputController,debugController}.ts` (modified)
- `civic-hub/src/debug/autoSeed.ts` (modified)
- `civic-hub/ui/src/components/{VotePanel,CommunityInputPanel}.tsx` (modified)
- `civic-hub/ui/src/pages/Process.tsx` (modified)
- `civic-hub/ui/src/App.css` (modified)
- `civic-hub/scripts/testBriefFlow.ts` (extended)

---

## Slice 3 addendum — admin-configurable brief recipients — 2026-04-22

**Status:** Admin UI in the Civic Briefs tab now exposes a "Delivery settings" panel for editing the brief recipient email list without a redeploy.

### Why

The Slice 3 approval flow read recipients from `BOARD_RECIPIENT_EMAIL` env var. Changing the recipient required a deploy, which is fine for infra but wrong for operational admins who need to re-route briefs as personnel / responsibilities shift. User asked for this directly.

### Changes

- **Migration 004** (`supabase/migrations/20260422000000_hub_settings.sql`) — new `hub_settings` table (key TEXT PK, value TEXT, updated_at, updated_by). RLS on, no permissive policies. Trigger keeps updated_at current on every write.
- **`src/services/hubSettings.ts`** — generic key-value helpers + a `getBriefRecipients()` / `setBriefRecipients()` pair that dedupes + trims. `getBriefRecipients()` reads the DB value first and falls back to `BOARD_RECIPIENT_EMAIL` env var so existing deploys keep working before an admin has opened the settings panel.
- **`src/controllers/adminSettingsController.ts`** — `GET /admin/settings` + `PATCH /admin/settings`. Shape is `{ brief_recipient_emails: string[] }`; extendable by adding more keys in the response type.
- **`src/controllers/adminBriefController.ts`** — approval flow now calls `getBriefRecipients()` instead of reading env directly.
- **`src/services/mailer.ts`** — removed unused `parseRecipients` helper; dedup/normalization now lives in hubSettings.
- **`ui/src/services/api.ts`** — `AdminSettings` type + `adminGetSettings` / `adminPatchSettings` wrappers.
- **`ui/src/pages/AdminBriefs.tsx` + `.css`** — "Delivery settings" card at the top of the list view. Textarea (comma- or newline-separated), save button, inline save-result message.

### Required setup before deploy

1. **Apply migration 004** to Supabase (SQL Editor → paste `supabase/migrations/20260422000000_hub_settings.sql` → run). Creates the `hub_settings` table.
2. **Vercel env vars** (for Resend SMTP delivery — otherwise falls back to console logging which is invisible from the Vercel UI):
   - `SMTP_HOST=smtp.resend.com`
   - `SMTP_PORT=465`
   - `SMTP_USER=resend`
   - `SMTP_PASS=<your Resend API key>` (starts with `re_`)
   - `SMTP_FROM=Floyd Civic Hub <adam@civic.social>` — must use a domain verified in Resend
   - `BOARD_RECIPIENT_EMAIL=creatinglake@gmail.com` — still honored as a fallback; can be left blank once the admin has saved recipients in the UI
3. Open `/admin/briefs` after deploy; enter `creatinglake@gmail.com` in the Delivery settings panel; hit Save. The next approval delivers there.

### Compatibility note

Existing `BOARD_RECIPIENT_EMAIL` env var is still honored as a fallback when no DB setting exists. Deploys without the migration applied will return 500 from the settings endpoint but approval still works via the env var — a hub that never opens the settings panel behaves exactly like before. The UI will surface the migration-not-applied error clearly on the settings panel.

---

## Slice 3 — Civic Brief generation + admin approval flow — 2026-04-22

**Status:** Full-stack implementation of the Civic Brief lifecycle on branch `slice-3-briefs`. When a vote closes, a brief is generated automatically and enters an admin review queue. Admin approval delivers the brief to the Board of Supervisors via email, publishes it to the public feed, and finalizes the underlying vote. All events spec-compliant per Civic Event Spec v0.1 and Civic Process Spec v0.1.

Slice 2 was not a separate slice — this slice follows directly from Slice 1.

### Decisions captured before coding

Cross-checked each prompt assumption against actual code state; five questions went to the user:

- **Q1 concerns/suggestions** → leave brief content's community section empty at generation; admin writes it in during review. Future slice 3.5 will pre-populate from `civic.input`. _User also later consolidated `concerns` + `suggestions` into a single `comments: string[]` field for simplicity._
- **Q2 finalization gating** → remove `process.finalize` from the HTTP adapter entirely. Brief module imports `finalizeVote` as a library function. No HTTP path publishes vote results without brief approval.
- **Q3 admin nav** → shared `/admin` layout with tabs; keep sub-routes (`/admin/proposals`, `/admin/briefs`) for shareable URLs.
- **Q4 briefs on /votes** → add "Completed Votes" section to `/votes` with brief-status chip per card: "Civic Brief pending review" (pending) or "View Civic Brief →" (published, links to `/brief/:id`). Briefs are not top-level entries on `/votes`.
- **Q5 action_url fix** → central fix via new `CIVIC_UI_BASE_URL` env var in `eventEmitter`, not just briefs. Votes, briefs, and future process types all emit UI-facing action URLs from this slice forward. No short-term workarounds; forward-compat for federation.

### Backend: new module

`civic-hub/src/modules/civic.brief/` — portable, pluggable. Hubs can register or skip `civic.brief` without affecting other code paths.

- `models.ts` — `BriefProcessState`, `BriefContent` (with `comments: string[]`), publication-status sub-states, injected callback types (`EmitEventFn`, `SendEmailFn`, `FinalizeLinkedVoteFn`).
- `lifecycle.ts` — `canEdit`, `canApprove`, `assertPublicationTransition`.
- `events.ts` — `emitBriefCreated`, `emitBriefAggregationCompleted`, `emitBriefUpdated`, `emitBriefOutcomeRecorded`, `emitBriefResultPublished`. All emit `action_url_path: /brief/:id` so feed posts link to the public brief page.
- `email.ts` — pure HTML + text formatting for the board-delivery email.
- `service.ts` — `createBriefState`, `editBrief`, `approveBrief` (the orchestration function). Approval runs: approve → email → deliver-to → outcome_recorded → publish → result_published → finalize linked vote → vote result_published.
- `index.ts` — public surface.

### Backend: adapter + factory hook

- `civic-hub/src/processes/briefProcess.ts` — thin `ProcessHandler` adapter. Initializes state from a `CreateBriefFromVoteInput`; read/summary models map to the module's admin read models. Throws on any `handleAction` call (briefs don't have generic HTTP actions; admin uses `/admin/briefs/*`).
- Registered in `civic-hub/src/processes/registry.ts` alongside `civic.vote` and `civic.proposal`.
- `civic-hub/src/processes/voteProcess.ts` — on `process.close`, if `civic.brief` is registered, the adapter spawns a brief via the factory, emits the brief's `aggregation_completed`, and links the vote back to the brief via `follow_up_process_ids` (Civic Process Spec §11.3). If `civic.brief` is unregistered, close proceeds without spawning — hubs opt in cleanly.

### Backend: vote module lifecycle changes

- `civic.vote/events.ts` — new `emitAggregationCompleted` emitter with canonical Phase-4 data shape (`aggregation_method`, `participant_count`, `result_type`, `result_summary`).
- `civic.vote/index.ts` — `closeVote` now emits both `ended` and `aggregation_completed` on close. `finalizeVote` is unchanged in behavior but is no longer reachable via HTTP; its comment explicitly documents it as library-only, brief-gated.
- `voteProcess.ts` — the `process.finalize` action is deleted from the adapter's switch with an explanatory comment. This closes the gap where any caller could publish a vote result without brief approval.
- Process descriptor updated: dropped `process.finalize` from `actions`; added `civic.process.aggregation_completed` to `events`.

### Backend: event emitter — central action_url fix

- `utils/baseUrl.ts` — new `uiBaseUrl()` helper. Reads `CIVIC_UI_BASE_URL`, falls back to `BASE_URL`, strips trailing slash.
- `models/event.ts` — `CreateEventInput` adds optional `action_url_path` override for processes whose UI path isn't `/process/:id` (briefs use `/brief/:id`).
- `events/eventEmitter.ts` — constructs `action_url` from `uiBaseUrl() + path`. `source.hub_url` continues to be `BASE_URL` (API origin, what federation partners hit), matching the spec's separation of concerns.
- Resolves the Slice 1 "action_url points to API origin, not UI origin" follow-up.

### Backend: routes + controllers

- `routes/adminRoutes.ts` — adds `GET /admin/briefs`, `GET /admin/briefs/:id`, `PATCH /admin/briefs/:id`, `POST /admin/briefs/:id/approve`. All under `requireAdmin`.
- `controllers/adminBriefController.ts` — list/get/patch handlers plus the full approval orchestration. The `finalizeLinkedVote` closure loads the vote, calls the vote module's `finalizeVote` as a library function (no HTTP round trip), and persists the vote. Idempotent on already-finalized votes. Halts cleanly on email delivery failure — brief stays `approved`, no further events fire, admin gets an actionable error.
- `routes/briefRoutes.ts` + `controllers/briefController.ts` — public `GET /brief/:id`. Only `published` briefs return; pending/approved 404. Invisible to the public until admin approves.
- `controllers/processController.ts` — `handleListProcesses` now filters out brief processes whose `publication_status !== "published"`. Prevents pending brief metadata from leaking via the public `GET /process` list.
- `services/processService.ts` — new `saveProcessState(process)` for flows that mutate a process outside the action dispatcher (the brief approval flow persists both the brief and the linked vote through this). CORS middleware now allows `PATCH`.
- `services/mailer.ts` — nodemailer transport with console-log fallback when any of `SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM` is unset. Parses comma-separated `BOARD_RECIPIENT_EMAIL` into a recipient list.

### Frontend

- `services/api.ts` — `BriefSummary`, `BriefDetail`, `PublicBrief`, `BriefContentPatch` types. Four admin wrappers + `getPublicBrief`. `ProcessSummary` union extended with `PublishedBriefSummary` for published briefs that show up in the public list.
- `components/AdminTabs.tsx` + `AdminTabs.css` — shared tab nav at the top of both admin surfaces. Uses `NavLink` so `aria-current="page"` flips automatically.
- `pages/AdminBriefs.tsx` + `AdminBriefs.css` — list with status filters (All / Pending / Approved / Published) and an inline review view. Review lets admin edit the `comments` list (line-separated textarea) and `admin_notes`; "Save draft" PATCHes, "Approve and publish" runs the backend orchestration with a confirmation step. Status chip shows where each brief is in the publication lifecycle.
- `pages/AdminProposals.tsx` — now renders under the shared `AdminTabs` layout so both admin surfaces are one click apart.
- `pages/Brief.tsx` + `Brief.css` — public brief page at `/brief/:id`. Clean readable render: eyebrow ("Civic Brief"), title, meta line with publish date + participant count + link back to the vote, positions rendered as CSS bars (participation % widths), comments list, admin notes. All tokens-referenced styles.
- `pages/Votes.tsx` — split into three sections: **Active Votes** (status === `active` only — completed votes no longer pollute this section), **Proposed Votes** (unchanged), and new **Completed Votes**. Completed cards include a brief-status row: "View Civic Brief →" linking to `/brief/:id` if the matching brief is published, otherwise a "Civic Brief pending review" chip. Brief lookup is one-pass via a `Map<voteId, brief>` built from the public process list.
- `components/Feed.tsx` — metadata fetch loop now branches by event: vote-type events pull from `GET /process/:id/state`, brief-type events pull from `GET /brief/:id`. Discriminator is the event itself (`data.brief_id` presence or `event_type === civic.process.started`).
- `components/FeedPost.tsx` — `eventToPost` branches `civic.process.result_published` by process type: `civic.vote` renders **"Vote results published: [title]"**, `civic.brief` renders **"Civic Brief delivered: [title]"** with the backend's `headline_result` as summary. `classifyHref` extended to treat `/brief/:id` as an internal SPA route.
- `App.tsx` — new routes `/admin/briefs` and `/brief/:id`.

### Environment variables introduced

- `CIVIC_UI_BASE_URL` — UI origin for `action_url` construction. Optional; defaults to `BASE_URL`. Set for split-origin dev only.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — SMTP transport. All five or nothing; unset falls back to console-log email.
- `BOARD_RECIPIENT_EMAIL` — where civic briefs are delivered on approval. Comma-separated is parsed. Required for approval to succeed; unset → 503.

All six documented in `.env.example`.

### Spec compliance

- **Civic Event Spec v0.1** — every new event conforms to base schema (`id`, `version`, `event_type`, `timestamp`, `process_id`, `actor`, `jurisdiction`, `action_url`, `source`, `data`, `meta`). Brief events: `created`, `aggregation_completed`, `updated`, `outcome_recorded`, `result_published` — all canonical types per §4 and §7.4.
- **Civic Process Spec v0.1** — brief spans Phases 0 (Initiation) → 4 (Aggregation, synchronous at creation) → 5 (Outcome/Decision, on admin approval) → 6 (Publication). Linked via `follow_up_process_ids` per §11.3. Outcome type = `advisory` per §10.2.
- **Aggregation** — vote aggregation method recorded as `tallying`, brief's as `summarization` (§9.2).

### Decisions made / deviations flagged

- **Atomicity of approval sequence.** If `sendEmail` throws, brief stays `approved` and the subsequent events don't fire. If the vote finalization fails after `result_published` has already emitted for the brief, the brief is persisted but the vote is not — the events are in the log. This matches the existing `executeAction` race-condition gap and is an accepted pilot-phase limitation. Admin gets an actionable error.
- **Single email recipient list** — `BOARD_RECIPIENT_EMAIL` accepts comma-separated multi-recipient (supported by the parser) even though the prompt specified single.
- **Public `GET /process` list filtering.** Added a server-side filter so pending/approved briefs don't leak via the list endpoint. Only published briefs appear publicly. Admin uses `/admin/briefs` (full visibility).
- **`process.finalize` removal** — confirmed no other code paths depend on the HTTP action; grep showed only the adapter's own case statement and tests referred to it. The library function `finalizeVote` is still exported and used by the brief approval flow.
- **Atomicity note copied to this paragraph for visibility.** The hub's architecture persists events durably via `emitEvent` mid-sequence; if a later sequence step fails, the events are already in the log. This is consistent with the "events are the primary public interface" design principle but may surprise observers during the pilot. Future slice may introduce a transactional event queue if needed.

### Verified in preview

- Feed renders (`/`) — existing "New vote" post still surfaces; no brief `created` events accidentally posted.
- `/votes` — all three sections (Active / Proposed / Completed) render. Completed is empty (no vote closed in current seed data) — expected.
- `/admin/briefs` — renders the page shell, shared admin tabs visible, backend correctly returns "Authentication required" for unauth'd access.
- `/brief/some-id` — 404 page renders cleanly for unknown IDs.
- Backend `/health` — ok after reload.
- Backend build (`npm run build`) + UI build — both clean, no TS errors.

End-to-end smoke test (create vote → vote → close vote → admin approves → feed updates → brief page renders) wasn't fully exercised in this session because:
- Vote close via HTTP requires a valid user session token from the email-OTP flow.
- Admin approval requires `CIVIC_ADMIN_EMAILS` to include a session user AND `BOARD_RECIPIENT_EMAIL` set (even in console-fallback mode).

The integration is type-checked and unit-coherent; remaining verification is best run on the Vercel preview URL with proper env vars configured, then re-tested against the staging Supabase (GitHub issue #2) once that lands.

### Files touched / added

**Added (backend):**
- `civic-hub/src/modules/civic.brief/{models,lifecycle,events,service,email,index}.ts`
- `civic-hub/src/processes/briefProcess.ts`
- `civic-hub/src/controllers/{adminBriefController,briefController}.ts`
- `civic-hub/src/routes/briefRoutes.ts`
- `civic-hub/src/services/mailer.ts`

**Modified (backend):**
- `civic-hub/src/modules/civic.vote/{events,index}.ts`
- `civic-hub/src/processes/{voteProcess,registry}.ts`
- `civic-hub/src/services/processService.ts`
- `civic-hub/src/controllers/processController.ts`
- `civic-hub/src/events/eventEmitter.ts`
- `civic-hub/src/models/event.ts`
- `civic-hub/src/utils/baseUrl.ts`
- `civic-hub/src/routes/adminRoutes.ts`
- `civic-hub/src/app.ts`
- `civic-hub/package.json` (nodemailer dependency)
- `civic-hub/.env.example` (new env vars)

**Added (frontend):**
- `civic-hub/ui/src/components/AdminTabs.{tsx,css}`
- `civic-hub/ui/src/pages/AdminBriefs.{tsx,css}`
- `civic-hub/ui/src/pages/Brief.{tsx,css}`

**Modified (frontend):**
- `civic-hub/ui/src/services/api.ts`
- `civic-hub/ui/src/pages/{Votes,AdminProposals}.tsx`
- `civic-hub/ui/src/components/{Feed,FeedPost}.tsx`
- `civic-hub/ui/src/App.{tsx,css}`

**Doc updates:**
- `civic-hub/IDEAS.md` — graduated the `action_url` backend fix (done this slice); added Slice 3.5 item to pre-aggregate `civic.input` into `BriefContent.comments`.

### Open questions / follow-ups

- **Slice 3.5 (pre-populate comments):** At brief generation time, read the list of community-input bodies tied to the source vote and seed `content.comments` with sanitized entries so admin review starts warm. Today the array is empty until the admin types.
- **`result_published` title on vote events** — briefs already carry title in their `result_published` data; votes still carry only `result.tally`. Federated consumers of vote results need a callback to render. Smaller backend change once someone picks it up.
- **End-to-end manual verification** — as noted, full vote-close → brief-approve → feed update hasn't been exercised live; best done on the Vercel preview once env vars are configured.
- **Admin UX polish** — the comments editor is a simple textarea (one line per comment). A future pass could make this a reorderable list with per-entry delete buttons. Low priority.
- **AdminProposals got a tab bar but its existing "back" flow was tied to a `<Link to="/">` — preserved semantically; flow still works.**

---

## Slice 1 — Feed rendering + navigation — 2026-04-21

**Status:** Floyd Civic Hub MVP Slice 1 landed. Front-end only; no backend changes. `/` is now a civic feed; the former home (vote-process list + civic proposals + "+ Propose an Issue" button) moved verbatim to `/votes`; `/about` left untouched.

Scope clarification: `/votes` renders *only* `civic.vote` processes (in any lifecycle state) and `civic.proposal` / civic-proposal submissions — i.e. everything in the voting pipeline. Other process types (future: `civic.announcement`, `civic.petition`, etc.) will get their own surfaces and must not be added to `/votes`. The filters in `pages/Votes.tsx` are type-explicit, not a catch-all, so new process plugins won't leak into `/votes` by accident.

### Scope confirmation

Before coding, reconciled the prompt against the actual repo state and got explicit user sign-off:
- Move the entire existing Home content (Active Votes, Proposed Votes, legacy proposals, civic proposals + "+ Propose an Issue") verbatim to `/votes`.
- Keep existing `/about` content as-is — it's already substantive, not a stub.
- Nav is Feed / Votes / About only. Drop `Propose` from the nav; users still reach the Propose form from the Votes page. Keep the Admin link and user/logout cluster on the right side.
- Theme: introduce a new `styles/theme.css` with the Slice-1 spec'd tokens and consume them only from new components. Pre-existing CSS continues to use the legacy variables in `index.css`. Consolidation deferred.
- CLAUDE.md "Known Gap: Event Schema Alignment" section rewritten to reflect that the schema is aligned.

### What was built

**New files (all in `civic-hub/ui/src/`):**
- `styles/theme.css` — semantic design tokens on `:root` (colors, typography, spacing scale, radii, elevation). Imported from `main.tsx` before `index.css`.
- `components/Nav.tsx` + `Nav.css` — top sticky horizontal nav. Uses `NavLink` so the active link gets `aria-current="page"` and an `.is-active` class for styling. Primary links (Feed / Votes / About) on the left; Admin + user/logout cluster on the right.
- `components/Feed.tsx` + `Feed.css` — feed container. Fetches `GET /events`, applies the Slice-1 event-type filter, paginates client-side (50 initial, +50 per "Load more"), and renders posts inside `<section aria-label="Civic activity feed">`. Accepts an optional `filter` prop for future filter/search UI so adding it later won't require a rewrite.
- `components/FeedPost.tsx` — renders one post deterministically from a view-model. Exports `eventToPost(event, getDescription, getTitle)` which is where the event-type → post mapping lives (open for extension).
- `pages/Votes.tsx` — the previous Home content, moved here unchanged.

**Edited files:**
- `pages/Home.tsx` — rewritten to render `<HubHeader />` + `<Feed />`. The old process-list Home logic now lives in `pages/Votes.tsx`.
- `App.tsx` — imports the new `Nav`, wraps `<Routes>` in `<main>`, drops the inline `NavBar`, adds `/votes → <Votes />`. `/process/:id`, `/proposal/:id`, `/propose`, `/about`, `/admin/proposals`, `/votes/:id/log` routes unchanged.
- `main.tsx` — imports `styles/theme.css` before `index.css` so tokens are defined before any component styles run.
- `services/api.ts` — new `CivicEvent` type (mirrors `civic-hub/src/models/event.ts`) and `getEvents()` wrapper. No other API changes.

### Filter rules (Slice 1)

Only these event types render as posts; all others are filtered out.

| Event type | Post title | Summary |
|---|---|---|
| `civic.process.started` | `"New vote: [title]"` | First line of process description |
| `civic.process.result_published` | `"Results available: [title]"` | `"{n} participants — results now public."` |

Rationale for `started` over `created`: `civic.process.created` fires as soon as a process row exists, which includes votes in "proposed" / "gathering support" states that haven't yet crossed the endorsement threshold. Surfacing those in the public feed would announce unofficial proposals as if they were real votes. `civic.process.started` fires only when the process enters active participation — the correct signal for "this is now an official vote, citizens should see it." Proposals remain visible on `/votes` (gathering-support section) during the support-collection phase; the feed picks them up only when they become active.

`civic.process.ended` is also intentionally *not* rendered — per Process Spec §5 and Event Spec §4.1, `ended` means aggregation has begun; `result_published` means results have been approved for public release. Admin approval gates `result_published` (Slice 3). Surfacing `ended` would leak unreviewed results.

**Future process types:** today civic.vote is the only module that emits `started`, so every `started` event renders as a "New vote: …" post. When additional process types (e.g. `civic.petition`, `civic.announcement`) start emitting `started`, the switch in `eventToPost()` needs a per-process-type branch to pick the correct post title/format. That's a one-case addition, not a restructure.

### Pagination

`GET /events` does not currently support `limit`/`offset`. Slice 1 fetches the full event list once and paginates client-side (50 per page). Server-side pagination is a worthwhile backend follow-up once the event store grows.

### Per-post process metadata fetches

`civic.process.created` events carry `data.process.{type, title}`, but no description. `civic.process.result_published` events carry only tally/total_votes, no title or description. To render titles and summaries, `Feed` fetches `GET /process/:id/state` lazily for each visible event and caches the result in a React state map keyed by `process_id`. A `useRef`-backed in-flight set dedupes fetches across `useEffect` re-runs (including StrictMode's dev-only double-invocation).

This is a pragmatic Slice-1 choice. For federation-readiness, a future backend slice should emit the process title (and ideally a first-line summary) on `civic.process.result_published` so external hubs consuming Floyd's events never need to call back into Floyd. Until then, federated events from other hubs will render with a fallback title (`"Process {id}"`) rather than the real title.

### `action_url` dev/prod mismatch — flagged

The hub's emitter populates `action_url` with the *hub's own base URL* (e.g. `http://localhost:3000/process/:id` in dev, `https://floyd.civic.social/process/:id` in prod). Per Civic Event Spec §3, `action_url` is meant to be a "link to take action" — i.e. a user-facing URL. In the current setup the UI runs on a different origin than the API (`localhost:5173` vs `:3000` in dev), so clicking the literal `action_url` would hit the JSON API, not the UI route.

Slice 1 works around this client-side: `classifyHref()` in `FeedPost.tsx` checks the `action_url`'s path — if it matches `/process/:id`, we navigate via React Router regardless of origin. Federation-origin URLs (unmatched paths, foreign origins) render as external anchors opening in a new tab. This is forward-compatible with federated events.

**Recommended backend fix (future slice):** populate `action_url` with the UI origin / UI path, not the API origin. Ideally the hub has a separate `UI_BASE_URL` env var used for event emission. Low priority but worth doing before the feed is federated.

### Spec-compliance check

Cross-referenced the implementation against `/specs/`:
- Feed reads from `GET /events` only — events remain the primary public interface.
- Post filtering is keyed on `event_type` strings from the canonical set (Event Spec §4.1). New process plugins emitting new event types can be surfaced by extending the switch in `eventToPost()` — no structural change.
- `action_url` used as the post link target — forward-compat for federation (events from other hubs carry their own origins).
- Semantic HTML: `<nav aria-label="Primary">`, `<main>`, `<article>` per post, `<time datetime="…">` for timestamps with absolute-time `title` attributes for hover.

### Theme architecture

`theme.css` defines semantic tokens on `:root`: colors (bg, surface, surface-muted, text, text-muted, text-subtle, border, border-hover, primary, primary-text, primary-hover, focus), typography (font-body, font-heading, size-sm/base/lg/xl, line-height-tight/base), spacing scale (xs/sm/md/lg/xl), radii (sm/md), and elevation (shadow-card). Slice-1 components consume these tokens exclusively — no hardcoded hex codes, font names, or magic pixel values.

The legacy variables in `index.css` (`--primary-color`, `--text-color`, etc.) remain in place for pre-existing components. A future "theme consolidation" slice should migrate legacy component CSS to the new token names so that a single theme override re-skins the whole app.

### CLAUDE.md update

- Renamed the "Known Gap: Event Schema Alignment" section to "Event Schema: Aligned with Civic Event Spec v0.1" and rewrote the body to describe the aligned state, with a historical note for archaeology.
- Removed the "Event schema full alignment with Civic Event Spec (before Phase 2)" bullet from the "Deferred to Later Phases" list.
- Note: CLAUDE.md's own permission model denies Claude writing to CLAUDE.md by default. The Slice 1 prompt explicitly instructed this change, which the user confirmed. The permission model was not modified.

### Verified in preview

Ran both the UI (`npm run dev`, port 5173) and the hub backend (`npm run dev`, port 3000). Against the current event store (2 `civic.process.created`, 1 `civic.process.proposed`, 1 `civic.process.started`, 2 `civic.process.updated`, 1 `civic.process.vote_submitted`):

- Feed renders exactly 2 posts: `"New vote: Floyd County Flock Camera Use"` and `"New vote: Add More Secure Dumpster (Green Box) Sites"`. The 5 other events are silently filtered out (correct).
- Both posts show their real descriptions as summaries, pulled from `/process/:id/state` and cached.
- Nav shows Feed / Votes / About. Active link gets the blue underline and `aria-current="page"`. Visited `/`, `/votes`, `/about` in sequence; active state followed correctly each time.
- `/votes` renders the previous Home UI identically — Active Votes, Proposed Votes with the "+ Propose an Issue" button, etc.
- `/about` renders the existing `About.tsx` content (un-edited).
- `npm run build` succeeds with no TypeScript errors.

### Open questions / follow-ups

- **Load-more button** not reached during smoke-test (only 2 renderable posts; threshold is 50). Exercising it requires more seeded events.
- **Timestamp refresh:** relative timestamps (`"5 days ago"`) are computed at render time; they don't tick. For a long-lived session they'd go stale. Acceptable for Slice 1.
- **Process-state refetch on mount:** each page-load of `/` fires `GET /process/:id/state` for every visible post. If the feed is popular, consider (a) having `result_published` carry the title in `data`, and (b) a lightweight `GET /process?ids=a,b,c` batch endpoint.
- **Legacy nav CSS:** the old `.app-nav`, `.nav-links`, `.nav-link`, `.nav-link-admin`, `.nav-logout`, `.nav-user`, `.nav-user-email`, `.nav-right` classes in `App.css` are no longer referenced. Dead CSS; not removed this slice.
- **`action_url` backend fix** (see above).
- **Theme consolidation** (see above).
- **Separate Supabase project for preview / staging deploys** — tracked as [civic-hub#2](https://github.com/creatinglake/civic-hub/issues/2). Do this before the next slice that touches writes; otherwise preview URLs write to production data.

### Files touched

- `civic-hub/ui/src/styles/theme.css` (new)
- `civic-hub/ui/src/components/Nav.tsx` (new)
- `civic-hub/ui/src/components/Nav.css` (new)
- `civic-hub/ui/src/components/Feed.tsx` (new)
- `civic-hub/ui/src/components/Feed.css` (new)
- `civic-hub/ui/src/components/FeedPost.tsx` (new)
- `civic-hub/ui/src/pages/Votes.tsx` (new)
- `civic-hub/ui/src/pages/Home.tsx` (rewritten)
- `civic-hub/ui/src/App.tsx` (rewritten nav + routes)
- `civic-hub/ui/src/main.tsx` (adds theme.css import)
- `civic-hub/ui/src/services/api.ts` (adds CivicEvent + getEvents)
- `CLAUDE.md` (event-schema note rewritten; deferred-work bullet removed)
- `HANDOFF.md` (this entry)
- `.claude/launch.json` (added `hub` backend config for preview verification)

---

## Licensing, Repo Hygiene & Calculate America Recovery — 2026-04-20

**Status:** Reference implementations licensed under BUSL-1.1. `civic-dashboard` renamed to `citizen-dashboard` (GitHub + local). Policy-sensitive repos flipped to private. The previously-orphaned Income Inequality Explorer source now safely in the (private) `Calculate_America` repo.

### Pilot spec ToCs made clickable

Followup to docs-repo creation. Converted plain-text ToCs in the two long pilot specs to GitHub-anchored markdown links.

- `civic-social-docs/pilots/civic-hubs/spec.md` — all 33 numbered sections + "How to Read This Document" entry now click-jump.
- `civic-social-docs/pilots/civic-identity/spec.md` — all 46 numbered sections + "How to Read This Document" + "References" now click-jump.
- Discovered numbering mismatch in Hubs spec (body section 20 "AI-Assisted Moderation (Optional)" was missing from ToC). Added the missing ToC entry and renumbered items 21–33 to align with body. ToC and body section numbers now match cleanly.

### BUSL-1.1 licensing for product code

Surfaced concern: CC-BY 4.0 on docs has zero effect on product code (per-work licensing, no copyleft contagion). Audit revealed `civic-hub`, `civic-dashboard`, and `mosaic-social-site` had **no LICENSE file at all** — public visibility but no rights granted, an ambiguous legal state.

Decision: license reference implementations under **Business Source License 1.1 (BUSL-1.1)** with the Mosaic Foundation as Licensor. Rationale: keeps source visible (open ecosystem narrative), reserves commercial deployment rights (revenue funds the commons, not shareholders), guarantees auto-conversion to Apache 2.0 after 4 years per release.

**License parameters used:**

| Parameter | Value |
|---|---|
| Licensor | `Mosaic Foundation` |
| Additional Use Grant | `None. All Production Use requires a separate license granted by the Licensor at its sole discretion.` |
| Change Date | `2030-04-19` (rolling — each future release ships with its own Change Date 4 years out) |
| Change License | `Apache License, Version 2.0` |

The Additional Use Grant is intentionally tight — no nonprofit/government carve-outs. All commercial use is case-by-case to prevent loophole abuse.

**Repos licensed:**

- `civic-hub`: `LICENSE` + `LICENSING.md` committed and pushed
- `citizen-dashboard`: `LICENSE` + `LICENSING.md` committed and pushed

`LICENSING.md` is a plain-English explainer that contrasts BUSL (reference implementations) with CC-BY 4.0 (ecosystem specs). It also clarifies that anyone is free to build their own implementation of the specs under any license they choose — the spec license does not constrain implementations.

Note: GitHub's license detector marks BUSL as "Other / NOASSERTION" (BUSL isn't OSI-approved). Legal effect is identical regardless. Not actionable.

### Repo rename: civic-dashboard → citizen-dashboard

- Renamed on GitHub via `gh repo rename`. GitHub auto-redirects the old URL for external bookmarks.
- Local clone's `origin` URL updated to the new GitHub URL.
- Local folder renamed: `/Users/adamlake/Developer/civic-dashboard` → `/Users/adamlake/Developer/citizen-dashboard`.

### Citizen Dashboard moved into Civic-Social-Mono on disk

Per the established nested-repo pattern (alongside `civic-hub/` and `civic-social-docs/`), moved `citizen-dashboard/` from `/Users/adamlake/Developer/` into `/Users/adamlake/Developer/Civic-Social-Mono/`. Remains an independent git repo with its own GitHub remote. Parent's `.gitignore` updated.

### Visibility decisions (confirmed and verified)

| Repo | Visibility | Notes |
|---|---|---|
| `Civic-Social-Mono` (parent) | local only, no GitHub remote | Intentionally not pushed. Time Machine handles backup. |
| `civic-hub` | PUBLIC | BUSL covers commercial restriction; visibility supports ecosystem trust. Vercel deployment (`civic-hub-two.vercel.app`) unaffected. |
| `citizen-dashboard` | PUBLIC | GitHub Pages free tier requires public; custom domain `citizendashboard.civic.social` would break under private without GitHub Pro or migrating off Pages. BUSL covers commercial restriction. |
| `Calculate_America` | PRIVATE | Policy-sensitive content (income inequality framing). |
| `FairShare` | PRIVATE | Older version of the inequality app, no longer maintained. Pages site at `creatinglake.github.io/FairShare/` stops serving as a side effect — accepted. |

### Licensing philosophy logged

- **Specs and ecosystem documentation** = CC-BY 4.0 (open, attribution-only).
- **Reference implementations** (Civic Hub, Citizen Dashboard, future engines) = BUSL-1.1 (source-available, commercial use case-by-case, auto-converts to Apache 2.0 after 4 years per release).
- **Other implementations of the specs by third parties** = their choice, completely unconstrained. The CC-BY spec license does not bind implementations.

---

## Documentation Repo Created — 2026-04-19

**Status:** New private GitHub repo `creatinglake/civic-social-docs` created and populated with 17 canonical documents. Lives at `civic-social-docs/` inside `Civic-Social-Mono/` as a nested git repo (parent ignores it via `.gitignore`).

**URL:** https://github.com/creatinglake/civic-social-docs (private)

### What was done

**Repo structure**

```
civic-social-docs/
├── README.md              ← project overview, status legend, license note
├── LICENSE                ← CC-BY 4.0 (fetched from creativecommons.org)
├── CONTRIBUTING.md        ← how to contribute via GitHub or email
├── AUTHORS.md             ← founding author + contributor placeholder
├── canon/                 ← foundational reference (3 docs)
├── ecosystem/             ← substrate-level specs (8 docs)
└── pilots/
    ├── civic-identity/    ← Civic Identity Pilot v0.5 + 2 briefs
    └── civic-hubs/        ← Civic Hubs Pilot v0.6 + 2 briefs
```

**Frontmatter convention**

Every imported doc has YAML frontmatter:
```yaml
---
status: <draft|review|stable>
last-reviewed: 2026-04-19
owners: [adam]
version: 0.1
---
```

### What's incomplete

- **GitHub repo description** is empty. Suggested: `gh repo edit creatinglake/civic-social-docs --description "Canonical documentation for Civic.Social — open, federated infrastructure for civic participation"`.
- **Editorial pass** needed before flipping any review/draft docs to stable, especially the funder-partner briefs and the AI-related ecosystem docs.
- **Repo is PRIVATE.** Will flip to public after review: `gh repo edit creatinglake/civic-social-docs --visibility public`.

---

## Production Readiness — 2026-04-16

**Status:** Civic Hub is **live in production** at `https://civic-hub-two.vercel.app`, backed by persistent Postgres on Supabase, with real email delivery via Resend and enforced backend auth.

### What was done

**Persistent data (10 tables, Supabase Postgres)**

Every in-memory `Map` / array replaced with a Postgres table. Data now survives Vercel cold starts (previously every cold start wiped state, which broke sessions, active votes, and the event log).

| Old (in-memory) | New (Postgres) |
|---|---|
| `civic.auth` maps | `users`, `sessions`, `pending_verifications` |
| `processService.processes` | `processes` (state in JSONB) |
| `eventStore.events` | `events` (append-only via trigger) |
| `civic.proposals` maps | `proposals`, `proposal_supports` |
| `civic.receipts` maps | `vote_records`, `vote_participation` (no join key — privacy guarantee) |
| `civic.input.inputsByProcess` | `community_inputs` |

Schema migrations in `civic-hub/supabase/migrations/`:
- `20260416000000_initial_schema.sql` — all tables, indexes, RLS, triggers
- `20260416000100_align_events_schema.sql` — align events columns with CivicEvent model, relax append-only trigger to block UPDATE only
- `20260416000200_processes_columns.sql` — add `hub_id` and `process_version` to processes

RLS is enabled and forced on every table with no permissive policies. Backend uses the Supabase `service_role` secret key (bypasses RLS). Anon/publishable key cannot read or write anything.

**Backend auth enforcement (`civic-hub/src/middleware/auth.ts`)**

- `requireAuth` / `requireResident` / `requireAdmin` middleware
- Actor is taken from the validated Bearer token, never from the request body — closes the pre-existing "anyone could POST `{actor:'anyone'}` to vote as them" hole
- Admin routes gated by `CIVIC_ADMIN_EMAILS` env var (comma-separated allowlist)
- CORS gated by `CIVIC_ALLOWED_ORIGINS`; production refuses to start if unset
- `/debug/seed` gated by `CIVIC_ALLOW_SEED` — unset in production, so live data can't be wiped even if the endpoint is hit
- Session TTL: 30 days, with opportunistic cleanup on invalid-token lookups

**Real email delivery (Resend)**

- `src/utils/email.ts` — tiny wrapper around Resend's HTTP API (no SDK dep)
- OTP codes emailed from `Floyd Civic Hub <noreply@floyd.civic.social>` (DKIM + SPF verified)
- Hardcoded `"000000"` demo bypass replaced with `CIVIC_DEMO_BYPASS_CODE` env var — unset in production, set in dev/preview
- Fallback: if `RESEND_API_KEY` is unset, code is logged to console (dev only)

**Deployment**

- Vercel auto-build on push to `main`
- Three environments configured (Production, Preview, Development) with per-environment env vars
- `vercel.json` updated to install devDependencies so `tsc` + `vite` work in the build step
- Node pinned to `20.x` in `package.json` engines field
- Event `action_url` and discovery manifest use a `baseUrl()` helper that strips trailing slashes (fixes the `https://host//path` double-slash issue)

### Env vars in Vercel (11 total)

| Key | Production | Preview | Development |
|---|---|---|---|
| `SUPABASE_URL` | yes | yes | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | yes | yes |
| `CIVIC_ADMIN_EMAILS` | yes | yes | yes |
| `RESEND_API_KEY` | yes | yes | yes |
| `RESEND_FROM` | `Floyd Civic Hub <noreply@floyd.civic.social>` | same | same |
| `BASE_URL` | prod URL | same | `http://localhost:3000` |
| `NODE_ENV` | `production` | `preview` | `development` |
| `CIVIC_ALLOWED_ORIGINS` | prod URL | unset | unset |
| `CIVIC_ALLOW_SEED` | **UNSET** | `true` | `true` |
| `CIVIC_DEMO_BYPASS_CODE` | **UNSET** | `000000` | `000000` |

### How to run locally

```bash
cd civic-hub
cp .env.example .env        # then fill in real values
npm run dev                  # http://localhost:3000
```

See `civic-hub/.env.example` for all env vars, and `civic-hub/supabase/README.md` for DB migration conventions.

### Verified in production (end-to-end)

- `/api/health` reports `db.ok: true`
- Seed data present: 2 processes, 6 events, all with correct prod action_urls
- Unauthenticated `POST /api/process/:id/action` → 401
- Unauthenticated `GET /api/admin/proposals` → 401
- `GET /api/debug/seed` → 403 (production is sealed)
- OTP email delivered from `noreply@floyd.civic.social` to real inbox
- Actor-spoofing via request body is ignored; emitted event's `actor` is the session's user_id

### Known follow-ups (not blocking for pilot)

- **Schema alignment with Civic Event Spec v0.1** — event model still uses `event_type/data/meta/source` shape vs. spec's flat top-level fields. Pre-existing known divergence, documented in CLAUDE.md.
- **Custom domain** — currently on `civic-hub-two.vercel.app`; pointing `floyd.civic.social` (or similar) DNS → Vercel is a 10-min task when ready. Update `BASE_URL` and `CIVIC_ALLOWED_ORIGINS` in Vercel at the same time.
- **Rate limiting** on `/auth/request-code` (and others) — anyone can spam the endpoint to trigger emails right now. Resend's free tier (3,000/month) is a natural cap, but abuse handling should come before broad user rollout.
- **Pagination** on `/events`, `/process`, `/proposals` — unchanged, returns all rows. Fine at current scale.
- **Concurrency on `executeAction`** — read-mutate-write against `processes.state` is not transactional. Under low concurrency it's fine. Hardening path: optimistic locking via `updated_at` compare-and-swap, or a Postgres RPC that does the whole dance server-side.
- **Database backups** — Supabase free tier is daily backups, 7-day retention. Upgrade to Pro ($25/mo) when user data warrants it.
- **Free-tier inactivity pause** — Supabase free projects pause after 1 week of inactivity. Mitigate with a Vercel Cron or GitHub Action hitting `/api/health` weekly.

---

## Component Status Snapshot

### Backend: API Layer (`civic-hub/src/routes/`, `civic-hub/src/controllers/`)

**Built:**
- All five spec-required endpoints implemented: `GET /.well-known/civic.json`, `POST /process`, `GET /process/:id`, `POST /process/:id/action`, `GET /events`
- Additional UI-facing endpoints: `GET /process` (list all), `GET /process/:id/state` (read model with tally)
- Community input endpoints: `POST /process/:id/input`, `GET /process/:id/input`
- **Proposal endpoints (2026-04-03):**
  - `POST /proposals` — submit a new civic proposal
  - `GET /proposals` — list proposals (optional `?status=` filter)
  - `GET /proposals/:id` — get proposal detail (optional `?actor=` for support check)
  - `POST /proposals/:id/support` — endorse a proposal
- **Admin endpoints (2026-04-03):**
  - `GET /admin/proposals` — list proposals for admin review (endorsed first, then submitted)
  - `GET /admin/proposals/:id` — get full proposal detail for admin
  - `POST /admin/proposals/:id/convert` — convert endorsed proposal to civic.vote process
  - `POST /admin/proposals/:id/archive` — archive (reject/shelve) a proposal
- **Auth endpoints (2026-04-03):**
  - `POST /auth/request-code` — request email verification code (OTP logged to console in dev)
  - `POST /auth/verify` — verify code, create/login user, return session token
  - `POST /auth/residency` — affirm Floyd County residency (requires Bearer token)
  - `GET /auth/me` — get current authenticated user (requires Bearer token)
  - `POST /auth/logout` — destroy session
- **Vote log endpoints (2026-04-04):**
  - `GET /votes/:id/log` — public vote audit log (only after vote closes, shuffled)
  - `GET /votes/:id/verify?receipt=X` — verify a vote receipt (exact match only)
- Event filtering by `process_id`, `event_type`, and combined filters via query params
- Pretty-print option on events endpoint (`?pretty=true`)
- Debug seed endpoint (`GET /debug/seed`) — clears all data (processes, events, inputs, proposals) and reseeds
- Health check at `GET /health`
- Root endpoint returns endpoint directory
- CORS middleware (allows all origins with `*`, includes `Authorization` header)
- Process creation accepts optional `content` field for structured issue content

**Missing/Rough:**
- No input sanitization beyond basic required-field checks
- No pagination on `GET /events` or `GET /process` — returns all records
- No rate limiting
- CORS is wide open — fine for dev, not for production
- Admin routes (`/admin/*`) are unprotected — no admin-specific auth
- Auth is email-based OTP with console logging (no real email delivery in dev)

---

### Backend: Process Model (`civic-hub/src/models/process.ts`)

Structured content types for rich issue pages:
- `ProcessContent` — optional field on Process, containing:
  - `core_question`, `sections[]`, `key_tradeoff`, `links[]`, `community_input`, `after_vote`
- Content is stored directly on the Process object and passed through read models
- Backward-compatible — processes without content render the plain description only

---

### Backend: Modular Architecture (`civic-hub/src/modules/`)

#### `/modules/civic.vote/` — Portable Vote Process Module

Self-contained module implementing the full civic.vote lifecycle. No direct imports from hub routes or UI.

**Lifecycle states:** `draft → proposed → threshold_met → active → closed → finalized`

**Activation modes:**
- `"direct"` — allows `draft → active` only
- `"proposal_required"` — allows `draft → proposed → threshold_met → active` (full proposal path)

**Actions:** `process.propose`, `process.support`, `process.unsupport`, `process.activate`, `process.vote`, `process.close`, `process.finalize`

**Events emitted:** `civic.process.proposed`, `civic.process.threshold_met`, `civic.process.started`, `civic.process.vote_submitted`, `civic.process.ended`, `civic.process.result_published`

#### `/modules/civic.proposals/` — Civic Proposal Intake Module (NEW 2026-04-03)

Separate module for user-submitted civic proposals. Proposals are raw, unstructured ideas — distinct from curated civic.vote processes.

**GUARDRAIL:** This module MUST NOT import from civic.vote. Conversion is handled by the admin controller.

**Files:**
- `models.ts` — Types: `Proposal`, `ProposalSupport`, `ProposalStatus`, `CreateProposalInput`, `ProposalConfig`
- `events.ts` — Event emission helpers: `emitProposalSubmitted`, `emitProposalSupported`, `emitProposalEndorsed`, `emitProposalConverted`
- `index.ts` — Service interface: create, list, support, convert, archive, read models

**Lifecycle states:** `submitted → endorsed → converted` (or `archived`)

**Endorsement threshold:** Configurable via `ProposalConfig.proposal_support_threshold` (default: 5). When support_count >= threshold, status auto-transitions to "endorsed".

**Events emitted:**
- `civic.proposal.submitted` — user creates a proposal
- `civic.proposal.supported` — user endorses a proposal
- `civic.proposal.endorsed` — proposal reaches support threshold
- `civic.proposal.converted` — admin converts proposal to civic.vote process

**Data model:**
- Proposals stored in separate in-memory Map (not in process registry)
- Support records stored per-proposal with unique constraint (one support per user per proposal)
- Read models include `has_supported` for actor-aware views

#### `/modules/civic.auth/` — Email-Based Authentication Module (NEW 2026-04-03)

Minimal auth for civic participation. No passwords, no complex identity verification.

**GUARDRAIL:** This module MUST NOT import from civic.vote or civic.proposals.

**Files:**
- `models.ts` — Types: `User`, `PendingVerification`, `Session`
- `index.ts` — Service: request code, verify, affirm residency, session management

**User data model:**
- `id` — unique identifier (format: `user_<hex>`)
- `email` — normalized (lowercase, trimmed)
- `email_verified` — set to `true` on successful code verification
- `is_resident` — set to `true` when user affirms Floyd County residency
- `created_at` — ISO 8601 timestamp

**Auth flow:**
1. User enters email → `requestVerification()` generates 6-digit OTP, logs to console (dev)
2. User enters code → `verifyCode()` validates, creates/finds user, returns session token
3. First-time user: `affirmResidency()` sets `is_resident = true`
4. Returning user: residency is persisted, skips step 3

**Session management:**
- Bearer token in Authorization header
- In-memory session store (DEV-ONLY)
- `getUserFromToken()` resolves token → user
- `logout()` destroys session

**OTP behavior:**
- 6-digit random code
- 10-minute expiry
- DEV: Code logged to server console (no email sending — no external network calls)

#### `/modules/civic.receipts/` — Anonymous Vote Receipt Module (NEW 2026-04-04)

Strict data separation between user identity and vote records. No cryptographic complexity.

**GUARDRAIL:** This module MUST NOT store receipt_id alongside user_id.

**Files:**
- `models.ts` — Types: `VoteRecord`, `UserParticipation`
- `index.ts` — Service: `recordVote`, `verifyReceipt`, `getVoteLog`, `hasUserVoted`, `clearReceipts`

**Data separation (two stores, no link):**
- `voteRecords` (Map by receipt_id): `receipt_id`, `process_id`, `choice`, `created_at` — NO user_id
- `participation` (Map by "user_id:process_id"): `user_id`, `process_id`, `has_voted` — NO receipt_id

**Receipt generation:** `crypto.randomUUID()` — standard UUID v4

**Privacy protections:**
- Timestamps are stored internally but NEVER exposed publicly
- Vote log is shuffled (Fisher-Yates) before rendering — no ordering inference
- Vote log only available after vote is closed or finalized
- Receipt lookup is exact match only — no partial or fuzzy search

#### `/modules/civic.input/` — Community Input Module

Separate module for free-text submissions tied to a process. GUARDRAIL: No imports from civic.vote.

---

### Backend: Process Registry (`civic-hub/src/processes/`)

- Plugin architecture via `ProcessHandler` interface
- Two process types registered: `civic.vote`, `civic.proposal` (legacy)
- `voteProcess.ts` handler passes `content` and `jurisdiction` through read models

---

### Backend: Controllers

- `processController.ts` — Process CRUD and action dispatch
- `proposalController.ts` — User-facing proposal submission, listing, detail, and endorsement
- `adminController.ts` — Admin proposal review, conversion to civic.vote, and archival
- `authController.ts` — (NEW) Email auth flow: request-code, verify, residency, me, logout
- `eventController.ts` — Event listing with filters
- `inputController.ts` — Community input submission
- `debugController.ts` — Seed data (clears all data including auth on reset)

---

### Backend: Debug / Seed Data (`civic-hub/src/debug/`)

- Seed scenarios in `src/debug/seedData.ts` — not loaded at startup
- **Floyd County Flock Camera issue** as the only seed scenario
- Server starts clean with zero processes and zero proposals
- `GET /debug/seed` clears all data and reloads

---

### Frontend: Pages (`civic-hub/ui/src/pages/`)

- **`VoteLog.tsx` — NEW (2026-04-04)** — Vote audit log page (`/votes/:id/log`):
  - Receipt lookup section: exact receipt ID search with found/not-found states
  - Public vote log section: shuffled list of receipt_id + choice (no timestamps)
  - Only available after vote is closed or finalized
  - Before close: shows "Vote log will be available after voting ends"
  - Auto-verifies if `?receipt=X` is in the URL
  - Highlights matched receipt in the log table
- `Home.tsx` — Two sections: Active Votes, Proposed Votes. Proposed Votes is a single unified section showing civic.vote proposals, legacy proposals, and civic.proposals together. Includes "+ Propose an Issue" CTA in section header. Empty states: "No active votes." / "No proposals yet."
- `Process.tsx` — Vote/proposal detail with jurisdiction badge, structured content, community input
- `About.tsx` — Full About page with 8 sections
- **`Propose.tsx` — NEW (2026-04-03)** — User-facing proposal submission form:
  - Fields: title (required), description (optional), links (optional, one per line)
  - Submits to `POST /proposals`
  - Redirects to Home on success
  - Error handling and validation
- **`ProposalDetail.tsx` — NEW (2026-04-03)** — Proposal detail page (`/proposal/:id`):
  - Shows proposal title, description, status, submitted by, date
  - Endorsement progress bar (support_count / threshold)
  - "Endorse This Proposal" button (once per user)
  - Status-specific notices: gathering support, endorsed, converted, archived
  - Related links section
- **`AdminProposals.tsx` — NEW (2026-04-03)** — Admin proposal review dashboard (`/admin/proposals`):
  - **List view:** All proposals sorted by endorsed first, then submitted. Shows title, status badge, support count, submitter, date. Click to open detail.
  - **Detail view:** Full proposal with description, links, endorsement count. "Review & Convert to Vote" button (endorsed only). "Archive" button.
  - **Review/Convert view:** Editable form prefilled from proposal:
    - Vote title, core question, voting options (one per line)
    - Jurisdiction field
    - Key tradeoff
    - Context sections (dynamic add/remove): What is it, Why it matters, Concerns, Local context
    - Learn more links (prefilled from submission)
    - "Convert to Vote" creates civic.vote process and marks proposal as converted
    - Emits `civic.proposal.converted` event

---

### Frontend: Components (`civic-hub/ui/src/components/`)

- `ProcessCard.tsx` — Handles all lifecycle statuses
- `VotePanel.tsx` — Full lifecycle support including "Remove Endorsement" button (proposed state only). Auth-gated: endorse and vote buttons trigger AuthModal for unauthenticated users. Includes vote privacy notice. Shows anonymous vote receipt after voting with receipt ID and "Verify my vote" link. Shows "View Vote Log" button when vote is closed/finalized.
- `ProposalCard.tsx` / `ProposalPanel.tsx` — Legacy civic.proposal support
- **`AuthModal.tsx` — NEW (2026-04-03)** — Multi-step auth modal:
  - Step 1: Email input ("Create an account to participate")
  - Step 2: 6-digit OTP verification (dev hint to check server console)
  - Step 3: Residency affirmation checkbox ("I confirm that I am a resident of Floyd County, Virginia")
  - Reuses `.intro-overlay` / `.intro-modal` styling. Escape/backdrop dismiss.
  - Returning users with `is_resident = true` skip step 3 automatically.
- `IntroPopup.tsx` — First-visit welcome modal with localStorage persistence
- `IssueContent.tsx` — Structured content renderer
- `CommunityInputPanel.tsx` — Community input submission and display
- `HubHeader.tsx` — Hub banner with two-line header ("Floyd County, Virginia" / "Civic Hub") and tagline

---

### Frontend: Services & Config

- `api.ts` — All process, vote, proposal, admin, and input API types and functions
- **`auth.ts` — NEW (2026-04-03)** — Auth API client:
  - `requestCode()`, `verifyCode()`, `affirmResidency()`, `getMe()`, `logoutApi()`
  - `AuthUser` type with `id`, `email`, `email_verified`, `is_resident`, `created_at`
  - Token storage in `localStorage` via `getStoredToken()`, `storeToken()`, `clearToken()`

---

### Frontend: Navigation & Routing (`civic-hub/ui/src/App.tsx`)

**Updated (2026-04-03):**
- `AuthProvider` wraps entire app — provides auth state to all components
- Top nav bar: Home, Propose, About, Admin. Shows logged-in user email + logout button when authenticated.
- IntroPopup shown on first visit
- Routes: `/` (Home), `/process/:id` (Process), `/propose` (Propose), `/proposal/:id` (ProposalDetail), `/admin/proposals` (AdminProposals), `/about` (About)

### Frontend: Auth Infrastructure (`civic-hub/ui/src/context/`, `hooks/`)

**NEW (2026-04-03):**
- **`AuthContext.tsx`** — React context providing: `user`, `token`, `actorId`, `canParticipate`, `login()`, `updateUser()`, `logout()`
  - Restores session from `localStorage` on mount via `GET /auth/me`
  - `actorId` = `user.id` (used as actor in all API calls) or `null`
  - `canParticipate` = authenticated + email_verified + is_resident
- **`useRequireAuth.ts`** — Hook for gating actions: `requireAuth(action)` runs the action if authenticated+resident, otherwise shows AuthModal. On auth completion, the pending action auto-executes (resume behavior).

### Frontend: Styles (`civic-hub/ui/src/App.css`)

**Added (2026-04-03):**
- Propose page: `.propose-form`, `.form-field`, `.form-label`, `.form-input`, `.form-textarea`, `.propose-submit-button`
- Community proposals section: `.section-header-row`, `.propose-link`, `.inline-link`
- Proposal detail: `.proposal-endorsement-section`, `.proposal-endorsed-notice`, `.proposal-converted-notice`, `.proposal-archived-notice`
- Admin page: `.admin-page`, `.admin-subtitle`, `.admin-action-message`, `.admin-proposal-list`, `.admin-proposal-item`
- Admin status badges: `.admin-status-endorsed`, `.admin-status-submitted`, `.admin-status-converted`, `.admin-status-archived`
- Admin detail: `.admin-detail-section`, `.admin-links-list`, `.admin-actions`, `.admin-convert-button`, `.admin-archive-button`
- Admin review form: `.admin-review-form`, `.admin-sections`, `.admin-section-editor`, `.admin-remove-section`, `.admin-add-section`, `.admin-convert-actions`
- Nav admin link: `.nav-link-admin` (right-aligned, subtle opacity)
- Hub header: `.hub-label` (secondary label below jurisdiction name), `.hub-tagline` (replaces `.hub-description`)
- Footer: `.app-footer` (centered, small, neutral), `.app-footer a` (underlined, subtle link styling)
- All previously added styles preserved (issue content, community input, intro popup, endorsement actions, etc.)

---

### Test Infrastructure (`civic-hub/scripts/testFlow.ts`)

70+ assertions across 3 phases — all passing. No changes needed for this session.

---

## Proposal → Vote Pipeline

### How It Works

1. **User submits proposal** via `/propose` page → `POST /proposals`
   - Creates `civic.proposals` record with status "submitted"
   - Emits `civic.proposal.submitted` event

2. **Community endorses** via `/proposal/:id` page → `POST /proposals/:id/support`
   - One endorsement per user per proposal
   - Each endorsement emits `civic.proposal.supported` event
   - When `support_count >= proposal_support_threshold` (default: 5):
     - Status transitions to "endorsed"
     - Emits `civic.proposal.endorsed` event

3. **Admin reviews** via `/admin/proposals` dashboard
   - Endorsed proposals surface at top of list
   - Admin sees original submission (title, description, links)

4. **Admin curates and converts** via Review & Convert form
   - Prefills from proposal data
   - Admin edits: title, question, options, context sections, tradeoff, links, jurisdiction
   - On convert: creates `civic.vote` process via `createProcess()`
   - Proposal status → "converted"
   - Emits `civic.proposal.converted` event

5. **Vote process continues** normal civic.vote lifecycle
   - Created in "draft" status with `activation_mode: "proposal_required"`
   - References source proposal via `state.source_proposal_id`

### Architectural Boundaries

- `civic.proposals` module is fully independent — no imports from civic.vote
- Conversion is coordinated by `adminController.ts` which imports from both modules
- Events flow through centralized `emitEvent()` as required
- Proposals and processes use separate data stores
- The legacy `civic.proposal` process type (in process registry) is retained for backward compatibility

### Configuration

- `proposal_support_threshold`: Set via `setProposalConfig()` on the module. Default: 5.
- Currently hardcoded; should be made configurable via hub config file or API.

---

## Authentication & Participation Gating

### Auth Flow (Email OTP)
1. User clicks a gated action (endorse, vote, propose) → AuthModal opens
2. User enters email → `POST /auth/request-code` → 6-digit OTP logged to server console (dev)
3. User enters code → `POST /auth/verify` → session token returned, stored in `localStorage`
4. First-time user: residency checkbox → `POST /auth/residency` → `is_resident = true`
5. Returning user: if already `is_resident`, residency step is skipped
6. Pending action auto-executes after auth completion (resume behavior)

### Gated Actions
- **Endorse proposal** (VotePanel "Endorse Proposal" button)
- **Cast vote** (VotePanel vote option buttons)
- **Submit proposal** (Propose page form submission)
- **Endorse civic proposal** (ProposalDetail "Endorse This Proposal" button)

### Residency Storage
- Stored on `User.is_resident` (boolean) in the civic.auth module
- Set once via `POST /auth/residency`, persists across sessions
- Required before first participation — cannot vote/endorse/propose without it

### Privacy Messaging
- **VotePanel**: "Votes are private. Only total results are shown." (shown during active voting)
- **About page** (Participation and integrity section): "Individual votes are not publicly associated with identities. Only aggregated results are displayed."

### Session Persistence
- Token stored in `localStorage` key `civic_auth_token`
- AuthContext restores session on app mount via `GET /auth/me`
- Nav bar shows user email + "Log out" button when authenticated

---

## Floyd County Flock Camera Issue

### Where Created
- Seed scenario: `civic-hub/src/debug/seedData.ts` → `FLOYD_FLOCK_CAMERA` export
- Loaded via: `GET /debug/seed` endpoint

### How Initialized
1. Process created as `civic.vote` with `activation_mode: "proposal_required"`, `jurisdiction: "us-va-floyd"`
2. Proposed via `process.propose` by `user:civic-admin`
3. Three initial supporters seeded
4. Three community inputs seeded
5. **Support threshold: 5** — currently at 3/5

### Structured Content
Full issue content in `process.content`: core question, 4 sections, key tradeoff, 5 learn more links, community input config, after-vote info with recipients.

---

## Assumptions Made

1. **Proposals are separate from processes** — civic.proposals has its own data store, not registered in the process registry. This keeps the two concerns cleanly separated.

2. **Admin authentication is deferred** — `/admin/*` routes are unprotected. Any user can access them. Real auth is Phase 2.

3. **Conversion creates a draft vote** — The converted vote starts in "draft" status with `activation_mode: "proposal_required"`. It still needs to go through the vote's own proposal/support cycle before becoming active.

4. **Proposal support is permanent** — Once a user endorses a proposal, they cannot remove it (unlike vote endorsements which can be removed in "proposed" state). This is a deliberate simplification.

5. **Threshold is module-level config** — All proposals share the same `proposal_support_threshold`. Per-proposal thresholds are not yet supported.

6. **The admin review form is minimal** — No WYSIWYG, no preview, no image uploads. Just text fields matching the ProcessContent structure.

7. **No notification system** — The admin dashboard IS the notification system. Admins must check it manually.

8. **No real email delivery** — OTP codes are logged to server console. In production, integrate an email provider (e.g., SendGrid, SES). No external network calls in v0.1.

9. **Auth does not enforce backend action gating** — The backend still accepts any `actor` string in action payloads. Auth gating is frontend-only for now. Backend enforcement would require middleware that validates Bearer tokens on action endpoints.

10. **Session tokens have no expiry** — In-memory sessions last until server restart or logout. Production should add TTL.

---

## Open Questions

1. **Admin authentication** — Admin routes are unprotected. How should admin access be controlled?

2. **Backend auth enforcement** — Should action endpoints (`POST /process/:id/action`, `POST /proposals/:id/support`) require a valid Bearer token?

3. **Per-proposal thresholds** — Should different proposals have different support thresholds?

4. **Proposal editing** — Can submitters edit proposals after submission?

5. **Converted vote initial state** — Should converted votes start in "draft" or skip to "proposed"?

6. **Deprecate legacy civic.proposal process type** — The new civic.proposals module fully subsumes it.

7. **Real email delivery** — What email provider for production OTP delivery?

8. **Process descriptor API endpoint** — `PROCESS_DESCRIPTOR` exists but isn't served via API.

---

## Suggested Next Tasks

### High Priority (Floyd Pilot)
1. **Backend auth enforcement** — middleware to validate Bearer tokens on action endpoints
2. **Admin authentication** — shared secret or admin email list
3. **Real email delivery** — integrate email provider for OTP codes
4. **Fix event feed ordering** — spec requires descending timestamp

### Medium Priority
5. **Session TTL** — add expiry to auth sessions
6. **Add pagination** to `GET /events`, `GET /process`, `GET /proposals`
7. **Align discovery manifest** with spec
8. **Make proposal_support_threshold configurable** via hub config
9. **Remove legacy civic.proposal process type** from registry

### Lower Priority
10. **Add real test framework** (vitest)
11. **Add monorepo tooling** (npm workspaces)
12. **Proposal edit endpoint** for submitters

---

*Last updated: 2026-05-27*
*Civic Hub Build Log — extracted from monorepo HANDOFF.md*
