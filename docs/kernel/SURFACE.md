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
| Projects, Meeting summaries, Votes, Briefs, Conversations | not yet | | |

Version 1 has gained so far, on the server: `processesOf(...types)` (`get`, `list`, `create`, `saveState`, and
for a person `actOn`, `page`, `view`; `sampleIds`), `draftsOf(kind)` (`get`, `create`, `update`, `setStatus`,
`assistantStore()`), `inputs` (`forProcess`, `visibleInPhase`, `countVisibleOutsidePhase`), `hubContext()`'s `place`
(the kernel's spacePlace) and `participantNoun(n)`, `DAY_MS`, `lines`, `AssistantTypeConfig`, `DraftField`,
`assertPassesWordlist`, `requireAuthor` and `authorshipOf` (posting for the space; the author's public role is the
kernel's accountable role), `resolveCallerIsAdmin`, `enrichCreator`, `enrichCreators`, `PUBLIC_ADMIN_NAME`,
`extractUrls`, `warmLinkPreviews`, `CreateProcessInput`. On the UI side, the kernel UI surface below
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
| Samples | `sampleDeliverySuppressed` | `isSampleSpace()` | brief |

## Moves: into the package that owns it

| Code in `src/` today | Into | Names that leave the SDK |
| --- | --- | --- |
| `src/modules/civic.receipts/`, `AlreadyVotedError` (`src/db/atomic.ts`) | Votes | `HeldReceipt`, `VoteRefusedError`, `countVoters`, `getBallotChoicesForProcess`, `getVoteLog`, `hasUserVoted`, `recordOrUpdateVote`, `reshuffleBallotsForProcess`, `verifyReceipt`, `AlreadyVotedError` |
| Vote settings in `src/services/hubSettings.ts` | Votes (its own declared settings) | `getSupportThreshold`, `voteDurationLimitsSync`, `defaultCheckModeSync` |
| `src/services/briefRegenerate.ts`, `briefResponses.ts`, `briefFinalize.ts`, `publishedBriefRows`, `briefIdForSource`, `getVoteResultsRecipients` | Briefs | `applyOnApproval`, `discardBriefRevision`, `publishBriefRevision`, `regenerateBrief`, `insertResponse`, `latestAnchorAt`, `listResponsesForBrief`, `responderNames`, `finalizeBriefSource`, `publishedBriefRows`, `briefIdForSource`, `getVoteResultsRecipients` |
| `src/debug/seedDeliberationMocks.ts` | Conversations | `addMockStatement`, `advanceMockStatement`, `getMockClusters`, `getMockNextStatement`, `isSeedConversation` |
| `src/shared/` files only one package reads (`checkMode`, `voteOptions`, `announcementBoard`, `meetingSummaryRules`, `wixFields`, `connectorOptions`, `seedStatements`, `officialTypes`) | that package | none (they were plain imports) |

## Event: couplings that go

| Coupling | Replaced by |
| --- | --- |
| Conversations calls `regenerateBrief`, reads `DeliberationResult`/`DeliberationSummary`, `RegeneratedBrief` | the conversation's closed page reads its own saved result; the kernel's `process.closed` event; Briefs listens (Plugin Dependencies Strategy, case 4) |
| Briefs reads `DeliberationResult`/`DeliberationSummary` | the `process.result` contract each process type fills; Briefs reads it from the event |
| Meeting summaries call `isPluginEnabledSync` | `enhancedBy` in its manifest, or the capability it needs |
| Conversations call `getProcessHandler`, `getActionDispatcher` | `actOn` (kernel, above) |
| The kernel's `src/processes/spawnBrief.ts` and the ten files in `PACKAGE_REACH_NOT_YET` | events and contributions (step 3) |
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
  `BriefPointer` is exported until step 3 makes it Briefs' contribution.
- **Moves with the page**: components only one type uses (`VotePanel`, `ReceiptCode`, `deliberation/*`,
  `ProposalCommentForm`, `BriefRegenerate`, `BriefPointer` goes to Briefs as an enhancement).
