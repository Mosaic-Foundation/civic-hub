# TESTING.md — Civic Hub Test Coverage Tracker

Updated alongside HANDOFF.md after every session that adds or modifies features.

---

## Testing Principles

1. **Tests ship with the feature.** Every slice that adds or changes user-facing behavior must include corresponding tests before the slice is considered complete.
2. **Test behavior, not implementation.** Tests describe what a resident or admin experiences. They should survive refactors and only break when something is actually wrong.
3. **One flow per test, with a clear name.** Test names read like sentences: `"resident can cast a vote on an active process"`. When a test fails, the name alone tells you what's broken.
4. **Cover the sad paths.** Voting on a closed process, submitting with missing fields, double-voting, hitting admin routes without auth — these are the bugs that slip past visual checks.
5. **Seed data is infrastructure.** Deterministic fixtures shared across API and E2E tests. Treat them like code.

---

## Quick Start

```bash
cd civic-hub

# Local database — brings up Postgres + PostgREST and applies every
# migration. Needed by the API and E2E layers; the unit layer does not
# use it. Added 2026-09-22 with supabase/config.toml.
supabase start

# API integration tests (requires dev server running on :3000)
npm run test

# E2E browser tests (auto-starts backend + frontend if not running)
npm run test:e2e

# E2E with visible browser
npm run test:e2e:headed

# E2E with Playwright UI mode (interactive)
npm run test:e2e:ui

# Watch mode for API tests during development
npm run test:watch

# Tear the local database down (--no-backup discards its data)
supabase stop
```

Point the dev server at the local stack rather than at a hosted project
before running the API or E2E layers. `supabase start` prints the URL and
keys to use for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; everything
else can stay as it is in `.env.example`. As of 2026-09-22 all 8 API test
files (68 tests) pass against a stack brought up this way, which is the
first time that layer has been runnable from a clean checkout.

---

## Three Test Layers

### API Integration Tests (Vitest)
Hit the Express backend directly via fetch, no browser. Fast, high coverage.

- **Location:** `civic-hub/tests/api/`
- **Run:** `npm run test`
- **Config:** `civic-hub/vitest.config.ts`
- **Helpers:** `civic-hub/tests/fixtures/helpers.ts`
- **Covers:** process CRUD, event feed, auth flow, proposals, search, health/discovery, cron endpoints, deliberation routes
- **Multi-tenant suites (Phase 2):** hub isolation (`hubIsolation*.test.ts`,
  `forHubIsolation.test.ts`); and from Phase 2c: `pluginToggles.test.ts` (a
  plugin switched off on Athens: routes 404, no create/read/list, job skipped,
  Floyd unaffected, back on restores), `hubBaseUrl.test.ts` (a stored event
  carries its own hub's origin), `atomicFunctions.test.ts` (`cast_vote` and
  `transition_process` leave nothing behind on a forced mid-function failure
  and refuse another hub's rows), and the per-hub runs in `crons.test.ts`.
- **Phase 3 leak harness (2026-09-25).** Two files, and they are meant to run
  **twice: once against a server with `CIVIC_HUB_MINTED_TOKEN` off and once
  with it on** (CI does both, below).
  - `leakHarness.test.ts` gives Floyd one of everything (vote + ballot +
    comment, word cloud + response, proposal + support, project + sentiment,
    review, four drafts, outcome, conversation, meeting summary, announcement
    with an image, process link, feedback, waitlist entry, cached link
    preview, a subscribed resident, three settings), each carrying a marker.
    Then, as Athens, it calls **every GET route the Express app mounts** —
    the list is read from `app._router`, so a new route fails
    "every GET route has a plan" until it is added to `GET_PLAN` or skipped
    with a reason — signed out, as a resident and as an admin, with each of
    Floyd's ids in every `:id`; tries **every mutating route that names an
    id** (`WRITE_PLAN`, same rule) and the routes that take ids in the body;
    and runs **Athens's digest in-process** (mail captured by mocking
    `src/utils/email.ts`). Each response must contain no marker, no Floyd id
    but the one the caller sent, and no `post-images/` URL outside
    `athens/`; Floyd's rows are snapshotted and must be unchanged afterwards.
    It reads the server's mode from `/health` (`hub_db.mode`);
    `CIVIC_EXPECT_HUB_DB_MODE=hub_token|service_role` fails the run if the
    server is not in the mode it was meant to be. The digest-unsubscribe walk
    needs the server's `DIGEST_UNSUBSCRIBE_SECRET` to equal
    `CIVIC_TEST_DIGEST_SECRET` (both default to
    `ci-only-digest-unsubscribe-secret` in CI).
    *Checked by mutation 2026-09-25:* with `forHub()`'s filter removed from
    `processes` reads, the flag-off run fails (Floyd's marker and ids leak,
    cross-hub writes land) and the flag-on run passes — the database alone
    held.
  - `leakHarnessDb.test.ts` — hub tokens straight at PostgREST, no app:
    every hub table shows a token no other hub's row; inserts naming another
    hub are refused with 42501; updates/deletes of another hub's rows touch
    nothing; a row cannot be moved across hubs; a claim-less token sees
    nothing, anon nothing, a forged token 401; `transition_process` /
    `cast_vote` on another hub's process get P0002 (it is invisible to the
    token), their event helper 42501; and **for each atomic function a
    forced failure under the minted token (a duplicate event id, the last
    write) leaves no ballot, participation, bridge, status, state or event**.
    Signs with `CIVIC_HUB_SIGNING_KEY` if set, else the local stack's fixed
    HS256 secret; independent of the server's flag.
    **Storage (added 2026-09-25, Phase 4 part one):** straight at the
    Storage API with the same tokens, Athens cannot upload under `floyd/`
    or at the bucket root (policy refusal, nothing stored), a claim-less
    token cannot upload anywhere, and Athens can upload under `athens/`
    (the control) which Floyd's token cannot delete. *Checked by mutation:*
    with `post_images_hub_insert` loosened to the bucket alone, the three
    refusal cases fail. Needs Storage on in the local stack — **it is on
    since 2026-09-25** (`[storage] enabled = true` in `supabase/config.toml`;
    the first `supabase start` after that pulls the storage image, and a
    `supabase db reset` makes the bucket migration create the bucket and its
    four policies).
  - `uploadHubPrefix.test.ts` (2026-09-25) — an image upload through the app
    (`POST /upload/hub-image?kind=logo`, as each hub's admin) lands under
    that hub's `<hub>/identity/` prefix and is publicly readable. Runs in
    both CI passes: flag off it is the service role and the prefix; flag on
    it is the hub token, and the storage policies above are the enforcement.
- **Phase 3 catalog test (2026-09-25):** `rlsCatalog.test.ts` reads
  `tenancy_catalog()` (a service-role-only SQL function, `20260925010000`)
  and fails, naming the table and what it lacks, unless every table in
  `public` has `hub_id`, RLS enabled and FORCEd, exactly the one
  `hub_isolation` policy the template writes (FOR ALL, `authenticated`,
  USING and WITH CHECK both the template expression), and an index leading
  with `hub_id`. `hubs` is the one exemption (`NOT_HUB_SCOPED` in
  `tests/fixtures/tenancyCatalog.ts`), and must stay deny-all. It also
  asserts that `HUB_TABLES` in `src/db/forHub.ts` equals the hub-scoped set
  and that the four `post_images_hub_*` storage policies exist where storage
  does. The rules are a pure function, so `tests/unit/tenancyCatalog.test.ts`
  proves they fail on a table added without them (and a real unpoliced
  table in the local stack was confirmed to fail the API test).
- **Pre-switch check (2026-09-25):** `npm run check:tenancy`
  (`scripts/check-tenancy.ts`) applies the same catalog rules as
  `rlsCatalog.test.ts` to any database — `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY`, or `PROD_*` from `.env.prod` with `--prod` —
  and prints CLEAN (exit 0) or names each offending table (exit 1). It is
  the step right before tokens are turned on in RUNBOOK-cutover.md.
  Unlike the test, it also fails when there is no storage schema to check.
- **Digest recipients before cutover (2026-09-25):**
  `scripts/check-digest-recipients.ts --hub <slug>` runs a hub's digest
  subscribers through the real beta mail guard, in the hub's scope, and exits
  1 naming anyone it would withhold; `--pre-cutover` does the same on a
  database that has no `hubs` table yet (production before the migrations),
  from `CIVIC_ADMIN_EMAILS` and the `beta_allowlist` row. Both modes agreed
  on production's data: 28 subscribers, 3 withheld. It is two steps of
  RUNBOOK-cutover.md (1a½ and 2e.5). Read-only.
- **Cron secret in tests:** the per-hub cron tests send `ci-only-cron-secret`
  (CI's value); a local server started with another sets
  `CIVIC_TEST_CRON_SECRET`.
- **Server port:** `tests/fixtures/helpers.ts` reads `CIVIC_API_BASE`, e.g.
  `CIVIC_API_BASE=http://localhost:3400 npm test` against a server on :3400.
- **Running the API layer with minted tokens locally:** start a second server
  with `CIVIC_HUB_MINTED_TOKEN=true`,
  `CIVIC_HUB_SIGNING_KEY=super-secret-jwt-token-with-at-least-32-characters-long`
  (the CLI's fixed local secret) and
  `SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from supabase status>`, then
  `CIVIC_EXPECT_HUB_DB_MODE=hub_token CIVIC_API_BASE=http://localhost:<port> npx vitest run tests/api`.
  As of 2026-09-25 (Phase 4 part one) the whole layer passes in both modes
  (24 files, 223 tests, 5 skipped). The first flag-off run straight after a
  fresh `supabase db reset` + seed failed three files (hubAdminSettings,
  pluginToggles, leakHarness) and passed on rerun without changes — a
  settings cache on a server started before the seed; restart the server
  after seeding.

> **Update 2026-09-24:** CI now runs this layer too — the `api-tests` job in
> `.github/workflows/ci.yml` starts the Supabase local stack, seeds both hubs
> and runs `tests/api` against a server. The note below is the history.
>
> **Why so much linking logic is pure.** CI runs ONLY the unit layer — it has
> no database and no server, and the app talks exclusively through
> `supabase-js`/PostgREST, so a bare Postgres container cannot stand in for it.
> Rather than write integration tests nothing would run, the linking slice
> extracted its *decisions* (`canEditLinks`, `canRemoveLink`,
> `edgeBelongsToProcess`, `isRemovableLink`) into pure functions the existing
> CI already guards, leaving one-line wiring behind. Making integration tests
> run on push is NOT done — **read "Running integration tests in CI" at the
> bottom of this file before writing anything in `tests/api/`, or you will
> write a test nothing executes.**

### Unit Tests (Vitest, infrastructure-free)
Pure functions only — no database, no server, no network. **This is the layer CI
runs on every push**, alongside `tsc` and a real UI build.

- **Location:** `civic-hub/tests/unit/`
- **Run:** `npx vitest run tests/unit`
- **Covers:** lifecycle transitions, voting methods, the wordlist filter, feed
  classification, the activity serializer's golden documents, schema-contract
  classification, process-link edge storage and both-direction rendering
- **Phase 2c:** `jobRegistry.test.ts` (vercel.json's crons equal the job
  registry; every job has a runner and a route), `jobsPerHub.test.ts` (the
  digest's send hour in each hub's time zone, plugin skips, per-hub admin
  recipients, one hub's failure isolated), `pluginGate.test.ts`,
  `hubBaseUrl.test.ts`, `portability.test.ts` (every GRANT to a Supabase role
  is guarded; the bucket migration; generic deployment variables)
- **Phase 3:** `hubToken.test.ts` (every hub token has `role:
  authenticated` and its `hub_id`, 60 s; ES256 verifies with the public key,
  HS256 from a secret or `oct` JWK; bad keys refused without echoing them;
  per-hub caching at half-life; the `CIVIC_HUB_MINTED_TOKEN` switch is read
  per call, defaults off, fails loudly without a key; scripts pinned to the
  service role), `tenancyCatalog.test.ts` (the catalog rules above fail on
  a table with no hub_id, policy, FORCE or hub-leading index, on a policy
  that differs from the template, and on any extra policy)

- **KNOW WHAT THIS LAYER CANNOT SEE.** It is blind to everything at the seam
  between a pure module and the world. During the 2026-08-25 process-linking
  slice, six bugs survived a fully green unit suite and were caught only by
  running against a real database and a real browser:
  an admin permission check reading `res.locals` on a route with no auth
  middleware; a title leaking onto the permanent AS2 wire; a Postgres query
  that ANDed terms where the code assumed OR (which silently disabled a whole
  feature); a zero-pixel CSS margin collision; and two more.
  **Green unit tests are not evidence that a slice works.** Budget a
  real-environment pass on anything touching HTTP, SQL, or layout.

### E2E User Flow Tests (Playwright)
Open the real UI in Chromium and simulate resident interactions.

- **Location:** `civic-hub/tests/e2e/`
- **Run:** `npm run test:e2e`
- **Config:** `civic-hub/playwright.config.ts`
- **Covers:** critical user journeys — navigation, feed, votes, search, conversations
- **Note:** Each test dismisses the intro popup via localStorage before running.
- **Known failures (2026-09-25):** 6 of 23 fail on the pre-Phase-2c code as
  well as after it — `ux-polish.spec.ts` (tab strip order, three not-found
  back links, the welcome-banner title pattern) and `votes.spec.ts`
  (suggest-a-vote card). Their expectations predate later UI changes; they
  are not multi-tenant regressions. Checked by running both commits against
  the same local stack.
  Same six, and no others, on 2026-09-25 with minted hub tokens ON (API on
  :3000 with `CIVIC_HUB_MINTED_TOKEN=true` against the local stack, Storage
  on): 17 passed, 6 failed, 92 s.
- **Signed-out parity against production (2026-09-25, Phase 4 part one):**
  with dev holding a fresh copy of production's data, the same signed-out
  API reads were hashed on dev (`multi-tenant`, tokens on) and production
  (`main`) with hostnames normalised. Six process pages, proposals and the
  404s: byte-identical. `/api/process` and search: the same items, some
  ties ordered differently. `/api/feed` (502 events + `process_meta`):
  identical once `anon-…` pseudonyms are masked — those differ only because
  each deployment has its own `CIVIC_ANON_SECRET`. The browser snippet is in
  RUNBOOK-cutover.md → "Verification"; reuse it after any data refresh.
- **Run against the local stack, not `.env`:** the config's `webServer` runs
  `npm run dev`, which reads `.env` (the hosted dev project). Start an API on
  :3000 with the local stack's URL and key first; Playwright reuses it.

---

## Flow Coverage Inventory

Each row tracks a user flow, which layer covers it, and which slice introduced it.

### Resident Flows

| Flow | API | E2E | Slice | Notes |
|------|-----|-----|-------|-------|
| View feed (announcements + events) | | :white_check_mark: | — | feed.spec.ts |
| Filter feed by type (All / Announcements / Votes) | | :white_check_mark: | — | feed.spec.ts (filter pills visible) |
| Navigate Feed <-> Votes via tab strip | | :white_check_mark: | 12.1 | navigation.spec.ts |
| Hamburger drawer shows all nav links | | :white_check_mark: | 12.3 | navigation.spec.ts |
| Click feed item to detail page | | :white_check_mark: | — | feed.spec.ts |
| View active vote details | | :white_check_mark: | — | votes.spec.ts (click card -> process) |
| Cast a vote on an active process | | | — | Needs test (requires auth in E2E) |
| Vote on a closed process (should fail) | | | — | Sad path — needs test |
| Double-vote prevention | | | — | Sad path — needs test |
| Submit a proposal | :white_check_mark: | | — | proposals.test.ts |
| View proposal detail | :white_check_mark: | | — | proposals.test.ts |
| Proposal requires auth | :white_check_mark: | | — | proposals.test.ts |
| Proposal requires residency | :white_check_mark: | | — | proposals.test.ts |
| View vote results | | | — | Needs test |
| View vote log | | | — | Needs test |
| Search processes and announcements | :white_check_mark: | :white_check_mark: | 10.5 | search.test.ts + search.spec.ts |
| View announcement detail | | | — | Needs test |
| View meeting summary | | | — | Needs test |
| Settings page renders | | | — | Needs test |
| Legal pages render (Privacy, Terms, CoC) | | :white_check_mark: | — | navigation.spec.ts |
| Feedback submission | | | — | Needs test |
| Intro popup shows on first visit | | | — | Needs test |
| Suggest-a-vote CTA visible on /votes | | :white_check_mark: | — | votes.spec.ts |
| Wordmark links to home | | :white_check_mark: | — | navigation.spec.ts |
| Mobile: sticky chrome (nav + tabs + pills) | | | 12.3 | Needs test (mobile viewport) |
| Mobile: image thumbnail layout | | | 12.3 | Needs test (mobile viewport) |
| Vote drafting: /votes/new renders path choice | | | A | Needs test |
| Vote drafting: brainstorm flow sends assistant message | | | A | Needs test |
| Vote drafting: form shows title, description, sources, duration | | | A | Needs test |
| Vote drafting: duration picker changes voting window | | | A | Needs test |
| Vote drafting: review triggers CoC check | | | A | Needs test |
| Vote drafting: submit creates + auto-activates vote | | | A | Needs test |
| Vote drafting: submit redirects to /process/:id | | | A | Needs test |
| /propose listing page shows proposals + CTA | | | B | Needs test |
| /propose/new renders path choice (brainstorm / write) | | | B | Needs test |
| Propose drafting: idea/concern toggle switches placeholders | | | B | Needs test |
| Propose drafting: form shows title, description, sources (no considerations) | | | B | Needs test |
| Propose drafting: review triggers CoC check | | | B | Needs test |
| Propose drafting: submit redirects to /propose | | | B | Needs test |
| Proposal detail: support button increments count, status stays open | | | B | Needs test |
| Proposal detail: no endorsement progress bar | | | B | Needs test |
| Proposals removed from Votes page listing | | | B | Needs test |
| Existing endorsed/converted proposals display with historical status | | | B | Needs test |
| Feed: generic fallback renders unknown event types | | | A | Needs test |
| /projects listing page shows projects + CTA | | | C | Needs test |
| /projects/new renders path choice (brainstorm / write) | | | C | Needs test |
| Project drafting: form shows title, description, sources | | | C | Needs test |
| Project drafting: brainstorm flow sends assistant message | | | C | Needs test |
| Project drafting: review triggers CoC check | | | C | Needs test |
| Project drafting: submit creates project + redirects | | | C | Needs test |
| /project/:id detail page: description, sentiment, updates, comments | | | C | Needs test |
| Sentiment: support/oppose toggles, changeable | | | C | Needs test |
| Sentiment: neutral resets user's selection | | | C | Needs test |
| Comments: add comment (resident only) | | | C | Needs test |
| Updates: creator posts update, shows in timeline | | | C | Needs test |
| Updates: non-creator cannot post updates | | | C | Needs test |
| Feed: project events render with correct pills | | | C | Needs test |
| Feed: project comment/sentiment events suppressed | | | C | Needs test |
| Projects tab visible in FeedVotesTabs | | | C | Needs test |
| Projects link visible in nav drawer | | | C | Needs test |
| Project drafting: banner image picker visible with suggestion note | | | C | Needs test |
| Project drafting: banner image upload persists to draft | | | C | Needs test |
| Project drafting: banner image carries through to submitted project | | | C | Needs test |
| /project/:id displays banner image when present | | | C | Needs test |
| Conversations tab visible in FeedVotesTabs | | | D | Needs test |
| Conversations link visible in nav drawer | | | D | Needs test |
| /deliberations page renders with CTA card | | | D | Needs test |
| CTA card says "Community Conversations" with description | | | D | Needs test |
| Admin sees "+ Create a conversation" button on CTA | | | D | Needs test |
| Active conversations section lists active deliberations | | | D | Needs test |
| Active deliberation shows Participate and Opinion Groups tabs | | | D | Needs test |
| Participate tab shows statement card with vote controls | | | D | Needs test |
| Participate tab requires authentication (requireResident) | | | D | Needs test |
| Vote on statement (agree/disagree/pass) updates UI | | | D | Needs test |
| Submit new statement appears in conversation | | | D | Needs test |
| Opinion Groups tab shows cluster cards | | | D | Needs test |
| Completed deliberation shows summary with stats | | | D | Needs test |
| Completed deliberation shows consensus statements | | | D | Needs test |
| Completed deliberation shows opinion groups | | | D | Needs test |
| Draft conversations visible to admin only | | | D | Needs test |
| Admin can start a draft conversation | | | D | Needs test |
| Host form titled "Host a conversation" | | | D | Needs test |
| Mock data serves statements for seed- conversations | | | D | Needs test |
| Mock data serves cluster state for seed- conversations | | | D | Needs test |
| Word cloud: SVG defers render until container measured | | | E | Needs test |
| Word cloud: submit form hidden for returning users | | | E | Needs test |
| Word cloud: accordion chevron toggles open/closed | | | E | Needs test |
| Auth: token preserved on transient network errors | | | E | Needs test |
| Auth: token cleared on 401/403 only | | | E | Needs test |
| Compact CTA: Propose page shows inline header + button | | | E | Needs test |
| Compact CTA: Votes page shows inline header + button | | | E | Needs test |
| Compact CTA: Projects page shows inline header + button | | | E | Needs test |
| Compact CTA: Conversations page shows inline header + button | | | E | Needs test |
| Feed tab has vertical divider separator | | | E | Needs test |
| Sub-pages scroll to nav on load (not Feed) | | | E | Needs test — not yet working |

### Admin Flows

| Flow | API | E2E | Slice | Notes |
|------|-----|-----|-------|-------|
| Admin: approve/reject proposal | | | — | Needs test |
| Admin: publish vote results | | | — | Needs test |
| Admin: manage meeting summaries | | | — | Needs test |
| Admin: moderation actions | | | — | Needs test |
| Admin: hub settings | | | — | Needs test |
| Admin: post announcement | | | — | Needs test |
| Admin: create conversation (POST /deliberations) | | | D | Needs test |
| Admin: start conversation (POST /deliberations/:id/start) | | | D | Needs test |
| Admin: close conversation (POST /deliberations/:id/close) | | | D | Needs test |
| Admin: regenerate summary (POST /deliberations/:id/regenerate-summary) | | | D | Needs test |

### Process Linking Flows (Slice: linking, 2026-08-25)

Marked honestly: `unit` means pure-logic coverage only. Flows verified by hand
against dev/prod but not automated say so — that is a real gap, not a formality.

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Edge stored exactly once; no inverse row written | :white_check_mark: unit | | processLinks.test.ts |
| Both-direction render: one edge → outgoing one end, incoming the other | :white_check_mark: unit | | same link id from both ends |
| Inverse label correct for every relation | :white_check_mark: unit | | |
| Relation vocabulary / self-link / duplicate / cap rejected | :white_check_mark: unit | | |
| Withheld peer dropped from render | :white_check_mark: unit | | |
| Suggestion seed joins terms with OR, not spaces | :white_check_mark: unit | | regression — shipped broken once |
| Per-process-type relation defaults | :white_check_mark: unit | | mirrored from the UI module; see note in test |
| POST/DELETE /process/:id/links authz (creator or admin) | :white_check_mark: unit | dev | decision extracted to `canEditLinks` / `canRemoveLink`; HTTP wiring still untested |
| GET /process/:id/links returns can_edit correctly for admin vs anon | :white_check_mark: unit | dev | `canEditLinks`; regression-pinned — this exact case shipped broken |
| Typeahead returns all process types, honours exclude | | dev | **Needs API test** |
| Links picked at creation survive draft → submit → approve | | dev | **Needs API test** |
| Links survive revise-and-resubmit through review | | dev | **Needs API test** |
| Pending-review links stay private until approval | | dev | **Needs API test** — load-bearing privacy guarantee |
| Archived process withheld as a peer | | dev | **Needs API test** |
| Removing a link is authorized against the edge's AUTHOR, not the target | :white_check_mark: unit | dev | `canRemoveLink` — a backlink is not the target's to drop |
| A link cannot be removed via an unrelated process the caller owns | :white_check_mark: unit | | `edgeBelongsToProcess` |
| Deleting a process cascades its links (no dangling edges) | | dev | **Needs API test** |
| Brief ⇄ source pair derived from state.source_process_id | | dev | **Needs API test** |
| Brief projects its source's links, marked inherited | | dev | **Needs API test** |
| Derived / inherited links cannot be deleted via API | :white_check_mark: unit | dev | `isRemovableLink` |
| Link edits do NOT reset the Code of Conduct check | | dev | **Needs API test** |
| Picker: auto-suggestions from the draft's own title | | dev UI | **Needs E2E** |
| Read-only backlinks on announcement / meeting summary | | | **Needs E2E** |
| Word cloud shows no links panel at all | | | **Needs E2E** |

### Archive / Restore Flows (Slice: universal archiving, 2026-08-26)

Archiving flips `processes.status`; three types also keep state elsewhere and
sync it via `ProcessHandler.onArchive` / `onRestore`. "dev" means round-tripped
by hand against the dev database, checking BOTH tables — not automated.

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Handlers owning outside state declare both hooks | :white_check_mark: unit | | archiveHooks.test.ts |
| Hooks stay optional for state-only types | :white_check_mark: unit | | civic.brief implements neither |
| No handler implements one hook without the other | :white_check_mark: unit | | archiving must not be one-way |
| Registering a new process type forces an archive decision | :white_check_mark: unit | | registry snapshot; guard confirmed to fire |
| civic.proposal archive/restore syncs `proposals.status` | | dev | child returns to `closed`, not a default |
| civic.project archive/restore syncs `projects.status` | | dev | child returns to `completed`, not `active` |
| civic.wordcloud archive/restore syncs `state.status` | | dev | else an archived cloud keeps accepting words |
| civic.vote / conversation / brief round-trip | | dev | brief has no hooks — proves the default path |
| civic.announcement / meeting_summary / vote_results | | | **Not tested** — no dev instances; state-only, same case as brief |
| An archived proposal 404s at `/proposals/:id` and leaves `/propose` | | dev | the take-down bug found by the audit |
| Restore returns a process to its exact prior status | | dev | two-step Restore exercised in the browser |
| Child status survives an archive/restore round trip | | dev | **Needs API test** — the stash/read-back logic broke twice |

### Meeting Summary Flows (Slice: connector ladder + revisions, 2026-08-27)

145 unit tests across 11 files. The module had **zero** coverage before this,
which is a large part of why its discovery leg returned nothing for weeks
without anyone noticing.

Every test here is anchored to a failure that actually happened in production,
not to a coverage target. All are infrastructure-free (`tests/unit`), so CI
runs them; the network-facing halves are exercised through injected `fetchHtml`
/ `fetchXml` / `fetchJson` / `callClaude`, never live.

**Discovery — reading a jurisdiction's sources**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Wix CMS collection → meetings | :white_check_mark: unit | live | meetingSummaryWixCms.test.ts (21) |
| Both Wix document URL shapes resolve | :white_check_mark: unit | | `_files/ugd` and `filesusr.com` are one file |
| YouTube channel feed → meetings | :white_check_mark: unit | live | meetingSummaryConnector.test.ts (29) |
| Meeting date read from title, not upload time | :white_check_mark: unit | | a Jun 23 meeting uploaded Jun 24 |
| Multi-part uploads collapse to one meeting | :white_check_mark: unit | | earliest becomes the primary recording |
| Another body's meetings excluded by type | :white_check_mark: unit | live | EMS Board dropped, "BOS meeting with EMS" kept |
| `auto` falls through connectors in order | | live | needs an API test with a stubbed connector |
| Wix access-token + query round-trip | | live | real endpoint uncovered; injected in unit tests |

**Dedupe — three layers, most precise first**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Exact `source_id` match skips | :white_check_mark: unit | live | |
| Same meeting recognized across a connector change | :white_check_mark: unit | | meetingSummaryIdentity.test.ts (12) |
| YouTube watch / live / embed / youtu.be are one video | :white_check_mark: unit | | |
| Per-meeting slots create only the surplus | :white_check_mark: unit | | meetingSummarySlots.test.ts (8) |
| Two meetings on one date stay separate | :white_check_mark: unit | live | Budget Workshop + Regular, 2026-06-23 |
| Two same-date same-type meetings stay separate | :white_check_mark: unit | | two Budget Workshops, 2023-04-11 |
| Archived summary is invisible to dedupe | | dev | known limitation, documented in HANDOFF |

**Summarization**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Transcript-only meeting (no PDF at all) | :white_check_mark: unit | | meetingSummaryPipeline.test.ts (8) |
| No document block sent when there is no PDF | :white_check_mark: unit | | |
| Empty transcript + no PDF fails loudly | :white_check_mark: unit | | inventing blocks is worse than failing |
| Block count scales to meeting length | :white_check_mark: unit | | meetingSummaryPrompt.test.ts (11) |
| Prompt demands coverage through adjournment | :white_check_mark: unit | | a 4h24m run had dropped the last hour |
| Prompt forbids omitting a closed session | :white_check_mark: unit | | a run had dropped one with its vote |
| Transcript mishearings corrected by instructions | | live | config, not code — verify per jurisdiction |

**Timing and revisions**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| A meeting that has not happened is not summarized | :white_check_mark: unit | | meetingSummaryStaleness.test.ts (17) |
| Summary predating its own meeting is detected | :white_check_mark: unit | live | 2026-08-25 written 2026-08-22 |
| Upgrade fires when a recording appears | :white_check_mark: unit | live | not only when minutes appear |
| A fresh summary is not re-summarized each run | :white_check_mark: unit | | would burn the per-run budget |
| A source the record lacks triggers an upgrade | :white_check_mark: unit | live | `offersNewSources` — self-repairing |
| Published summary gets a revision, not an overwrite | :white_check_mark: unit | | meetingSummaryRevision.test.ts (16) |
| Live page keeps serving while a revision waits | :white_check_mark: unit | live | the 404 this design exists to prevent |
| Accepting a revision changes no publication state | :white_check_mark: unit | | no 404 window, no second feed card |
| Recording URL applied so timestamps become links | :white_check_mark: unit | live | |
| Admin edits survive on an in-review summary | :white_check_mark: unit | | replacement there is silent |
| Admin edits still get offered a revision | :white_check_mark: unit | | guarding both paths blocked the flow |
| Revision accept / discard through the admin UI | | dev | React surface, no component tests |

**Alarms — outcome checks, not step checks**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| Zero discovered meetings is a failure | :white_check_mark: unit | | meetingSummaryAlarm.test.ts (8) |
| A run that aborts alerts | :white_check_mark: unit | | previously returned 500 to nobody |
| A healthy run stays quiet | :white_check_mark: unit | | steady state must not nag |
| Published card ⇒ page resolves | :white_check_mark: unit | live | feedHealth.test.ts (8) |
| One feed card per published process | :white_check_mark: unit | live | feedPublicationDedupe.test.ts (7) |
| Stale summaries reported | :white_check_mark: unit | | |
| Overdue revisions reported after 14 days | | | **Needs test** — threshold logic uncovered |
| Alarm email actually delivers | | dev | Resend path; no automated coverage |

**Suite size.** 428 unit tests across 28 files (all CI runs); 490 across 35
files with a dev server on `:3000`. The first full run straight after starting
the server can fail a couple of API tests on a warm-up race (cold start plus
auto-seed) and pass on retry — re-run once before treating a red API result as
real.

**Known gaps.** The cron HTTP handler itself has no API test (it needs
`CRON_SECRET` and a running server, and CI runs only `tests/unit`). The admin
revision surface is untested at the component level. Neither the Wix data
endpoint nor Supadata is contract-tested, so an upstream shape change is caught
by the discovery guard at runtime rather than by CI — which is the intended
division of labour, but worth stating.

### API-Only Flows

| Flow | API | Slice | Notes |
|------|-----|-------|-------|
| GET /.well-known/civic.json returns discovery manifest | :white_check_mark: | — | health.test.ts |
| GET / returns endpoint directory | :white_check_mark: | — | health.test.ts |
| GET /health returns ok status | :white_check_mark: | — | health.test.ts |
| GET /process lists all processes | :white_check_mark: | — | processes.test.ts |
| GET /process/:id returns a single process | :white_check_mark: | — | processes.test.ts |
| GET /process/:id returns 404 for missing process | :white_check_mark: | — | processes.test.ts |
| GET /process/:id/state returns UI-friendly state | :white_check_mark: | — | processes.test.ts |
| GET /events returns an AS2 OrderedCollection | :white_check_mark: | — | events.test.ts |
| GET /events?page=true returns a conformant OrderedCollectionPage | :white_check_mark: | — | events.test.ts |
| Activities carry every Civic Activity Spec v0.2 MUST property | :white_check_mark: | — | events.test.ts |
| Activities are ordered newest first | :white_check_mark: | — | events.test.ts |
| Paging: `next` walks the sequence with no repeats or gaps | :white_check_mark: | — | events.test.ts |
| `limit` is clamped, never rejected | :white_check_mark: | — | events.test.ts |
| Filters (`context` / `type` / `since`) carry forward into `next` | :white_check_mark: | — | events.test.ts |
| Unmatched filters return an empty page, not an error | :white_check_mark: | — | events.test.ts |
| Restricted activities are withheld from anonymous callers, silently | :white_check_mark: | — | events.test.ts |
| GET /activities/:id dereferences one activity (404 for unknown/restricted) | :white_check_mark: | — | events.test.ts |
| GET /api/feed still serves the internal `{ events, count }` shape | :white_check_mark: | — | events.test.ts |
| GET /api/feed keeps its process_id / event_type filters | :white_check_mark: | — | events.test.ts |
| Serializer golden documents, one per mapped family | :white_check_mark: | — | activitySerializer.test.ts |
| Ballot activities never carry a selection | :white_check_mark: | — | activitySerializer.test.ts |
| Every emitted event_type has an activity mapping | :white_check_mark: | — | activitySerializer.test.ts |
| Serialization is deterministic (byte-identical) | :white_check_mark: | — | activitySerializer.test.ts |
| An event that cannot be serialized is never stored | :white_check_mark: | — | activitySerializer.test.ts |
| A ballot naming a choice is refused at emission | :white_check_mark: | — | activitySerializer.test.ts |
| A stored ballot's choice is stripped, not served | :white_check_mark: | — | activitySerializer.test.ts |
| Production refuses to boot without CIVIC_SPACE_DID | :white_check_mark: | — | hubConfig.test.ts |
| Accept: application/ld+json is honored, body unchanged | :white_check_mark: | — | events.test.ts |
| Manifest names its conformance level | :white_check_mark: | — | health.test.ts |
| POST /auth/request-code accepts email | :white_check_mark: | — | auth.test.ts |
| POST /auth/request-code rejects invalid email | :white_check_mark: | — | auth.test.ts |
| POST /auth/verify creates user + returns token | :white_check_mark: | — | auth.test.ts |
| POST /auth/verify rejects wrong code | :white_check_mark: | — | auth.test.ts |
| GET /auth/me returns user when authenticated | :white_check_mark: | — | auth.test.ts |
| GET /auth/me returns 401 without token | :white_check_mark: | — | auth.test.ts |
| POST /auth/residency affirms residency | :white_check_mark: | — | auth.test.ts |
| GET /proposals returns list | :white_check_mark: | — | proposals.test.ts |
| POST /proposals requires auth | :white_check_mark: | — | proposals.test.ts |
| POST /proposals requires residency | :white_check_mark: | — | proposals.test.ts |
| Resident can submit proposal | :white_check_mark: | — | proposals.test.ts |
| GET /proposals/:id returns detail | :white_check_mark: | — | proposals.test.ts |
| GET /search?q=X returns results | :white_check_mark: | — | search.test.ts |
| GET /search?q=nonexistent returns empty | :white_check_mark: | — | search.test.ts |
| Search results include process metadata | :white_check_mark: | — | search.test.ts |
| Cron: floyd-news-sync accepts GET, rejects POST | :white_check_mark: | — | crons.test.ts |
| Cron: digest accepts GET, rejects POST | :white_check_mark: | — | crons.test.ts |
| Cron: meeting-summary accepts GET, rejects POST | :white_check_mark: | — | crons.test.ts |
| Cron: admin-digest accepts GET, rejects POST | :white_check_mark: | — | crons.test.ts |
| Cron: missing auth returns 401 | :white_check_mark: | — | crons.test.ts |
| Cron: wrong auth returns 401 | :white_check_mark: | — | crons.test.ts |
| Process lifecycle: draft -> active -> closed -> finalized | | — | Needs test |
| Process registry dispatches to correct handler | | — | Needs test |
| POST /votes/drafts creates vote draft | | A | Needs test |
| GET /votes/drafts/:id returns draft with ownership check | | A | Needs test |
| PATCH /votes/drafts/:id validates duration range | | A | Needs test |
| POST /votes/drafts/:id/assistant returns vote-specific guidance | | A | Needs test |
| POST /votes/drafts/:id/review checks CoC for votes | | A | Needs test |
| POST /votes/drafts/:id/submit creates active vote process | | A | Needs test |
| GET /projects returns project list | | C | Needs test |
| GET /projects/:id returns project detail with sentiment | | C | Needs test |
| POST /projects requires auth + residency | | C | Needs test |
| POST /projects/:id/sentiment changes user sentiment | | C | Needs test |
| POST /projects/:id/sentiment neutral removes sentiment | | C | Needs test |
| POST /projects/:id/updates requires ownership | | C | Needs test |
| POST /projects/:id/comments requires auth | | C | Needs test |
| GET /projects/:id/comments returns comment list | | C | Needs test |
| POST /projects/drafts creates project draft | | C | Needs test |
| GET /projects/drafts/:id returns draft with ownership check | | C | Needs test |
| POST /projects/drafts/:id/assistant returns project-specific guidance | | C | Needs test |
| POST /projects/drafts/:id/review checks CoC for projects | | C | Needs test |
| POST /projects/drafts/:id/submit creates project | | C | Needs test |
| GET /deliberations returns deliberation list | | D | Needs test |
| GET /deliberations/:id returns deliberation detail | | D | Needs test |
| GET /deliberations/:id/clusters returns cluster state | | D | Needs test |
| POST /deliberations requires admin auth | | D | Needs test |
| POST /deliberations/:id/start requires admin auth | | D | Needs test |
| POST /deliberations/:id/close requires admin auth | | D | Needs test |
| POST /deliberations/:id/participate/vote requires resident auth | | D | Needs test |
| POST /deliberations/:id/participate/statement requires resident auth | | D | Needs test |
| GET /deliberations/:id/participate/next requires resident auth | | D | Needs test |
| Mock layer: seed- conversation returns mock statements | | D | Needs test |
| Mock layer: seed- conversation returns mock clusters | | D | Needs test |
| Mock layer: real conversation ID passes through to Polis adapter | | D | Needs test |
| GET /wordcloud/:id returns word cloud with cloud data | | WC | Needs test |
| GET /wordcloud/:id returns 404 for missing cloud | | WC | Needs test |
| GET /wordcloud/:id/cloud returns aggregated cloud data | | WC | Needs test |
| GET /wordcloud/:id/responses returns submission list | | WC | Needs test |
| POST /process/:id/action submit inserts wordcloud submission | | WC | Needs test |
| POST /process/:id/action submit rejects empty text | | WC | Needs test |
| POST /process/:id/action submit rejects duplicate author | | WC | Needs test |
| POST /process/:id/action activate transitions draft to active | | WC | Needs test |
| POST /process/:id/action close transitions active to closed | | WC | Needs test |
| POST /process/:id/action snapshot emits result event | | WC | Needs test |
| Word cloud page renders with SVG visualization | | | WC | Needs test |
| Word cloud submission form visible when status is active | | | WC | Needs test |
| Word cloud submit response adds to cloud | | | WC | Needs test |
| Word cloud submit requires auth | | | WC | Needs test |
| Word cloud one submission per author per prompt enforced | | | WC | Needs test |
| Word cloud submission respects max length | | | WC | Needs test |
| Word cloud ranked list toggle shows/hides entries | | | WC | Needs test |
| Word cloud responses list toggle shows/hides responses | | | WC | Needs test |
| Word cloud closed status hides submit form | | | WC | Needs test |
| Beta mode: welcome and about pages accessible without auth | | | Beta | Needs test |
| Beta mode: gated nav links non-clickable and grayed out | | | Beta | Needs test |
| Beta mode: public nav links highlighted | | | Beta | Needs test |

---

## How to Update This File

After each slice:

1. If the slice adds a new user flow, add a row to the appropriate table.
2. If you wrote tests for the flow, mark the API and/or E2E columns with :white_check_mark:.
3. If a flow exists but has no test yet, leave the columns blank and note "Needs test".
4. Flag any flows that were manually verified but not yet automated.

The goal: before any push to `main`, every row in this table should have at least one checkmark.

---

## Test Infrastructure Notes

- **Auth in tests:** Uses `CIVIC_DEMO_BYPASS_CODE=000000` (set in `.env`). Test helpers sign in by calling `/auth/request-code` then `/auth/verify` with the bypass code.
- **Intro popup in E2E:** Each test sets `localStorage.setItem("seen_intro_popup", "true")` before interacting with the page to prevent the intro dialog from blocking clicks.
- **File parallelism disabled:** Vitest runs test files sequentially (`fileParallelism: false`) because they share a dev server and database.
- **Playwright auto-starts servers:** The Playwright config includes `webServer` entries for both the backend (:3000) and frontend (:5173). If they're already running, it reuses them.

---

## Running integration tests in CI

**Read this before writing anything in `tests/api/` or `tests/e2e/`.**

**Update 2026-09-25 (multi-tenant Phase 3): the API layer runs twice.** The
`api-tests` job starts two servers on the one local stack — `:3000` with
`CIVIC_HUB_MINTED_TOKEN` off (hub queries as the service role) and `:3001`
with it on (hub queries as `authenticated` under a minted token, so the
forced RLS policies are live; its `/health` must report `hub_db.mode:
"hub_token"`, `ok: true` before any test runs) — and runs all of
`tests/api` against each, with `CIVIC_EXPECT_HUB_DB_MODE` pinning the mode.
The leak harness and the RLS catalog test are in that layer, so both run in
both passes. The token server's signing secret and publishable key are read
from `supabase status -o json` (the CLI's fixed, public local values). The
second pass runs even when the first fails, and the logs of both servers are
printed on failure.

**Update 2026-09-24: option 1 below is done** — `tests/api` runs on every push
(the `api-tests` job). `tests/e2e` still does not. A test in `tests/api` must
build its own data: CI's database is fresh each run (the 2c session's first
fix was a test that borrowed a conversation a developer's stack happened to
have). The rest of this section is the history.

Neither suite runs on push today. CI does four things: install, `tsc`,
`npx vitest run tests/unit`, and a UI build. It has no database and no server.
A test added to `tests/api` is a test **nobody will ever run automatically**
until one of the options below is done.

**A bare Postgres container does NOT work.** The app talks exclusively through
`supabase-js`, which speaks to PostgREST — Supabase's HTTP layer. A
`postgres:16` service container has no PostgREST, so the app cannot connect to
it at all. Considered and rejected 2026-08-26; don't re-tread it.

Two options that do work:

**1. Supabase CLI local stack** — *correct, more setup.* **Now unblocked.**
Add `supabase/setup-cli` to the workflow and run `supabase start`: a real
Postgres + PostgREST per run, applying `supabase/migrations/` from empty.
Isolated, disposable, no secrets in CI. Adds image-pull time to every run.

*Update 2026-09-22:* the blocker is gone. `supabase/config.toml` now exists
(Phase 1 of the multi-tenant work), and the whole thing has been done by hand:
`supabase db reset` builds the schema from the migration set alone and all 8
API test files — 68 tests — pass against it. The bonus this note hoped for is
therefore collected: **the migration set does build a working schema from
scratch.** It needed one fix to get there, `20260922000000_grant_table_
privileges.sql`, because not one migration contained a `GRANT` and the hosted
project's default privileges had been silently covering for that.

What remains is a workflow change: add the CLI step, start the stack, start
the dev server against it, and run `tests/api`. Adam's call, since it adds
container pull time to every push.

**2. A Supabase project dedicated to CI** — *quick, degrades over time.*
A second free project; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` as GitHub
secrets; migrations applied once by hand. But test data accumulates and
`review_turns` is append-only so it cannot be cleaned; concurrent pushes
collide and make CI flaky; and it puts a full-access key in CI secrets.

**Do NOT point CI at the dev Supabase project.** Runs would collide with
hands-on use and leave permanent residue in a database that gets browsed.

---

*Last updated: 2026-09-25 — Phase 3: the leak harness (both modes), the
RLS catalog test, and CI running the API layer twice. Before that, 2026-09-25 — Phase 2c suites, the E2E known-failure baseline,
and the API layer now running in CI. Previously: 2026-09-22 — recorded that the Supabase CLI local stack now
works end to end, that the migration set builds a working schema from scratch,
and added the hub-config API tests. Previously: 2026-08-26 — added the
archive/restore inventory, the unit-test layer (which CI runs and this file had never documented), the process-linking coverage inventory, and the standing note above on running integration tests in CI.*
