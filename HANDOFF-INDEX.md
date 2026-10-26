# HANDOFF-INDEX.md — read this, not HANDOFF.md

HANDOFF.md is the full build log: 181 dated entries, newest first, ~11,650 lines.
Reading it whole costs most of a session's context. Use this index to find the
entry you need, then read only that line range (`sed -n START,ENDp HANDOFF.md`).
Line numbers are as of 2026-09-22; new entries are prepended at the top, so add
the length of anything newer than "Login hardening" (now ~line 190) to the
numbers below, or just grep the heading.

## Where things are

| Need | File |
|---|---|
| Project rules, folder map, session ritual | `../CLAUDE.md` |
| Test commands, coverage, CI notes | `TESTING.md` |
| The local stack: start, reset to the fixture set, stop (dev servers, stack, Docker; every session before handoff), status; test runs deleting the hubs they create | `scripts/local-stack.sh`, `tests/setup/dropTestHubs.ts`; TESTING.md → Quick Start |
| Config: every setting (purpose, type, default, required, layer), checked at startup; the generated list | `src/config/settings.ts`, `src/config/checkSettings.ts`, `npm run settings:doc` → RUNBOOK-operations.md → Settings; values: `.env.example`, `ui/.env.example`; ADR-012 |
| Hub identity and jurisdiction constants | `src/config/hub.ts` |
| Runtime settings read/write (`hub_settings`) | `src/services/hubSettings.ts` |
| Settings key names, aliases, env fallbacks, public list | `src/models/hubSettings.ts` |
| Settings reaching every server at once: `hubs.settings_version` (bumped by trigger), the per-request hub read, the version-checked cache; the two-server test | `src/db/hubs.ts`, `src/db/hubSettingsStore.ts`, `20261018000000`, `tests/api/settingsVersion.test.ts` |
| The console's Dashboard: the section registry, loaders (hubs' health, jobs, outside services, pending counts), the page and its renderers; adding a section | `src/control/dashboard/` (`registry.ts`), `GET /control/dashboard`, `ui/src/console/{Dashboard,dashboardSections}.tsx`, `src/db/jobLastRun.ts` (`job_last_run`, `20261019000000`), `src/jobs/schedule.ts`; ADR-007; HANDOFF "Dashboard" (2026-10-17) |
| Admin queue counts (database counts, past 1,000) | `src/services/adminQueues.ts`, `count_pending_reviews` (`20261018010000`), `countUnseenEdits` in `src/services/editNotifications.ts` |
| Shared legal documents + per-hub substitution | `config/legal/`, `src/services/hubDocuments.ts` |
| Seeding a hub's settings from env | `scripts/seed-hub-settings.ts` |
| Releasing a change with migrations: the order (migrations, schema reload, code, `/health`), pre-checks, the guard | `RUNBOOK-release.md` |
| Dev deployment runbook + Preview env checklist; dev domain `*.dev.civic.social` (§9) | `DEPLOY-dev.md` |
| Guards: production db push, deploy env safety | `scripts/db-push.sh`, `scripts/check-deploy-env.ts` |
| Auth, sessions (the identity adapter: `sessionUser`) | `src/middleware/auth.ts`, `src/modules/civic.auth/` (per-IP caps: `limits.ts`) |
| Authorization: the one seam (`canActor`, the rule for adding a check), the actor, eligibility (the hub's rule, a manifest's `eligibility`); role grants (`hub_roles`, filled by trigger from the people lists; cached per hub); the coverage check; the parity test and its frozen old rules; the lint | `src/authz/{canActor,actor,eligibility}.ts`, `src/db/hubRolesStore.ts`, `20261023000000_hub_roles.sql`, `scripts/check-hub-roles.ts`, `tests/api/authzParity.test.ts` + `tests/fixtures/authz/oldRules.ts`, `civic/authz-seam` in `eslint.config.js`; ADR-011 |
| The actor's own DID on the wire (`events.wire_actor_did`, `users.identity_did_source`) | `20261023010000_actor_did.sql`, `actorDidServable` in `src/events/publicPayload.ts`, `actorIri` in `src/events/activitySerializer.ts`; ADR-011 |
| Sign-in codes: the rules (three live codes, tries burn the code, never the address), the email and its link, Keep me signed in; the console's and start page's store | `src/modules/civic.auth/codeRules.ts`, `otp.ts` (`renderCodeEmail`), `verifyLink` in `civic.auth/index.ts`, `src/control/platformCodes.ts`; tables `sign_in_codes`, `platform_sign_in_codes` (`20261014000000`); UI `ui/src/components/AuthModal.tsx`, `ui/src/pages/SignInLink.tsx` |
| Terms: the notice beside Join, the creator's agreement at creation, the legal version | `ui/src/components/TermsNotice.tsx`, `ui/src/start/TermsAtCreate.tsx`, `src/shared/legal.ts`, "In short" at the top of `config/legal/{code-of-conduct,privacy,terms}.md`, `legalSummaries` in `src/services/hubDocuments.ts` |
| Rate limits (sign-in, assistant), AI limits and budget | `src/db/rateLimit.ts`, `src/shared/aiLimits.ts`, `src/services/aiBudget.ts` |
| Server-side fetches of URLs others chose (SSRF guard) | `src/utils/ssrfGuard.ts` (`guardedFetch`), `src/utils/http.ts` |
| Security headers (API, vercel.json, vite preview) | `src/shared/securityHeaders.ts` |
| Process types: each type's manifest (what it is) and handler (what it does); the one list; the startup check; adding a type | the type's package `packages/<dir>/` (`manifest.ts`, `index.ts`, `ui.tsx`; Polis: `packages/civic.polis_deliberation/boot.ts`), `config/plugins.json` (+ `npm run plugins:sync`), `src/shared/processManifests.ts`, `src/processes/manifest.ts`, `src/processes/registry.ts`; UI `ui/src/processes/` (`display.ts`, `index.ts`); ADR-009, ADR-014, `docs/PLUGIN-PACKAGE.md` |
| Plugin packages: the contract, the configured list, the loader (validation, the hash rule, mounting), the SDK, the grant at the seams, the import fence | `docs/PLUGIN-PACKAGE.md`, `packages/`, `config/plugins.json` + `npm run plugins:sync` (`scripts/plugins-sync.ts`), `src/plugins/` (`loader.ts`, `grant.ts`, `host.ts`, `mount.ts`, `mountedState.ts`, `hash.ts`), `src/sdk/index.ts`, `src/shared/pluginGrant.ts` + `pluginGrantWords.ts`, `civic/package-boundary` + `PACKAGE_REACH_NOT_YET` in `eslint.config.js`; ADR-014 |
| The plugin catalog and installs: `plugin_catalog`, `hub_plugins`, `apply_plugin_change`, the new-hub trigger, the switch-following trigger, the shipped entries; `catalog:add`, the local operator, the console's Plugins page and dashboard section; Install / Stop now / Wind down | `20261025000000`, `…0100`, `…0200`; `scripts/catalog-add.ts`, `scripts/catalog-approve-local.ts`, `scripts/catalog-shipped.ts`; `src/db/pluginCatalog.ts`, `src/db/hubPlugins.ts`, `src/control/pluginCatalog.ts`, `ui/src/console/PluginCatalog.tsx`; `src/services/pluginInstall.ts` (`finishWindDowns` from `vote_close`), `src/controllers/hubPluginsController.ts`, `ui/src/pages/settings/PluginInstall.tsx`; RUNBOOK-release.md (a package change) |
| Hub features (plugins that are not process types) | `src/shared/hubFeatures.ts` |
| The served process descriptor (§12.1), the context IRI's routing | `src/services/processDescriptor.ts`, `handleGetProcess`, `vercel.json` (`/process/:id` with a JSON-LD Accept, `/process/:id/action`) |
| Deadlines: read as closed (`readAsClosed`), closed by the job every 15 minutes, late resident actions refused (`deadlineRefusal`) | `asRead` in `src/services/processService.ts`, each deadline type's handler, `vote_close` in `src/jobs/registry.ts` |
| What each process type is (descriptor: states, actions + callers, events, tables, creation, tier), the static check, the conformance suite, the fake Polis | `src/processes/descriptor.ts`, `src/processes/descriptorCheck.ts`, `tests/conformance/` (README for plugin authors), `tests/api/conformance.test.ts`, `src/debug/fakePolis.ts` (`CIVIC_POLIS_FAKE=on`) |
| Reading more than 1,000 rows: `readAll()` (pages), `inChunks()` (long id lists); the `CIVIC_ROW_CAP` guard | `src/db/readAll.ts`, `src/db/inChunks.ts`, `cutOffAtCap` in `src/db/forHub.ts` |
| Reporting an error operators must see; it goes to the errors adapter (Sentry), scrubbed, when `CIVIC_ERROR_DSN` is set | `src/utils/reportError.ts`, `src/utils/errorTracking.ts` (scrubber, report, flush), `src/hosting/sentry.ts` (envelope, DSN); the browser's via `src/http/clientErrors.ts` and `ui/src/services/errorReporter.ts`; ADR-006, ADR-012 |
| Monitoring and alerts: Better Stack uptime + status.civic.social, Healthchecks.io heartbeats (`src/hosting/healthchecks.ts`, `npm run heartbeats:sync`), Sentry; what to do per alert, adding a hub, silencing, rotating keys | `RUNBOOK-operations.md` |
| Error responses: typed errors, the one wrapper, the response shape, what is logged and redacted | `src/errors/index.ts`, `src/http/route.ts` (`route()`, `sendError()`), `src/utils/redact.ts`; BUILD-PLAN "Error responses" |
| Environment: the one reader of `process.env` (lint-enforced in `src/` and `api/`); `env` (engine) and `hostingEnv` (vendors, the host) | `src/config/env.ts`; dev-only flags `src/config/devFlags.ts` (`CIVIC_FAKE_ADAPTERS`) |
| The engine/hosting boundary; the adapters (ai, mail, video, deliberation, errors, heartbeat, objectStore), their fakes, choosing them; adding one; the lint | `src/adapters/` (`index.ts`, `fakes/`), `src/hosting/` (`index.ts`: `installHosting`), `civic/hosting-boundary` in `eslint.config.js`, `tests/unit/{hostingBoundary,adapterFakes,adapterContracts,aiGate}.test.ts`; ADR-012 |
| AI calls: the gate (usage recorded per purpose, the jobs' daily ceiling `job_daily_tokens`, the usage-limit and job-budget reports) | `src/adapters/ai.ts`, `src/services/aiBudget.ts`, `src/shared/aiLimits.ts`, `src/hosting/anthropic.ts` |
| The database convention: a module's store (slot + host implementation), the processes table's owner, controllers through services; the lint | `src/processes/storeSlot.ts`, `src/modules/civic.*/store.ts`, `src/stores/` (`index.ts`: `installStores`), `src/services/processRows.ts`, `civic/db-convention` in `eslint.config.js`, `tests/unit/dbConvention.test.ts`; ADR-012 |
| A submission in one transaction (`submit_for_review`) | `20261024000000_submit_for_review.sql`, `submitForReview` in `src/modules/civic.review/service.ts`, `src/stores/review.ts`, `tests/api/submitForReview.test.ts` |
| Running the engine on plain Node + Postgres + PostgREST; the CI job | `RUN-ANYWHERE.md`, `scripts/run-anywhere/` (`up.sh`, `roles.sql`, `rest-proxy.mjs`, `service-key.mjs`), `run-anywhere` in `.github/workflows/ci.yml` |
| Share cards only for crawlers (`has: user-agent` on the `/api/og` rewrites) | `src/hosting/ogCrawlers.ts`, `vercel.json`, `tests/unit/ogCrawlers.test.ts` |
| What `/health` checks (503 on any failure or gap; `src/http/health.ts`, also on the console's host): tables and columns, and the database functions the code calls | `src/db/schemaContract.ts`, `src/db/functionContract.ts` (`function_catalog()`, `20261012000000`), `src/db/schemaCheck.ts`; drift test `tests/unit/functionContract.test.ts` |
| The feed's page (cursor, surface, visibility rules) | `src/services/feedPage.ts`, `src/controllers/feedController.ts`, `src/events/eventCursor.ts` |
| The feed reading the public stream: the wire-to-event table, the reader, the private facts/meta read, what stays on /api/feed (pills, hubs with sample items), the parity check | `src/shared/feedWire.ts`, `ui/src/services/wireFeed.ts`, `GET /api/feed/meta` (`handleGetFeedMeta`, `feedProcessFacts`, `processMetaFor`), hub-config `content.sample_items`; `tests/unit/feedWire.test.ts`, `tests/api/feedMeta.test.ts`, `tests/e2e/feedStream.spec.ts`; ADR-013 |
| The hub UI's conventions: data through `useApi` (its 30-second cache), the one `request()` and token store, the hub through `useHub()` (lint), lazily loaded pages, dates, the admin publication review shell, component tests | `ui/src/hooks/useApi.ts`, `ui/src/services/{http,tokenStore}.ts`, `ui/src/config/hub.ts`, `ui/eslint.config.js`, `ui/src/lazyPages.ts`, `ui/vite.config.ts` (chunk groups), `ui/src/utils/dates.ts`, `ui/src/components/AdminPublicationReview.tsx`, `ui/vitest.config.ts` + `ui/src/**/*.test.tsx`; ADR-013 |
| Before/after screenshots of the hub's pages (local only) | `tests/e2e/screenshots.spec.ts`, `tests/e2e/screenshots/` (`makeHub.ts`); TESTING.md "Frontend pass" |
| Playwright refuses a non-local base (`CIVIC_E2E_REMOTE=yes` lifts it) | `tests/setup/e2eGuard.ts`, `playwright.config.ts` |
| DB client (service role, the thing tenancy replaces) | `src/db/client.ts`; only `src/db/`, `src/control/`, `src/hosting/` (Storage), `scripts/`, `tests/` may import it (`eslint.config.js`, `civic/raw-client`) |
| Hub registry, resolver, request-scoped hub | `src/db/hubs.ts`, `src/middleware/hub.ts`, `src/config/hubContext.ts` |
| Local Supabase stack (ports, auth, seed) | `supabase/config.toml`, `supabase/seed.sql` |
| Migrations (90 files, 48 tables; `20261017000000` leaving demo (users.demo_only, waitlist.told_open_at, admin_digest_marks); `20261016000000` members and invites (hub_invites, take_member_invites); `20261015000000` feedback routing (platform_feedback); `20261014000000` sign-in codes, `20261014010000` widens the jurisdiction type check; `20261011200000` drops `start_attempts`, Adam approved; non-additive: `20260926005000`, and `20260927010000` which drops the audit log's hub FK; `20261010000000` nulls ballot times and reshuffles ballots, Adam approved; `20261011000000` rebuilds search_doc and scrubs anonymous moderation events, Adam approved; `20261011100000` deletes every session and pending code, Adam approved) | `supabase/migrations/` |
| Scheduled jobs | `src/jobs/registry.ts` (the one list; `vercel.json` checked against it, `npm run jobs:crontab`, `-- --script` for a plain cron), the jobs `src/jobs/{meetingSummary,digest,adminDigest,newsSync}.ts`, runners `src/jobs/runners.ts`, one run `src/jobs/scheduled.ts` (route and script), per-hub loop `src/jobs/runJob.ts` + `src/services/cronHubs.ts`, routes `src/routes/jobRoutes.ts`, `scripts/run-job.ts`; meeting-summary alert `src/services/cronAlerts.ts` |
| Scheduled-job run log: what each outcome means, recording, last-run route, admin digest section | `src/jobs/describe.ts`, `src/services/jobRuns.ts` (table `job_runs`, `20260929000000`), `GET /admin/hub/jobs/runs`, `src/modules/civic.admin_digest/service.ts` |
| Meeting-summary readiness (when a meeting may be summarized) and quality flags | `packages/civic.meeting_summary/readiness.ts`, `effectiveQualityFlag` in `service.ts` |
| Plugin switches at runtime | `src/services/pluginGate.ts`, `src/middleware/pluginGate.ts`, `PROCESS_TYPE_PLUGINS` in `src/processes/registry.ts`, UI `ui/src/config/plugins.tsx` + `pluginRules.ts`; admin page `ui/src/pages/settings/PluginsSection.tsx`; "needs setup" rule `src/shared/pluginSetup.ts` (served by `src/services/pluginSetup.ts`) |
| A hub's public URLs | `src/utils/baseUrl.ts` (from `hubs.hostname`; `apiOriginFor` / `uiOriginFor` for a hostname a hub had) |
| Wire identity: ids minted once on the hostname a thing began on (`events.wire_*`, `processes`/`users.wire_hostname`, stamped by trigger), the serializer reading them, the snapshot and diff scripts | `wireOrigins()` in `src/events/activitySerializer.ts`, `20261020000000_wire_origins.sql`, `scripts/wire-snapshot.ts`, `scripts/wire-snapshot-diff.ts`, `tests/unit/wireIdentity.test.ts` + `tests/fixtures/wire/before.json`; ADR-008 |
| The DID document, the move signal (tombstone, Link, Move), the software namespace | `src/events/hubIdentity.ts`, `src/controllers/didController.ts`, `sendMoved` in `src/middleware/hub.ts`, `moveHub` in `src/control/hubs.ts` (`move_hub_hostname`, `20261020010000`), `src/events/namespaceDocument.ts`, `config/ns/civic-hub.jsonld`; ADR-008 |
| Operator scripts' hub | `scripts/lib/hubScope.ts` (`--hub <slug>`, required) |
| Hub tokens, the RLS switch | `src/db/hubToken.ts`, `hubTokensEnabled()` / `getHubTokenDb()` in `src/db/client.ts`; policies `20260925000000`, catalog `tenancy_catalog()` `20260925010000` |
| Jurisdiction reference list: sources, build, load (by `release.sh` when its checksum changes); consolidated city-counties (`consolidated.csv`, type `city_county`); console picker; purge | `config/jurisdictions/SOURCES.md`, `config/jurisdictions/consolidated.csv`, `scripts/{fetch-jurisdiction-sources.sh,build-jurisdictions.ts,load-jurisdictions.ts}`, `src/control/jurisdictions.ts`, `ui/src/console/JurisdictionPicker.tsx`, `scripts/purge-hub.ts`, `scripts/lib/hubPurge.ts` |
| Backups: schedule, identities, bucket, watchdog (private repo `Mosaic-Foundation/civic-hub-backups`, local `../civic-hub-backups`); restore from them; image-backup gap | `../civic-hub-backups/README.md`, `RUNBOOK-restore-database.md`, BUILD-PLAN "Backups"; HANDOFF "Encrypted backups outside Supabase" (2026-10-05) |
| Release-1 sitting runbook (cleanup, seven migrations, code, console, wildcard, final check) — **done 2026-10-02**, see HANDOFF "Release 1 is live" | `RUNBOOK-release-1.md`; cleanup `supabase/migrations/20260926005000_post_cutover_cleanup.sql`; local branch `release-1-cleanup` |
| No-hub / paused pages (server and static shell) | `src/shared/deadEnd.ts`, `src/middleware/hub.ts`, `ui/src/main.tsx` |
| Cutover runbook, dev refresh from a prod dump, pre-switch check | `RUNBOOK-cutover.md`, `scripts/dev-refresh-from-dump.sh`, `scripts/dev-refresh-reseed.ts`, `scripts/check-tenancy.ts` |
| Leak harness, RLS catalog test | `tests/api/leakHarness.test.ts`, `leakHarnessDb.test.ts`, `rlsCatalog.test.ts`, rules in `tests/fixtures/tenancyCatalog.ts` |
| Code of Conduct check standing (fields, hash, verdict) | `src/services/codeOfConduct.ts` |
| Submit runs the check; running it; "tell the admins"; the fake check for tests | `src/controllers/draftController.ts` (`submit`), `src/services/codeOfConductCheck.ts`, `process_reviews.coc_flags` (`20261013000000`), `src/debug/fakeCodeOfConduct.ts` (`CIVIC_COC_FAKE=on`); UI `ui/src/pages/draft/DraftPage.tsx`, `ui/src/components/{DraftFooter,CocFindings}.tsx` |
| The Code of Conduct check on an invite message (Send) | `checkInviteMessage` in `src/services/hubInvites.ts`, `src/shared/inviteMessage.ts`, `ui/src/components/SharePanel.tsx` |
| Polis per hub (address read per call), the close after commit, 503 on an outage | `packages/civic.polis_deliberation/boot.ts` (`PolisUnavailableError`), `afterCommit`/`summarizeLater` in `packages/civic.polis_deliberation/handler.ts` |
| Meeting summaries' Wix column map and thresholds | `src/shared/wixFields.ts`, `daysSetting`/`todayIso` in `packages/civic.meeting_summary/readiness.ts` |
| The one modal | `ui/src/components/Modal.tsx` (every dialog in the hub and the console) |
| Running an action in the UI (one at a time, busy, error) and applying the answer's `view` | `ui/src/hooks/useAction.ts`; `viewFor` / `readAsPage` in `src/controllers/processController.ts`; a posted comment into the panel `ui/src/services/inputEvents.ts`; tab refresh `ui/src/hooks/useRefreshOnVisible.ts` |
| Close early (note, record, audit) and its line | `src/services/closeEarly.ts` (called in `attemptAction`), `src/shared/closedEarly.ts`, `DEADLINE_CLOSE_INPUT` in `src/processes/descriptor.ts`; UI `ui/src/components/CloseEarly.tsx` |
| Regenerate a brief (staged once published, history, feed card) | `src/services/briefRegenerate.ts`, `ProcessHandler.regenerateBrief`, `brief` in `src/services/feedMeta.ts`; UI `ui/src/components/BriefRegenerate.tsx` |
| Receipt check modes, the receipt file, "Your vote" | `src/shared/checkMode.ts`, `packages/civic.vote/controller.ts`, `src/shared/receiptPdf.ts`, `ui/src/services/receiptFile.ts`, `ui/src/components/ResultLabel.tsx`, `isMine` in `ui/src/services/voteReceipts.ts`; option limit and blank options (`filledOptions`) `src/shared/voteOptions.ts` |
| Results bars (one layout, live and closed), the receipt box, codes that wrap at hyphens, the ballot holding its place | `ui/src/components/ResultBars.tsx`, `receiptBox` and `ballotHold` in `ui/src/components/VotePanel.tsx`, `ui/src/components/ReceiptCode.tsx`, `ui/src/pages/VoteLog.tsx` |
| The share nudge: callout on the bar, or the one share banner (never scrolls) | `ui/src/components/shareMomentBus.ts`, `ShareButton.tsx`, `ShareBanner.tsx` (mounted in `ui/src/App.tsx`) |
| The hourly deadline close (every type with a deadline, job id still `vote_close`) | `closeAllExpired` in `src/services/processService.ts`, `vote_close` in `src/jobs/registry.ts` and `runners.ts`; conformance step 5 |
| A regenerated brief's state for its source (a conversation's summary), applied on publish | `RegeneratedBrief` in `src/processes/types.ts`, `applySourceState` / `applyOnApproval` in `src/services/briefRegenerate.ts` |
| A brief's public delivery lines ("Sent to", "Addressed to … (not emailed: …)") | `getPublicReadModel` in `packages/civic.brief/service.ts`, `ui/src/services/briefDelivery.ts` |
| Hub audit log actions | `HubAdminAuditAction` in `src/services/hubAdminAudit.ts` (now also `process.close_early`, `brief.regenerate`, `brief.revision_published`) |
| Drafts, every kind: store, kinds, controller/router factories, UI page | `src/modules/civic.drafts/`, `src/processes/draftKinds.ts`, `src/controllers/draftController.ts`, `src/routes/draftRoutes.ts`; `ui/src/pages/draft/` |
| Process writes under concurrency (version check, held events, retry-safe actions, deadline-close claim) | `src/services/processService.ts` (`executeAction`, `closeAtDeadline`), `src/services/actionScope.ts` |
| Atomic DB functions | `transition_process` (`20260924080000`; expected status/version + action events since `20261011200000`), `cast_ballot` (open-and-before-deadline since `20261011200000`), `reshuffle_ballots`, `claim_vote_key`, `ballot_by_receipt` (`20261010000000`; `cast_vote` retired), called via `src/db/atomic.ts` |
| Hub export / import / restore (bundle format, runbook) | `src/control/hubBundle/format.ts`, `scripts/export-hub.ts`, `scripts/import-hub.ts`, `scripts/restore-hub.ts`, `scripts/lib/hubImport.ts`, `RUNBOOK-restore-hub.md` |
| The Admin menu and review icon; the personal account menu; Settings → Admin log | `ui/src/components/AdminMenu.tsx`, `ui/src/hooks/useDropdownMenu.ts`, `ui/src/components/Nav.tsx`, `ui/src/pages/settings/AdminLogSection.tsx` (`GET /admin/hub/admin-log`) |
| Anchors into the admin panel (tabs, Settings sections, plugin panels), collapsed plugin cards | `src/shared/adminAnchors.ts`, `ui/src/hooks/useAnchor.ts`, `PluginCard` in `ui/src/pages/settings/PluginsSection.tsx` |
| Help "?" notes: the registry, the button, the CI check against the docs' `/help-anchors.json`; how software, docs and help stay in step | `src/shared/helpRegistry.json` + `helpRegistry.ts`, `ui/src/components/HelpButton.tsx`, `scripts/check-help-anchors.ts`; docs side in `../civic-hub-docs` (`scripts/build-help-anchors.mjs`, `scripts/propose-updates.mjs`) |
| One sample deleted; Next: set up your hub | `deleteOneSample` / `listSampleItems` in `src/services/sampleContent.ts`, `ui/src/components/DeleteSampleButton.tsx`, `ui/src/pages/settings/SampleContentSection.tsx` |
| The starter word cloud (new hubs, after sample removal, older hubs by script) | `src/services/starterWordcloud.ts`, `addStarterWordcloud` in `src/control/inHub.ts`, `scripts/add-starter-wordcloud.ts` |
| Sample content: templates, seed, removal, the row classification, the daily refresh | `src/services/sampleTemplates.ts`, `src/services/sampleSeed.ts`, `src/services/sampleContent.ts`, `src/services/sampleRefresh.ts`, `src/models/sampleContent.ts`, `scripts/seed-sample-content.ts` |
| Hub admin audit log (fresh-code actions) | `src/services/hubAdminAudit.ts`; console reader `listHubAdminAudit` in `src/control/audit.ts` |
| Members: the count and avatar stack, the Members page, hiding oneself, admins' hidden list; pattern-avatars | `src/services/members.ts`, `src/controllers/membersController.ts`, `src/routes/memberRoutes.ts`; UI `ui/src/components/{MemberStack,PatternAvatar}.tsx`, `ui/src/pages/Members.tsx`, the switch in `ui/src/pages/Settings.tsx` (`#members`), `HiddenMembers` in `ui/src/pages/settings/PeopleSection.tsx` |
| Share this hub: email invites (10 a day, 50 for an admin, never twice, beta → waitlist), the invite email and its link, the share targets | `src/services/hubInvites.ts`, `take_member_invites` + `hub_invites` (`20261016000000`), `verifyInviteLink` in `src/modules/civic.auth/index.ts`, purpose `member_invite` in `src/services/mailGuard.ts`; UI `ui/src/components/SharePanel.tsx`, `#invite=` in `ui/src/pages/SignInLink.tsx` |
| Navigation (2026-10-14): each type's pill label, icon and section in its descriptor (`display`), served as `process_types`; the one Section order and the phone's bar (first four); a switched-off plugin leaves the order | `src/shared/typeDisplay.ts`, `src/shared/navSections.ts` (`orderedSections`, `orderAfterSwitchingOff`), `processTypeDisplays` in `src/processes/registry.ts`, `nav.layout` / `nav.section_order` in `src/models/hubSettings.ts`, the switch-off rule in `src/controllers/hubSettingsController.ts` |
| Navigation in the UI: the phone's bar and More sheet, the desktop sidebar, the shared counts, the feed pill, Hub settings → Theme → Navigation and Section order | `ui/src/components/{BottomBar,MoreSheet,Sidebar,NavItemList,navIcons}.tsx`, `ui/src/hooks/useNavGroups.ts`, `ui/src/context/NavDataContext.tsx`, `ui/src/config/navigation.ts`, `.app--nav-sidebar` in `ui/src/App.css`, `--bottom-bar-space` in `BottomBar.css`, `FeedPost.tsx` (`feed-post-meta`), `ui/src/pages/settings/ThemeSection.tsx` (`NavigationFields`) |
| Navigation polish (2026-10-14): the masthead (banner photo + `HubInfo`) on Feed and About only, section pages' h1; the closable mode notice and its thin bar; the bar drawn under the More sheet; the hub's name as the sheet's first group | `BANNER_ROUTES` in `ui/src/App.tsx`, `ui/src/pages/About.tsx`, `ui/src/components/ModeNotice.tsx` (`BetaBanner`, `DemoBanner`), `BarTabs` in `BottomBar.tsx`, `MoreSheet.tsx` |
| Members plugin (2026-10-14): the threshold and the page override, decided on the server; the admin's note; the plugin card | `memberVisibility` in `src/services/members.ts`, `handleMemberSummary` / `handleListMembers` in `src/controllers/membersController.ts`, `resolveCallerIsAdmin` in `src/middleware/auth.ts`, `members` in `GET /hub-config`; UI `membersPageShown` in `ui/src/config/navigation.ts`, `MemberStack.tsx`, the `members` case in `PluginsSection.tsx` |
| Place-name CI check + allow-list | `scripts/check-place-names.ts`, `scripts/place-name-allowlist.txt` |
| Leaving demo (2026-10-15): the readiness list and the switch's consequences; the waitlist told on going live; demo-only accounts; the admin digest's tally and its mark | `src/services/modeReadiness.ts`, `handleGetModeReadiness` / `handleSetHubMode` in `src/controllers/hubModeController.ts`, `ui/src/pages/settings/ModeSection.tsx`, `src/services/waitlistOpen.ts`, `users.demo_only` in `findOrCreateVerifiedUser` (`civic.auth`), `src/modules/civic.admin_digest/` (`store.ts`), table `admin_digest_marks` (`20261017000000`), `ui/src/pages/settings/nextSteps.tsx` |
| Feedback routing: the form's question and consent, the copy to Civic.Social, Send to Civic.Social, Contact Civic.Social, the digest's mark | `ui/src/pages/Feedback.tsx`, `ui/src/services/lastPage.ts`, `src/modules/civic.feedback/service.ts` (`forwardToMosaic`, `contactMosaic`), `src/db/platformFeedback.ts` (table `platform_feedback`, `20261015000000`), `ui/src/components/ForwardToCivicSocial.tsx`, `ui/src/pages/ContactCivicSocial.tsx`, `feedbackDigestTitle` in `src/modules/civic.admin_digest/service.ts` |
| Civic.Social's feedback inbox in the console: duplicates, status back to the hub's badge, the fixed email, the issue link | `src/control/platformFeedback.ts`, `src/shared/feedbackDuplicates.ts`, `ui/src/console/FeedbackInbox.tsx`; routes `/control/feedback`, `/control/feedback/count`, `PATCH /control/feedback/:id` |
| A hub's seed values (read only by the seed script) | `config/hubs/<hub>/settings.json` |
| Ideas backlog incl. multi-tenancy section | `IDEAS.md` (lines ~137–240) |
| Multi-tenant contracts and phase checklists | `BUILD-PLAN-multi-tenant.md` |
| Future plans | `BUILD-PLAN-*.md` |

## HANDOFF.md by topic (line ranges)

### Architecture and conventions you must not break
- What a new process type gets for free, and what it must declare — 3013–3047
- Approval activates through the registry, never fails silently — 1579–1655
- One card for every process list — 1656–1711
- Process unification Parts A/B/C — 7316–7360; one deadline-close + lifecycle — 7284–7315
- Shared feed-worthiness classifier (feed ↔ digest parity) — 7246–7283
- AS2 wire conversion, Civic Activity Spec v0.2 — 6594–6843
- Spec audit; hub namespace resolves — 2010–2064
- Schema drift check (why the 08-22 outage can't recur) — 5666–5760
- Pluggable voting methods + approval voting — 7420–7484

### Security, identity, anonymity
- **Architecture 4 (2026-10-23)**: one authorization seam by account (`canActor`), roles as `hub_roles` grants from
  the people lists, eligibility behind the seam, the actor's own DID frozen at emission, `User.email` optional,
  ADR-011 — top of HANDOFF (grep the heading)
- **Sign-in slice (2026-10-14)**: lock the code not the person, three live codes, plain "Try again after" times, the
  email's Sign in link, Keep me signed in, terms without a checkbox, city-counties, `release.sh dev --yes` — top of
  HANDOFF (grep the heading)
- **Actions slice (2026-10-13)**: account ids out of action answers and reads (`accountIds.test.ts`), hub-made
  records public only once published (`hubCreatedReads.test.ts`), every action answers `{ result, view }`, Close
  early, Regenerate, receipt check modes and the receipt file, approval votes submit again — top of HANDOFF (grep
  the heading)
- **Plugin conformance (2026-10-12)**: descriptors on every type (Stage 1 checks in `executeAction` and the
  emitter), one suite for every type (`tests/conformance/`), proposals and projects on `executeAction`, approval
  as one write (no stray `created`), `POST /proposals` + `POST /projects` removed, fake Polis + Tier 3 findings —
  top of HANDOFF (grep the heading)
- **CI fix + function grants (2026-10-12)**: `events.test.ts` hidden-newest-event fix, `ensureSeedData()` checks
  its answer, `20261012100000_function_execute_grants.sql` (EXECUTE by name, nothing for anon, default privileges),
  `tests/api/functionGrants.test.ts` — top of HANDOFF (grep the heading)
- **Audit 4 (2026-10-12)**: one error answer (`src/errors/`, `route()`, `{error, code, ref}`, redacted
  `reportError`), `/health` names the database functions (`functionContract.ts`, `function_catalog()`,
  `20261012000000`), `src/config/env.ts`, CI (`npm ci`, pins, audit, type-check of tests, UI lint, `e2e.yml`),
  `RUNBOOK-release.md`; the local image's segfault on denied function calls — top of HANDOFF (grep the heading)
- **Audit 3 (2026-10-11)**: one write per action (`transition_process` expected status/version + held events),
  close once (`close_claimed_until`, one brief per source), `cast_ballot` refuses closed votes, endorsements by
  retry; one drafts system (store, kinds, factories, `DraftPage`), one review per draft; `start_attempts` dropped;
  tests `auditConcurrency`, `auditDrafts`, `drafts.spec.ts` — top of HANDOFF (grep the heading)
- **Audit 2, sign-in and abuse (2026-10-11)**: atomic code attempts (`take_*_code_attempt`), one rate
  limiter (`src/db/rateLimit.ts`, `rate_limit_take`), hashed session tokens and codes, `sessions.assurance`
  and the triggers that end demo sessions, AI limits (`src/shared/aiLimits.ts`, `src/services/aiBudget.ts`,
  console `PUT /control/hubs/:id/ai-limits`), dev flags (`src/config/devFlags.ts`), security headers
  (`src/shared/securityHeaders.ts`), `guardedFetch` (`src/utils/ssrfGuard.ts`); `20261011100000`; tests
  `auditSignIn`, `aiLimits`, `auditHardening`, `securityHeaders.spec.ts` — top of HANDOFF (grep the heading)
- **Audit 1, live exposure (2026-10-11)**: search from public text only
  (`_civic_public_search_text`, `20261011000000`), `ProcessHandler.residentActions` + `executeAction(..., caller)`,
  the Code of Conduct hash (`src/services/codeOfConduct.ts`, `coc_checked_hash`), history withheld by id
  (`isProcessHistoryServable`), settings 503 and no env roster inside a hub, `/reviews/submit` removed, account ids
  hidden from non-admins (`redactEvent` audiences); tests `auditLiveExposure.test.ts` — top of HANDOFF (grep the heading)
- **Ballot secrecy against the raw data (2026-10-10)**: voter-held receipts
  (`cast_ballot`, change key hash, `ui/src/services/voteReceipts.ts`), no
  ballot time (`vote_records_no_time`), `reshuffle_ballots` at close and
  hourly, early voters' `claim-receipt`, POST verify, the retired bridge;
  tests `ballotSecrecy*.test.ts`, `tests/fixtures/ballotSecrecyRules.ts`;
  report in Mosaic Foundation Management — top of HANDOFF (grep the heading)
- Launch-critical security hardening (audit punch-list) — 6961–7045
- Identity & anonymity: ballot secrecy, real names, opt-in anonymous comments — 7046–7092
- Public anonymity: names hidden from signed-out viewers — 3584–3719
- Read paths stop trusting `?actor=` — 5838–5883
- Polis JWT auth — 7206–7245; Polis leaked token / wedged conversation — 1740–1831

### Multi-tenancy (the `multi-tenant` branch)
- **Invite codes and the start page (2026-10-08, session 4b)**: entitlements
  (`src/control/entitlements.ts`), the console's Invite codes tab, the start
  page on `CIVIC_START_HOSTNAME` (`src/control/startRouter.ts`,
  `startAuth.ts`, `ui/src/start/`), the handoff session
  (`createHandoffSession`, `POST /auth/handoff`), DB rate limits
  (`start_attempts`), `20261008010000` — top of HANDOFF (grep the heading)
- **Architecture 2 (2026-10-21)**: the process manifest as the single source, derived lists, the feature split, the
  served descriptor, reads that never close, the UI registry, ADR-009 — top of HANDOFF (grep the heading)
- **Architecture 1 (2026-10-20)**: ids frozen at insert, `/.well-known/did.json`, one `hub:` namespace, the move
  signal, the standing rules in BUILD-PLAN, ADR-008 — top of HANDOFF (grep the heading)
- **Handing a hub over (2026-10-08, session 4)**: ownership at create, the
  console's Handover panel (`PUT /control/hubs/:id/handover`), who writes
  which setting (`src/shared/settingOwners.ts`), renames carry, the admin
  invite (`src/services/adminInvite.ts`), `plugin.feedback.contact_email`,
  moved addresses redirect (`hubs.previous_hostnames`, `20261008000000`) —
  top of HANDOFF (grep the heading)
- **Demo hubs stay current, every kind, visitors' submissions (2026-10-07, sixth
  part, session 3b)**: `src/services/sampleRefresh.ts`, the `sample_refresh`
  job, console "Refresh samples", school/organization/issue sample sets,
  `sample_minutes`, `added_in_demo` + the `review_turns` guard
  (`20261007000000`), demo publishing after the CoC check
  (`draftPassedCodeOfConduct`, `CHECK_UNAVAILABLE_RESULT`), removal counts —
  top of HANDOFF (grep the heading)
- **Every word fits the hub (2026-10-07, fifth part, session 3a)**: legal
  placeholders and `draft_notes`, `src/shared/hubCopy.ts` (defaults by kind,
  `theName()`, `briefPillFor`), `copy.welcome_strip*` / `copy.beta_banner`,
  `copy.resident_noun` wired, demo sign-in `no_email`, sign-up `&return=`,
  `fitSlug()`, the extended place-name check — top of HANDOFF (grep the heading)
- **No read stops at 1,000 rows (2026-10-07, fourth part)**: feed paged on
  the server (`src/services/feedPage.ts`, `next_cursor`, `surface`,
  `FEED_EVENT_TYPES`), `getAllEvents` gone, `getModerationEvents`,
  `getResultPublications`, `readAll()` / `inChunks()` in `src/db/`, the
  `CIVIC_ROW_CAP` guard in `forHub()`, ballots paged — top of HANDOFF (grep
  the heading)
- **Votes finish on their own; quiet meeting source (2026-10-07, third
  part)**: finalize at close, `results_at_close`, card kind `vote-closed`,
  "Vote brief" pill, `SOURCE_QUIET_DAYS` 45, `getEventsSince` paged,
  `scripts/finish-stuck-votes.ts` — top of
  HANDOFF (grep the heading)
- **Held back is not failed; jobs report real problems (2026-10-07, second
  session)**: `src/shared/delivery.ts`, mailer report, `held_back` on briefs and
  vote results, digest `held_back_count`, feed health ignores archived and
  missing, `broken_links` list, archived summaries in dedupe, empty discovery
  "Nothing new", sign-in codes pass the guard, votes finalize at close with
  Briefs off, admin digest reviews + briefs — top of HANDOFF (grep the heading)
- **Plugin switches, end to end (2026-10-07)**: Settings save re-renders the
  admin's page (`refreshHubConfig`), CoC check outside the assistant gate,
  search / links / digest / discovery / reviews respect a switched-off type,
  "needs setup" (`src/shared/pluginSetup.ts`, `plugin_setup` in
  `/hub-config`) — top of HANDOFF (grep the heading)
- **Non-place legal text, Adam's three changes (2026-09-27, third part)**:
  `legal.governing_state`, people not residents, the complaint line — 7–42
- **Jurisdiction data, the jurisdiction code, hub kinds (2026-09-27, second
  part)**: the committed list and confirmed OCD formats, the code rule and
  `defaultJurisdiction()`, `identity.hub_kind` and every fallback changed, the
  six-migration rehearsal — 43–163
- **Jurisdictions, plugins at creation, purge, platform postal address
  (2026-09-27)**: the `jurisdictions` table and loader, the console picker
  and slug suggestion, `scripts/purge-hub.ts`, `CIVIC_PLATFORM_POSTAL_ADDRESS`,
  the jurisdiction-code inventory and recommendation, the
  `CIVIC_JURISDICTION` finding — 164–288
- **Release-1 prep (2026-09-27)**: no-hub page from the static shell,
  `seedBetaSlate.ts` retired, the cleanup migration tested on production's
  data, `RUNBOOK-release-1.md`, the two decisions (stale votes, sender) —
  7–~111 (every range below shifts down by its length)
- **Dev on `*.dev.civic.social` (2026-09-27)**: console
  `console.dev.civic.social`, hubs `<slug>.dev.civic.social`, how it was set
  up (`DEPLOY-dev.md` §9), the corrected wildcard method — 7–~55
- **Phase 7 part one (2026-09-26): sample content for new hubs**
  (`src/services/sampleSeed.ts`, `sampleTemplates.ts`, `sampleContent.ts`,
  `src/models/sampleContent.ts`, `scripts/seed-sample-content.ts`,
  `hub_admin_audit_log`, `is_sample`, the events delete guard) — 7–~150
  (every range below shifts down by its length)
- **Phase 5 part two (2026-09-26): per-hub export, import, restore**
  (`scripts/export-hub.ts`, `import-hub.ts`, `restore-hub.ts`,
  `src/control/hubBundle/`, `RUNBOOK-restore-hub.md`), console export +
  sweep, platform jobs, deadline-stamped closes, `vote_close`,
  `events.recorded_at` — 7–~130 (every range below shifts down by its length)
- **Phase 5 part one (2026-09-26): the super admin** (`src/control/`,
  `ui/src/console/`, console hostname, one operator, step-up, audit log,
  archive, reserved slugs, create guard; step 9 on dev pending Adam) and
  **step 0** (vote_drafts trigger, beta drawer + `hubs.mode` in the UI,
  Playwright green, plugin-off behaviour) — 7–~230 (every range below
  shifts down by its length)
- **Floyd cutover (2026-09-25/26): production on `multi-tenant`, hub tokens
  on**, timings, rollback target, walk, findings — 7–~75 (every range below
  shifts down by its length)
- Phase 4 part one: cutover runbook (`RUNBOOK-cutover.md`) rehearsed on dev
  against production's data — empty prod migration history, `[SENSITIVE]`
  seed guard, ES256 + `sb_secret_`, uploads on the hub token,
  `check-tenancy.ts`, rollback (settings index), parity with production —
  7–~140 (every range below shifts down by its length)
- Phase 3: forced RLS from one template, minted hub token behind
  `CIVIC_HUB_MINTED_TOKEN`, leak harness (both modes), catalog test, CI twice,
  dev migrated + checked with the flag on locally — 7–~150 (every range
  below shifts down by its length)
- Phase 2c: jobs per hub from one registry, digest in the hub's time zone,
  plugin toggles at runtime + Settings → Plugins, base URL per hub, `--hub`
  scripts, bucket migration + guarded grants, `transition_process` /
  `cast_vote`, the dev cron check, notes for Phase 3 — 7–~208 (every range
  below shifts down by its length)
- Phase 2b: composite (hub_id, x_id) foreign keys (rehearsed), the last 31
  files onto forHub(), storage keys under <hub_id>/, the civic/raw-client
  lint rule, isolation suites for every converted endpoint, notes for 2c —
  7–~190 (every range below shifts down by its length)
- Phase 2a: hub_id on every table, protocol_hub_id, forHub() (rows and
  throw), sign-in/feed/receipts converted, exit-rights items, dev backfill
  repair — 7–~131 (every range below shifts down by its length)
- Hub theming: Settings → Theme, `src/shared/theme.ts`, presets, contrast
  auto-adjust, live preview — 7–66 (every range below shifts by its length)
- Phase 1 part five: hub admin Settings page (one endpoint, eight sections,
  document restore-default, hub image prefix, logo/theme) — 68–~250 (every
  range below this entry shifts down by its length)
- Phase 1 part four: backend place-name sweep, news_sync connector, crons per
  hub, assistant reads hub documents, CI place-name check — 7–139 (every
  range below this entry shifts down by its length)
- Phase 1 part three: legal pages per hub, real sender, dev safety, admin
  roster — 7–188 (line numbers below this entry are its length out of date)
- Login hardening, generic proposal guide, dev deploy prep — 7–110
- Phase 1 part two: per-hub settings, hubs.mode, shared legal documents — 111–256
- Phase 1 part one: hubs table, hostname resolver, /api/hub-config, UI — 153–282
- Phase 0: prep, contracts, and the token spike — 283–399. Contracts live in
  `BUILD-PLAN-multi-tenant.md`; decisions in `../decisions/2026-09-22-multi-tenant.md`.

### Config, settings, per-hub things (most relevant to multi-tenancy)
- Multi-deployment + demo-hub.civic.social launch, and the "Multi-tenant SaaS path" note — 8384–8616 (note at ~8602)
- Officials: admin-managed role with structured title — 4586–4749
- Admin-editable announcement authors — 10059–10148; brief recipients — 10333–10368
- Settings tab (admin IA) — 10015–10058; Admin Settings one section — 381–411
- Endorsement threshold wired to Admin Settings — 727–770
- Beta gating + digest frequency — 7719–7771; beta banners, landing, welcome dialog — 3416–3583
- Waitlist (opt-in, name, outage) — 5761–5837, 5956–6064
- Legal docs + minimal moderation — 9069–9218; legal-page dialog gate — 3416–3460
- Onboarding copy — 7093–7125; Welcome page — 8208–8253

### Plugins / process types (each has Floyd-specific config to move)
- Meeting summaries: missing timestamps (09-22 cause), readiness rule, flagged summaries, job run log + admin digest — top of HANDOFF, 2026-09-29 (~lines 7–133)
- Meeting summaries: silent discovery failure + connector ladder — 6065–6593; original slice — 9658–9846
- Floyd news auto-sync — 8725–8897
- Daily email digest — 9847–10014; admin digest / feedback in digest — 4750–4898
- Board announcements — 10149–10246; publication receipts — 4511–4585
- Civic Brief generation + approval — 10369–10519; official responses — 4384–4510; brief delivery via Resend — 354–380
- Projects module — 7772–7893; project editing/history — 2585–2771; comments on shared module — 489–556
- Proposals: AI-augmented process — 8115–8207; commenting — 8344–8383
- Votes: vote module — 7955–8033; auto-close — 7701–7718; change vote while open — 8294–8343
- Word cloud — 7631–7700, 7598–7630, 7582–7597; density measured — 1949–2009
- Conversations (Polis) join the flow — 3847–3929; sources + seed statements — 3793–3846
- Assistant (all process types): one creation flow — 3930–4049; tool-call validation — 1074–1121; suggestion cards — 1122–1185
- Search — 9219–9264; Feedback — 8665–8724, 107–146, and "Feedback routing" (2026-10-13, top of the file); Share — 8617–8664, 1509–1578
- Light process-linking — 5002–5665

### Operations
- **Local stack hygiene (2026-10-24)**: `scripts/local-stack.sh` (start, reset to the fixture set, stop before every
  handoff, status), test runs deleting the hubs they create, the smoke suite running every check — top of HANDOFF
  (grep the heading)
- SHIPPED to production — 3720–3735; Production readiness — 10752–10848
- Vercel builds: npm ci — 2772–2804
- Test infrastructure + cron route fix — 8254–8293
- Beta demo content slate seeded on PROD — 3262–3415
- Session close, beta smoke test day 1 — 2536–2569

### Reference sections at the bottom (older, partly stale)
- Component status snapshot — 10849–11141
- Proposal → vote pipeline — 11142–11186
- Authentication & participation gating — 11187–11218
- Assumptions, open questions, suggested next tasks — 11237–11304

### Everything else
Lines 7–2535 are UI polish and fixes from 2026-09-04 to 09-08, one entry each.
Grep the heading text if a session touches that surface.
