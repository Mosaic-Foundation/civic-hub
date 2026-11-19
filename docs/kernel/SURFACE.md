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
Since step 2 (neutral roles and terms): `term(t, n)` and `hubContext().term` (the kernel's words, as the space type's
profile names them: "resident", "official", "hub" on a Civic Hub), `KERNEL_ROLES`, `KERNEL_TERMS`, `namesRole`, and the
types `KernelRole`, `KernelTerm`; on the UI side `useSpace().term`. Descriptors name `member` and `accountable` (and
`creation.member`); the older `resident`/`official` still read.
Since step 3: `processesOf().idWhere(key, value)` (one of its own processes by a state field), the type `ClosedProcess`, and on the package contract `PluginServer.on.processClosed`, `inputTargets`, `dev.reset`, and the handler hooks `commentPhase` and `flaggedForReview`. Since News Sync moved (Nov 18): `hubContext().placeName` (the place in running text, "Floyd County", or null). `PluginServer.pinnedCard` and the types `PinnedCardItem` and `PluginPinnedCard` were added in pinning phase 2 (Nov 18) and removed when Pinning became a plugin (Nov 19); no release carried them. Since step 4 (Nov 19): `items` (`publicSummaries(ids)`, `publicSummary(id)`: any item as a feature plugin reads it, its title, page, type's word and whether readers see it, never who made it) and the type `ItemSummary`. With Feedback (Nov 19): `providerInbox` (`send(message)`, `softwareVersion()`, `normalizePagePath`: a hub's line to the people who maintain its software; the kernel stamps the hub and version) and the types `ProviderMessage`, `ProviderStatus`, `ProviderOrigin`; `imageUpload` (the kernel's image upload, for a feature to mount on its own path); `offices.adminEmails()`; `asEmailList`; `unsentReason`; and on the feature contract `FeatureServer.queues` (`FeatureQueue`: a name, its words, its admin page and a count; the kernel keeps each admin's cursor under the name and draws its admin-digest line). With the Admin digest a plugin (Nov 19): `adminWindow(since, until)` (what is new for admins in a window, with what is waiting, and the features' notes) and the types `AdminWindow`, `DigestLine`, `DigestDetail`, `DigestLineId`. With Search a plugin (Nov 19): `search.query(query)` (one page of hits from the kernel's index) and the types `SearchQuery`, `SearchResultPage`, `SearchHit`, `SearchSort`, `SearchTypeKey`; on the UI side the slot `navTool` (a tool in the top bar and the menu drawer). With Members a plugin (Nov 19): `membership` (`count()`, `summary()`, `list(offset)`, `hiddenForAdmin()`: who has joined the space, never an address) and the types `Member`, `MemberSummary`, `MembersPage`, `AdminMember`; on the feature contract `FeatureServer.hubConfig` (what a feature's UI needs first, in GET /hub-config under `features.<id>`) and on its manifest `section` (a section in the navigation) and `newSpaceSettings` (what a new space starts with); on the UI side the slots `section` (shown, count), `homeBlock`, `aboutLine`, `accountPanel` and `peopleSection`. `GET /api/aside` was removed. With per-plugin colours (Nov 19): on the package contract `ProcessManifest.colors` and the type `PackageColor` (a family's key, label, light pair, and optional dark pair and email pill); a card kind's `color` takes the same shape.
A package's own table is read through its host (`host.db().from("brief_responses")`), never `forHub`. On the UI side, the kernel UI surface below
(`ui/src/host/index.ts`). Pinning is a feature plugin (`features/pinning`, its own `process_pins` table, kernel step 4);
a feature draws through the UI slots `itemAction` (the row at the foot of every item's page), `asideCards` (the right
column), `pageTop` (the line across the top of the pages), and since Feedback `spaceLink` (a page for everyone: the
top-bar button, the sidebar, drawer and footer links, the welcome pointers) and `adminTab.queue` (the tab's count),
`ui/src/features.ts`. A package's UI files are `ui.tsx` and its `ui/`
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
| Briefs reads `DeliberationResult`/`DeliberationSummary` | the `process.result` contract each process type fills; Briefs reads it from the event (done, step 3: `ClosedProcess.result()`) |
| Meeting summaries call `isPluginEnabledSync` | done: `settingsOf("meeting_summary").enabled()`, its own switch |
| The digest writes a closed vote's count with `voteResultLine` (`src/shared/feedActivity.ts`); Votes' feed card has its own copy | done (step 3): the handler hook `resultLine`; the digest asks the closed event's type for it (`classifiedType`), and Votes keeps the one copy (`packages/civic.vote/resultLine.ts`) |
| The review preview names a vote's `method` labels (`src/shared/submissionPreview.ts`, `METHOD_LABELS`) | done (step 3): Votes' `describeSubmission` maps it, as it does `check_mode` |
| `/process/:id`, the vote's page, also sends an old link for another type to that type's page | done (step 3): the kernel owns the link (`ui/src/pages/ProcessLink.tsx`). A type whose page lives there (Votes) registers it, and gets the link while its plugin is on; otherwise the kernel reads the process and sends the link to its type's page, so old links work with Votes off. `ProcessRoute.ungated` is gone |
| The settings save checks `wix_fields` (a kind only Meeting summaries uses) with `src/shared/wixFields.ts` | done (step 3): `PluginServer.checkSetting(key, value)`; the settings save asks the package whose plugin a `plugin.<id>.` key names (`packageSettingProblem`), and the kernel's copy is gone |
| Conversations call `getProcessHandler`, `getActionDispatcher` | done (0.4.0): `actOn`, `actAsSystem`, and its own handler for its list and its deadline read |
| The kernel's `src/processes/spawnBrief.ts` and the files in `PACKAGE_REACH_NOT_YET` (nine since Briefs) | step 3, first batch done: the kernel's `process.closed` event (`src/services/processClosed.ts`; a package listens with `on.processClosed` and declares `activities.listen: ["process.closed"]`; Briefs makes its brief this way, `packages/civic.brief/onClosed.ts`); a package's `inputTargets` (proposals take comments), `dev.reset`, and the handler hooks `commentPhase` (the vote's divider) and `flaggedForReview` (a flagged meeting summary in the admin digest). Then sample content (done, step 3): the kernel plans and runs the seed and hands each sample to the plugin that provides its type (`PluginServer.samples.seed`, with a `SampleKit`) or to the space type (`SpaceServer.samples`); the Civic Hub's seeders and its development seed live in `spaces/civic/`, and `sampleSeed.ts`, `seedData.ts` and `autoSeed.ts` are off the list. Then News Sync (Nov 18): its job moved into its own package (`packages/civic.news_sync/job.ts`, on SDK v1: `processesOf("civic.news")`, `settingsOf("news_sync")`, the `ai` and `web` adapters, `hubContext().placeName`), so the list is gone: no engine file imports a package (eslint `civic/package-boundary`) |
| The feed's News card (surface `news`: its pill and "From" line, its filter pill, old announcement events that carry a `source`) and the settings page's News Sync hints read `plugin.news_sync.*` in the kernel (`src/shared/feedActivity.ts`, `src/shared/newsSource.ts`, `ui/src/components/Feed.tsx`, `FeedFilter.tsx`, `ui/src/pages/settings/PluginsSection.tsx`) | as the feed's announcement and meeting-summary surfaces today; goes when a package's feed card draws its own pill and "From" line (later in step 3) |
| The right column's Pinned card lists urgent announcements from the kernel (`src/services/aside.ts` reading `src/shared/announcementBoard.ts`), the card falls back to the feed's announcement surface, and the admin rail names Admin → Announcements | done (pinning phase 2, Nov 18): pins live in the hub's `process_pins` table (migration `20261118230000` copies the pins items carried in their state); a package's `PluginServer.pinnedCard` puts its rows at the top (`first`) or fills an empty card (`fill`), and the card is named "Pinned" or after the filling type (`card_title`). Announcements' pin routes, form field, page button and admin page are gone; its urgent items reach the card through `pinnedCard`. Since step 4 (Nov 19): Pinning is a feature plugin of its own (`features/pinning`), the card is its `asideCards` entry (id `pinned`), urgent is a flag on a pin, and `pinnedCard` and Announcements' urgent label are gone |
| The hub's `BriefPointer` and `BriefSourcePointer` (and `ui/src/services/briefDelivery.ts`, the hub's `getPublicBrief`) | done (step 3): a package's `contributes.processTop`, drawn by the kernel's `ProcessPageTop` (`ui/src/components/PackageSlots.tsx`) while its plugin is on. Both pointers and the delivery lines live in Briefs (`packages/civic.brief/ui/`). `BriefPointer` stays in SDK v1 as an older name for `ProcessPageTop`; `BriefSourcePointer`, `heldBackLine` and `joinNames` leave it |
| The admin queue counts name `briefs` (`AdminQueue`), and `AdminPublicationReview.css` styles Briefs' and Meeting summaries' review pages | done (step 3): a manifest names its queue (`publication.queue`, any lowercase name), the kernel counts every one (`adminQueues()`), and a package's `contributes.adminQueue` puts its tab in the rail. A package queue's cursor is kept by name in `users.queues_seen_at` (migration `20261117200000`). The review frame stays kernel UI |
| The kernel seeds every type's sample content by calling each package's service (`src/services/sampleSeed.ts`), and the development seed writes civic scenarios (`src/debug/`) | done (steps 3 and 4): a plugin seeds its own samples (`PluginServer.samples`: `seed(template, kit)`, and optional `defaults()` for a space type that brings none of its type, `title`, `refresh` and `repair`; `src/plugins/samples.ts`). The kit gives the sample people, times relative to now, the hub's names, `create` (marked as sample), `save`, `comment`, `process(key)`, `ballots` (anonymous sample ballots, kernel-kept) and `adoptSetting` (one of its own settings, only when unset and its plugin is stored on). Every first-party type seeds its own (step 4: `packages/<pkg>/samples.ts`); the space type brings only the words, in its vocabulary (`spaces/civic/sampleTemplates.ts`: `SpaceServer.samples` `plan`, `all`, `kinds`, `previews`). The sample refresh asks each plugin which of its samples are live and when one is stale (`src/services/sampleRefresh.ts`, `sampleCatalog.ts`). The development seed is the space type's `dev` (`spaces/civic/dev/`); the kernel keeps the gates and the wipe. Removing the samples empties any `plugin.*` setting that names a removed sample. Still in the kernel: the sample people (`src/services/samplePeople.ts`), and the starter word cloud after removal (`src/services/starterWordcloud.ts`) |
| The hub's welcome strip shows the onboarding word cloud (`WordcloudTeaser`, over HTTP, the `plugin.wordcloud.onboarding_id` setting) | done (step 3): Word clouds' `contributes.welcomeStrip` (`packages/civic.wordcloud/ui/WordcloudTeaser.tsx`), reading its setting with `useSpace().setting`. Sign-up's stop there is Word clouds' `contributes.afterSignUp` too (`packages/civic.wordcloud/ui/onboarding.ts`); the kernel hands it a checked way back (`afterSignUpStop`) |

## Space types

A space type is the layer above the kernel that makes it a Civic Hub (or another kind of space). Its server side is a
`SpaceServer` (`src/plugins/space.ts`): its curated sample content (`samples.plan()`, `samples.seed(template, kit)`)
and its development seed (`dev.seedEmptyHub`, `dev.seedAfterReset`). A space type's folder holds `index.ts` (that
server side), `type.ts` (its record: names, mail senders, profile; `SpaceType` in `src/shared/spaceTypes.ts`),
`profile.ts`, `palette.ts` and `palette.css`, each with a default export where it is data. Its record's `plugins`
lists each plugin it cares about as `required` (always on; the switch and Remove are refused), `on` or `off` by
default; the rest keep their own default (`spacePluginRule`, `pluginRequired` in `src/shared/spaceTypes.ts`).

The deployment picks its space type with one line, `"space": "spaces/<dir>"` in `config/plugins.json` (or `null`
for none; kernel step 4). `npm run plugins:sync` writes `config/space.ts`, `config/spaceType.ts`,
`config/spacePalette.ts` and `config/spacePalette.css` from it, and CI's `--check` keeps them current. The kernel
reads each in one place (`src/plugins/spaceType.ts`, `src/shared/spaceTypes.ts`, `src/shared/spacePalette.ts`,
`ui/src/styles/hubStyles.ts`) and never imports `spaces/` (eslint `civic/package-boundary`). With no space type,
hubs start empty, the record is the kernel's neutral one (`NEUTRAL_SPACE_TYPE`) and there is no palette. The Civic
Hub's is `spaces/civic/`. A space type may use the kernel's modules and the packages it curates, a package's values
only by `await import()`.

## The UI side

A package's `ui.tsx` imports only `@civic-social/plugin-sdk/ui`. Its pages move from `ui/src/pages/` into the package.
What those pages use from the hub splits the same way:

- **Kernel UI, exported by `/ui`** (from `ui/src/host/index.ts`; built so far: `apiRequest`, `ApiError`, `useApi`,
  `useAction`, `useRequireAuth`, `AuthModal`, `useViewer`, `useSpace`, `ProcessHeader`, `statusDisplay`,
  `AdminArchiveButton`, `formatDate`, `formatCount`, `safeReturnPath`, the settings fields): the API client and hooks
  (`useApi`, `useAction`, `useRequireAuth`, the viewer, not the hub's whole sign-in state), the space (name, place)
  and clock (`useSpace().timeZone`, the date helpers), a post's picture and link
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
