# The kernel surface: every engine name the packages use

Step 1 of the kernel extraction (docs/KERNEL.md §8). The eight first-party packages that still import the hub's
SDK version 0 (`@civic-social/plugin-sdk/first-party`) use 104 names that version 1 (`kit/sdk/index.ts`) does not
offer. Events already uses version 1 only. Each name is decided here as one of:

- **Kernel**: a service every space type needs. Version 1 gains it, under a neutral name where the old one is civic.
- **Moves**: plugin code that lives in `src/` today. It moves into the package that owns it, with its tables and
  tests, and leaves the SDK.
- **Event**: a plugin reaching into another plugin or the kernel naming a plugin. Replaced by an event or a
  contribution the plugin registers (docs/KERNEL.md §2).

Inventory taken at `69e0a13` (dev, Nov 16). Regenerate: `npx tsx scripts/kernel-surface.ts` (`--count` adds, per
package, the paths it still imports from `src/` or `ui/src/`).

## Progress

| Package | On version 1 | Pages in the package | Pages on the kit |
| --- | --- | --- | --- |
| Events | 0.4.0 | yes | yes |
| Word clouds | 0.3.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES` in the conformance suite until then) |
| Announcements | 0.4.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Proposals | 0.3.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Projects | 0.3.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Meeting summaries | 0.3.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Votes | 0.4.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Briefs | 0.4.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |
| Conversations | 0.4.0 (Nov 17) | yes, moved as they were | next release (`MOVED_HUB_PAGES`) |

Step 1 is complete: every package here imports SDK version 1 only. Version 0 (`/first-party`) stays for a package
outside this repository that still uses it; none here does.

Version 1 has gained so far, on the server: `processesOf(...types)` (`get`, `list`, `create`, `saveState`, and
for a person `actOn`, `page`, `view`; `sampleIds`), `draftsOf(kind)` (`get`, `create`, `update`, `setStatus`,
`assistantStore()`), `inputs` (`forProcess`, `visibleInPhase`, `countVisibleOutsidePhase`), `hubContext()`'s `place`
(the kernel's spacePlace) and `participantNoun(n)`, `links.validate`, `ProposedLink`, `DAY_MS`, `lines`, `AssistantTypeConfig`, `DraftField`,
`assertPassesWordlist`, `requireAuthor` and `authorshipOf` (posting for the space; the author's public role is the
kernel's accountable role), `resolveCallerIsAdmin`, `enrichCreator`, `enrichCreators`, `PUBLIC_ADMIN_NAME`,
`extractUrls`, `warmLinkPreviews`, `CreateProcessInput`; since Meeting summaries `settingsOf(pluginId)` (`get(name)`
for its own `plugin.<id>.*`, `enabled()`, `public(key)` for the hub's public settings), `processesOf().archive`,
`brokenLinkProblem`, `findBrokenPublications`, `PLATFORM_CONTACT_EMAIL`, `resolveTimeZone`, `TranscriptSegment` and
`AiSingleTurnInput`. A package tells the admins about a job through the mail adapter's `send` and `adminAddresses`
(`notifyJobOutcome` left the adapter; Meeting summaries' alert email is its own `alerts.ts`). Since Briefs:
`results` (`source(id)`, `fresh(id)`, `adopt(id, state, by)`, `finalize(id, actor)`: what a closed process of any
type came to, asked of its own type, and settling it once the result is public), `offices` (`officialOf(res)`,
`onRecordNames(ids)`, `resultRecipients()`), `requireOfficial`, `recordAdminAct`, `links.countTouching` and
`links.wireIris`, `publishedMessage`, `sampleDeliverySuppressed`, and the types `OfficialIdentity`,
`DeliveryReport`, `HeldBackRecipient`, `DeliberationResult`, `DeliberationSummary`, `ResultSource`, `FreshResult`.
Since Conversations: `processesOf().actAsSystem(id, action, "system:…")` (an action as the hub itself, after a close
commits) and `processesOf().submit(res, input, { cocPassed })` (the one creation path, outside a draft),
`codeOfConduct.check(res, fields)` (the hub's automated check on submitted text), `samples` (`template(key)`,
`fill(text)`: a sample's template, for a type that serves more than its row), `results.kept`/`results.keep` with the
handler hook `keepResult(process, content)` (what a process keeps from its written-up result: a conversation keeps
its summary, so its closed page reads only itself, Briefs on or off), and the types `CodeOfConductFinding`,
`RegeneratedBrief`. A conversation's summary without a write-up says why with `narrative: "unwritten"`.
A package's own table is read through its host (`host.db().from("brief_responses")`), never `forHub`. On the UI side, the kernel UI surface below
(`ui/src/host/index.ts`). Announcements carries its own copy of the pinned and urgent rules (`board.ts`), kept equal
to the right column's (`src/shared/announcementBoard.ts`) by a test until step 3 makes the board a contribution. A package's UI files are `ui.tsx` and its `ui/`
directory: they alone import `@civic-social/plugin-sdk/ui` and React (lint and `kit/conformance/src/fence.ts`).

## Kernel: version 1 gains these

| Area | Names today | Version 1 shape | Used by |
| --- | --- | --- | --- |
| Processes | `getProcess`, `getAllProcesses`, `getArchivedProcesses`, `createProcess`, `saveProcessState`, `archiveProcess`, `readsAsClosed`, `getSampleProcessIds` | `processesOf(...types)`: `get`, `list` (built), `create`, `saveState`, `archive` (with Announcements); `readsAsClosed`, `isSample`; a package lists and changes **its own types only** | announcement, brief, meeting_summary, polis, projects, proposals, vote, wordcloud |
| Acting and reading | `actOnProcess`, `executeAction`, `readAsPage`, `viewFor` | `actOn`, `processView` (the read model the page shows) | polis, projects, proposals |
| Callers | `resolveCallerUser`, `resolveCallerIsAdmin`, `getActor`, `can`, `getUser`, `requireBoardOrAdmin`, `requireOfficial` | `caller(req)`, `can(actor, action)`, `requireRole("admin" \| "moderator" \| "accountable")` | announcement, brief, polis, projects, proposals |
| People shown | `enrichCreator`, `enrichCreators`, `personFallbackName`, `PUBLIC_ADMIN_NAME` | folded into `namesFor` (already version 1) | announcement, brief, meeting_summary, polis, projects, proposals |
| Settings | `getSettingSync`, `KEYS`, `hubDisplayNameSync`, `resolveTimeZone`, `currentHubId`, `uiBaseUrl` | `settings.get(key)` for the package's own declared settings and the kernel's public ones; `hubContext()` (version 1) gains `id` | brief, meeting_summary, polis, projects, proposals, vote |
| The space's place | `defaultJurisdiction`, `processJurisdiction` | `spacePlace()`: the scope a space serves (a jurisdiction on a Civic Hub, nothing on a club) | meeting_summary, polis, projects, proposals |
| Drafting | `getDraft`, `createDraft`, `updateDraft`, `setDraftStatus`, `appendConversation`, `applyGeneratedDraft`, `saveReviewResult`, `ProposedLink`, `lines`, `DAY_MS` | `drafts.*` beside the `Draft`/`DraftKind` types version 1 has | polis, projects, proposals, vote |
| The drafting assistant | `AssistantTypeConfig`, `DraftField`, `getHubConfig` | a type's assistant config, declared by the package | polis, projects, proposals, vote |
| Moderation | `checkTextAgainstCoC`, `admitCodeOfConductCheck`, `AiLimitError`, `reviewMailbox`, `submitAsCreator` | `moderation.check(text)`, `review.submit(...)` | polis |
| Community input | `getInputsByProcess`, `listVisibleInPhase`, `countVisibleOutsidePhase` | `inputs.forProcess(...)` | projects, proposals, vote |
| Process links | `validateLinkSet`, `processWireIris`, `countLinksTouching` | `links.*` | brief, projects |
| Link previews | `extractUrls`, `warmPreviewsInBackground` | `previews.warm(text)` | announcement, brief |
| Adapters' types | `AiSingleTurnInput`, `TranscriptSegment` | beside `PluginAdapters` (version 1) | meeting_summary |
| Events | `buildEvent` | already `emitEvent`; `buildEvent` only where a package must hand an event to a store in one transaction | vote |
| Operations | `reportError`, `CronOutcome`, `FlaggedSummary`, `WaitingMeeting`, `REVISION_NAG_DAYS`, `BrokenPublication`, `findBrokenPublications` | `reportError`; job outcome types beside `JobOutcome` | meeting_summary, vote |
| Samples | `sampleDeliverySuppressed` | the same name (built, Briefs): a sample's delivery, held back | brief |
| Results | `finalizeBriefSource`, the source half of `regenerateBrief` (`getProcessHandler(...).regenerateBrief`, `closedEarlyView`, writing the source's new state) | `results` (built, Briefs): `source`, `fresh`, `adopt`, `finalize`; the kernel asks the process's own type and names no package | brief |
| Offices | `requireOfficial`, `res.locals.officialIdentity`, `responderNames`, `getVoteResultsRecipients`, `recordHubAdminAudit` | `requireOfficial`, `offices` (`officialOf`, `onRecordNames`, `resultRecipients`), `recordAdminAct` (built, Briefs) | brief |
| Secret ballots | `recordOrUpdateVote`, `hasUserVoted`, `countVoters`, `getBallotChoicesForProcess`, `reshuffleBallotsForProcess`, `getVoteLog`, `verifyReceipt`, `HeldReceipt`, `VoteRefusedError`, `AlreadyVotedError` | `ballots` (built): `cast`, `hasVoted`, `count`, `choices`, `reshuffle`, `log`, `verify`, process first; the errors and `HeldReceipt` beside it | vote |
| Review previews, source lines | `describeSubmissionFields`, `sourceLineToContentLink` | the same names (built) | polis, vote |
| Moderation and review | `checkTextAgainstCoC`, `getHubConfig`, `admitCodeOfConductCheck`, `AiLimitError`, `submitAsCreator`, `reviewMailbox`, `personFallbackName`, `can`, `getActor` | `codeOfConduct.check(res, fields)`, `processesOf().submit(res, input, opts)` (built, Conversations) | polis |
| A process's written result | Conversations reading its brief (`briefIdForSource`, `getProcess`) | `keepResult` on the handler; `results.kept`, `results.keep` (built, Conversations); the kernel's brief spawn and Briefs' regenerate ask it | brief, polis |
| Acting as the hub | `getActionDispatcher`, `executeAction` | `processesOf().actAsSystem` (built, Conversations) | polis |

## Moves: into the package that owns it

| Code in `src/` today | Into | Names that leave the SDK |
| --- | --- | --- |
| ~~`src/modules/civic.receipts/` to Votes~~ | **Stays in the kernel** (decided Nov 17, with Votes 0.4.0): the kernel's districts and demographics totals, the sample seed, the hourly reshuffle, the debug reset and the secrecy guardrails all read the ballots, and any type that takes a secret ballot (participatory budgeting, a ranked vote) would need the same audited code. Version 1's `ballots` above | none |
| Vote settings in `src/services/hubSettings.ts` | Votes (done: `packages/civic.vote/settings.ts`, through `settingsOf("vote")`) | `voteDurationLimitsSync`, `defaultCheckModeSync` (gone); `getSupportThreshold` stays for the admins' settings route and the sample seed until step 3 |
| `src/services/briefRegenerate.ts`, `briefResponses.ts`, `briefFinalize.ts`, `publishedBriefRows`, `briefIdForSource`, `getVoteResultsRecipients` | Briefs (done, 0.4.0: `regenerate.ts`, `responsesStore.ts`; finalizing is the kernel's `results.finalize`; the forwarder left with Conversations 0.4.0, and `briefIdForSource` is the kernel's `spawnBrief` alone now) | `applyOnApproval`, `discardBriefRevision`, `publishBriefRevision`, `regenerateBrief`, `insertResponse`, `latestAnchorAt`, `listResponsesForBrief`, `responderNames`, `finalizeBriefSource`, `publishedBriefRows`, `briefIdForSource`, `getVoteResultsRecipients` |
| `src/debug/seedDeliberationMocks.ts` | Conversations (done, 0.4.0: `mocks.ts`, its sample templates through the kernel's `samples`) | `addMockStatement`, `advanceMockStatement`, `getMockClusters`, `getMockNextStatement`, `isSeedConversation` |
| `src/shared/` files only one package reads (`checkMode`, `voteOptions`, `announcementBoard`, `meetingSummaryRules`, `wixFields`, `connectorOptions`, `seedStatements`, `officialTypes`) | that package | none (they were plain imports) |

## Event: couplings that go

| Coupling | Replaced by |
| --- | --- |
| Conversations calls `regenerateBrief`, reads `DeliberationResult`/`DeliberationSummary`, `RegeneratedBrief` | done for step 1 (0.4.0): its closed page reads only itself (the summary it kept, `keepResult`, else its own result's figures); its older `POST /deliberations/:id/regenerate` link is gone (Regenerate is the brief's), and it no longer `requires` Briefs. Step 3: the kernel's `process.closed` event carries the result; Briefs listens (Plugin Dependencies Strategy, case 4) |
| Briefs reads `DeliberationResult`/`DeliberationSummary` | the `process.result` contract each process type fills; Briefs reads it from the event |
| Meeting summaries call `isPluginEnabledSync` | done: `settingsOf("meeting_summary").enabled()`, its own switch |
| The digest writes a closed vote's count with `voteResultLine` (`src/shared/feedActivity.ts`); Votes' feed card has its own copy | the line rides on the vote's event (step 3) |
| The review preview names a vote's `method` labels (`src/shared/submissionPreview.ts`, `METHOD_LABELS`) | Votes' `describeSubmission` maps it, as it now does `check_mode` (step 3) |
| `/process/:id`, the vote's page, also sends an old link for another type to that type's page | the kernel's redirect, apart from the vote's page (step 3) |
| The settings save checks `wix_fields` (a kind only Meeting summaries uses) with `src/shared/wixFields.ts` | a package's own check of its settings (step 3); until then the package keeps an identical copy, tested equal |
| Conversations call `getProcessHandler`, `getActionDispatcher` | done (0.4.0): `actOn`, `actAsSystem`, and its own handler for its list and its deadline read |
| The kernel's `src/processes/spawnBrief.ts` and the files in `PACKAGE_REACH_NOT_YET` (nine since Briefs) | events and contributions (step 3) |
| The hub's `BriefPointer` and `BriefSourcePointer` (and `ui/src/services/briefDelivery.ts`, the hub's `getPublicBrief`) | Briefs' contribution to a process page (step 3); Briefs' pages read them through `/ui` until then |
| The admin queue counts name `briefs` (`AdminQueue`), and `AdminPublicationReview.css` styles Briefs' and Meeting summaries' review pages | a package registers its queue (step 3); the review frame is kernel UI |
| The hub's welcome strip shows the onboarding word cloud (`WordcloudTeaser`, over HTTP, the `plugin.wordcloud.onboarding_id` setting) | a contribution Word clouds registers to the strip (step 3) |

## The UI side

A package's `ui.tsx` imports only `@civic-social/plugin-sdk/ui`. Its pages move from `ui/src/pages/` into the package.
What those pages use from the hub splits the same way:

- **Kernel UI, exported by `/ui`** (from `ui/src/host/index.ts`; built so far: `apiRequest`, `ApiError`, `useApi`,
  `useAction`, `useRequireAuth`, `AuthModal`, `useViewer`, `useSpace`, `ProcessHeader`, `statusDisplay`,
  `AdminArchiveButton`, `formatDate`, `formatCount`, `safeReturnPath`, the settings fields): the API client and hooks
  (`useApi`, `useAction`, `useRequireAuth`, the viewer, not the hub's whole sign-in state), the space (name, place)
  and clock (`useSpace().timeZone`, the date helpers), the right column's `refreshAside`, a post's picture and link
  previews (`PostFeaturedImage`, `PostImagePicker`, `LinkPreviewCard`), `Creator`, `ShareButton`,
  `RelatedProcesses`, `SampleBadge`, `Modal`, and the process page parts every process type shares (`ProcessHeader`,
  `ShareButton`, `RelatedProcesses`, `Creator`, `CloseEarly`, `EditHistory`, `DetailActions`, `RichText`,
  `AuthModal`, `StatusFilter`, `ProcessListCard`, `SourceLinks`, `SampleBadge`, the settings fields). Since
  Proposals: every one of those, plus `ShareMoment`, `CommunityInputPanel` and `CommentForm`, `ProcessPicker`,
  `useStatusFilter`, `cardDate`, `askAboutYouFirst`, `ResultsBreakdown`, and drafting: `DraftPage` configured by a
  type's `DraftKindConfig`, and the parts its form is built from (`FieldGuide`, `TitleField`, `MarkdownTextarea`,
  `ProcessLinkField`, `SuggestFooterButton`, `DraftFooter`, `FieldFinding`, `hardFindings`, `useDebouncedFields`).
  `BriefPointer` is exported until step 3 makes it Briefs' contribution. Since Projects: `apiUpload`,
  `getEditPolicy`, `startProcessEdit`, `reviewDestination`, `useSpace().participantNoun`. Since Meeting summaries:
  an admin page's `AdminStickyBar`, `AdminBackButton`, `PublicationStatusChip`, `markAdminQueueSeen`,
  `notifyAdminQueuesChanged`; `absoluteDateOfDay`, `localShortDateOfDay`, `localDateAtTime`, `formatDuration`,
  `formatMeetingDate`; `useSpace().governingBodyName`. The admin queue names (`AdminQueue`) are still the hub's list
  (step 3: a package registers its queue). Since Briefs: a publication's review (`PublicationList`,
  `PublicationReview`, `ApproveActions`) and `ConfirmDialog`; `absoluteDate`, `formatShortDate`; `typeName`,
  `manifestOf`, `briefColorSlug`; `spaceNow()` (the space outside a component, for a feed card); `useViewer()`'s
  `office` and `displayName`; the offices (`authorBadges`, `OFFICIAL_TYPES`, `OFFICIAL_TYPE_LABELS`,
  `normalizeOfficialType`, `getOfficialsRoster`); `heldBackLine`, `joinNames`, `briefResponseContext`, and
  `BriefSourcePointer` until step 3. Since Conversations: nothing new; its pages use what is above.
- **Moves with the page**: components only one type uses (`VotePanel`, `ReceiptCode`, `deliberation/*`,
  `ProposalCommentForm`, `BriefRegenerate`, `BriefPointer` goes to Briefs as an enhancement).
