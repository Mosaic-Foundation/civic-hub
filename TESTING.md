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

# Type-check tests/, scripts/ and api/ (vitest does not; CI does)
npm run typecheck

# E2E browser tests (auto-starts backend + frontend if not running)
npm run test:e2e

# E2E with visible browser
npm run test:e2e:headed

# E2E with Playwright UI mode (interactive)
npm run test:e2e:ui

# Smoke suite against the live dev hub (needs the CIVIC_SMOKE_* variables;
# see "Smoke suite" below). CI runs it after each dev deploy.
npm run test:smoke

# Watch mode for API tests during development
npm run test:watch

# Tear the local database down (--no-backup discards its data)
supabase stop
```

Point the dev server at the local stack rather than at a hosted project
before running the API or E2E layers, and start it with `CIVIC_COC_FAKE=on`
and `CIVIC_POLIS_FAKE=on` (both refused in production): Submit runs the Code
of Conduct check, and the API, conformance and Playwright layers make it flag
text (`[coc-flag]`) or be down (`[coc-down]`) through the fake. `supabase start` prints the URL and
keys to use for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; everything
else can stay as it is in `.env.example`. As of 2026-09-22 all 8 API test
files (68 tests) pass against a stack brought up this way, which is the
first time that layer has been runnable from a clean checkout.

---

## Navigation: type pills, the phone's bar and More, the desktop sidebar, one Section order (2026-10-14)

**No migration.** The Playwright and smoke layers need a UI build that includes the slice (`cd ui && npm run
build`) when they run against `vite preview`. **New hubs are created with the sidebar** (`nav.layout` =
`sidebar`): a spec that makes its hub through the console's Create hub and looks at a desktop header (the Admin
pill, the account menu) must set `nav.layout` to `top_tabs` first, as `adminMenu.spec.ts` does. The seeded Floyd
and Athens read unset as Top tabs. **At phone width the Admin pill, the review icon, the drawer and the strip are
gone**: reach Admin items through More (`navigation "Sections"` → `[data-nav-id="more"]` → `more-sheet`). Look the
two navigations up with `exact: true`: "Sections" and "Hub" also match "Hub settings sections".

- **Unit:**
  - `navSections.test.ts`: the default order (today's strip), the bar's four (Feed, Talk, Proposals, Votes), the
    hub's order applied to the bar, a switched-off section dropped, a section the order doesn't name appended, a
    plugin's type getting its section from the registry, an unreadable order ignored, the section a detail page
    belongs to, and the switch-off rule (`orderAfterSwitchingOff`).
  - `processDescriptors.test.ts`: every type has a pill label; section ids and default places are distinct; a
    display a resident could not read is named.
  - `hubSettingsWrite.test.ts`: both keys in Theme and public; Navigation's two values; Section order stored as a
    JSON list of distinct ids without Feed.
- **API, `navigation.test.ts`** (both modes): `process_types` in `GET /hub-config` (labels, icons, sections; no
  tables, settings or adapters); the Theme keys admin-only to write and public once written; a bad layout, Feed in
  the order and a duplicate refused; a plugin switched off leaves the stored order in the same save, other saves
  leave it alone.
- **Playwright, `hubNavigation.spec.ts`** (11 tests, on the hub `localhost` resolves to, every setting put back):
  - the feed pill from the registry in the meta line, the title full width;
  - the bar's five tabs and the current one, kept on a vote's page;
  - More: every section, You, no Admin for a resident; closes on Escape (focus back on More), on a tap outside and
    on a swipe down;
  - an admin's Admin group (Hub settings opens);
  - a drafting form hides the bar, typing included;
  - unset Navigation is Top tabs;
  - Hub settings → Theme: Sidebar and a new order take effect at once (the sidebar, Hub settings current, the bar
    following the order), and Move up keeps focus on the row;
  - a resident's sidebar (no Admin, the Members count, "Signed in as");
  - a plugin switched off leaves the chooser, the bar, More and the sidebar, and comes back at the end.
  - Updated: `adminMenu.spec.ts` (the pill on a Top tabs desktop; the Admin group in More and the sidebar; a
    resident has neither), `feedbackRouting.spec.ts` (Contact Civic.Social from the Admin group),
    `membersInvites.spec.ts` (the sidebar's Members count and Share this hub), `ux-polish.spec.ts` (the drawer names
    sections as the strip does).
- **Smoke** (19 tests; the phone Admin menu test is replaced):
  - a feed item's type pill; the phone's bar and More as a resident (no Hub settings) and as an admin (the Admin
    group, Reviews with the queues' count, Plugins opens);
  - at desktop width with Navigation set to Sidebar, the sidebar instead of the header. The test sets the smoke
    hub's `nav.layout` and `afterAll` puts it back.

**Counts (2026-10-14, local):** see the Navigation session report (filled in below when the runs finish).

---

## Members and invites: the count, the Members page, hiding oneself, Share this hub (2026-10-14)

**One migration to apply to an existing local stack first:** `supabase migration up --local`
(`20261016000000_members_invites.sql`, additive). The Playwright and smoke layers need a UI build that includes the
slice (`cd ui && npm run build`) when they run against `vite preview`.

- **Unit, `memberInvites.test.ts`:** the addresses a member types (separators, case, each once, a bad one refuses the
  request and is named, at least one, at most 50); the message (trimmed, 1,000 characters); the invite email (who
  invited, the message, the one-tap `/sign-in#invite=` link, "won't send you another invite", the member's text
  escaped); the avatar seed (stable per hub and account, different per hub). Updated: `helpRegistry.test.ts` (three
  keys), `exportManifest.test.ts` (47 tables, 35 with hub_id), `forHub.test.ts` (35 hub tables).
- **API, `membersInvites.test.ts`** (a live, a beta and a demo hub through the console's Create hub, archived after;
  passes in both modes):
  - **a hidden member is absent from the stack and the Members page, and counted**; admins see them in
    `GET /admin/hub/members`, members get 403 there; showing oneself again puts them back;
  - the Members page is for signed-in members (401), marks admins, and **no answer carries an email address**
    (every member is exactly `avatar`, `name`, `is_admin`);
  - a demo hub counts its sample members; a beta hub never does;
  - an invite is emailed once with a 14-day link and **recorded in the admin log without the message** (nor in
    `hub_invites`);
  - **no repeat invite**: a second invite to the same address, and an invite to an existing member's address, are
    recorded as `skipped` and answered the same as a sent one;
  - **the daily limit**: 10 for a member, every address counts (an already-invited one too), the rest come back in
    `over_limit`, and a later request that day is refused per address;
  - a bad address refuses the request and sends nothing; signed out is 401;
  - beta: a member's invite goes on the waitlist with `invited_by` (and the admin's settings name the inviter), no
    email; an admin's invite adds the address to the allow list and is emailed (limit 50); demo: 403
    `invite_demo_hub`;
  - the link: signs a new address in once as a `code` session with `is_resident` false (the join step); dead when
    expired, used, or on another hub (`invite_unusable`); on a beta hub an address not let in gets `beta_closed`
    and the link is not spent.
  - Updated: `leakHarness.test.ts` walks `GET /members/summary`, `GET /members/` (with `?offset=60`) and
    `GET /admin/hub/members`; `functionGrants.test.ts` lists `take_member_invites` (authenticated and service_role).
- **Playwright, `membersInvites.spec.ts`** (11 tests, items 1 to 4 each at 375 px and 1280 px; one live hub through
  the console, visited on `<slug>.localhost`): "6 members" and five avatars signed out (no link, no Share button),
  the count opening the Members page signed in; the Members page (five listed, the hidden one left out, the admin
  marked, "1 member prefers not to be listed.", no address on the page); the hidden member told so, and the Settings
  switch putting them back and taking them off again; signed out, the page asks to sign in; Share this hub (the
  message from the hub's intro, Nextdoor, WhatsApp, Copy link, Facebook on a desktop, "Done: invites sent to 2
  addresses."); the invite link (Join <hub>, the token gone from the address bar, Confirm, the join step); admins'
  hidden members in Settings → People. No sideways scroll. `CIVIC_E2E_SHOTS=<dir>` saves a screenshot of each page.
- **Smoke** (18 tests): the member count and stack, then the Members page as a member at 375 px; a member hides
  themselves in Settings and leaves the page and the stack; a member's invite from Share this hub goes on the beta
  smoke hub's waitlist marked with who invited. `afterAll` deletes the run's `hub_invites` and waitlist rows.

**Counts (2026-10-14, local):**
- Unit: 135 files, 1,546 passed.
- API: service role 777 tests, 760 passed; token mode 763 passed. The failures are this long-used stack's data,
  not the slice: `hubIsolationControllers > admin queue counts` (Floyd has 4,350 reviews, over the 1,000-row read
  flagged before), `hubSettings > settings are scoped by hub` (two tests: Floyd's banner and About text were
  overwritten by an earlier run's leak strings), and once each `auditConcurrency` and the leak harness's GET walk,
  which passed on every rerun. CI's fresh stack is the judge.
- Playwright (preview build): 128 passed, 2 skipped, in 3.0 min.
- Smoke (local smoke hub): 18 of 18 in 20 s.
- **Another session's servers may hold the usual ports** (3000, 3001, 4173, 4175 here). A smoke run against a
  preview someone else started goes through their API and their build: check `lsof -iTCP:<port> -sTCP:LISTEN`
  before using a port, and pick a free one.

---

## Feedback routing: the hub keeps it, software reports reach Civic.Social, the loop closes (2026-10-13)

**One migration to apply to an existing local stack first:** `supabase migration up --local`
(`20261015000000_feedback_routing.sql`, additive). The Playwright and smoke layers need a UI build that includes the
slice (`cd ui && npm run build`) when they run against `vite preview`.

- **Unit:**
  - `feedbackDuplicates.test.ts`: likely duplicates are the same stream, the same page and similar words; no page
    never groups; chains join; groups keep the newest first.
  - `feedbackInbox.test.ts`: the console's status and GitHub-link changes (three statuses; github.com only, so no
    `javascript:` link), the one "fixed" email (names the hub, quotes and escapes the report, says why it came), and
    the page path (no query or fragment, nothing off the hub).
  - Updated: `adminFeedbackDigest.test.ts` (a line says "also sent to Civic.Social" only for shared items, and links
    to the item's row), `helpRegistry.test.ts` (two keys), `adminAnchors.test.ts` (`/admin#contact-civic-social`),
    `exportManifest.test.ts` (46 tables).
- **API, `feedbackRouting.test.ts`** (two hubs made by the console's Create hub, archived after; passes in both modes):
  - a software report lands with the hub (page, version, consent, the copy's status) and in the console's inbox (the
    hub's name from data, the browser, the consenting sender's address);
  - **an item without consent reaches the console with no email address** (anonymous with an address typed, signed
    in without ticking, ticked with no address), and the database refuses an address without consent;
  - Suggest a topic, Moderation and General stay with the hub;
  - Admin → Feedback shows the badge; Send to Civic.Social once (409 after), never with the sender's address, in the
    admin log; refused for a resident (403), a bad stream (400) and another hub's item (404); a hub host answers 404
    for `/control/feedback`;
  - the console's planned reaches the hub's badge without the issue link; fixed tells a consenting sender once and is
    audited without their address; bad statuses and non-GitHub links are refused;
  - Contact Civic.Social reaches the inbox with the admin's address, not the hub's tab, and works with Feedback off.
  - Updated: `leakHarness.test.ts` walks `POST /admin/feedback/:id/forward` with Floyd's ids; `hubPurge.test.ts`
    purges a hub with a copy in the inbox.
- **Playwright, `feedbackRouting.spec.ts`** (10 tests, each at 375 px and 1280 px; one beta hub through the console,
  visited on `<slug>.localhost`): the form's question and each side's pills, the notice, consent only with an
  address, the page it came from (opened from the footer on `/about`); the hub report staying with the hub; a digest
  link landing on its row, the badge, Send to Civic.Social; Contact Civic.Social from the Admin menu with its "?";
  the console's duplicates, consent, status back to the hub's badge, and issue link; no sideways scroll.
  Updated: `adminMenu.spec.ts` (five items).
- **Smoke** (15 tests): a software report from the form at 375 px lands with the hub and in the inbox; a hub report
  with the hub only; an admin sends it to Civic.Social from its row and the badge follows Civic.Social's status. The
  suite has no console session (that would put the operator's rights in CI): it reads the smoke hub's inbox rows
  from the dev database and sets a status as the console does, and `afterAll` deletes the run's copies.

**Counts (2026-10-13, local):**
- `npm test` (lint, unit, API in service-role mode with the conformance suite): 193 files, 2,283 passed, 10 skipped,
  1 todo. Token mode (`tests/api`): 59 files, 746 passed. The one failure in each is still `hubIsolationControllers >
  admin queue counts` (long-used stack, over 1,000 review rows; flagged before).
- Playwright (preview build): 119 passed, 2 skipped, in 2.7 min.
- Smoke (local smoke hub): 15 of 15 in 19 s.
- Don't edit `src/` while the API layer runs against a `--watch` server: the restart drops requests ("socket hang
  up"), which is what failed `ballotSecrecy` once here.

---

## Admin menu slice: the menu, anchors, help notes, one sample deleted, the starter word cloud (2026-10-13)

No migrations. **CI gains a step**, "Help links reach the docs" (`scripts/check-help-anchors.ts`): it fetches
`https://docs.civic.social/help-anchors.json` and fails when a help key not marked `pending` points at an anchor the
docs don't publish. Locally, point it at a docs build: `CIVIC_HELP_ANCHORS=../civic-hub-docs/docs/.vitepress/dist/help-anchors.json`.

- **Unit:**
  - `helpRegistry.test.ts`: a note for every Settings section, plugin panel, part and setting, and none for anything
    that doesn't show; each note 20–240 characters with no em dash; each anchor its key's own (`anchorForKey`); a
    pending key links to its page's top; the check fails on a dropped anchor and treats `/page` and `/page/` as one.
  - `adminAnchors.test.ts`: where `/admin#…` and `/admin/settings#…` lead (a tab wins on `/admin`), and no two places
    share an anchor except the Feedback tab and plugin.
  - Updated: `adminFeedbackDigest.test.ts` ("Processes").
- **API, `adminMenuSlice.test.ts`** (hubs made by the console's Create hub, archived after):
  - a hub made without samples starts with an open, real word cloud in its strip, its prompt naming no place, with
    its created and started events and a `wordcloud.starter` admin log row; a hub with samples shows the sample one;
    Word clouds off, none;
  - one sample deleted without a code, its brief with it, its events gone, recorded as `sample_content.delete_one`
    (read through `GET /admin/hub/admin-log`); a real process answers 404 and stays; residents get 403;
  - deleting the sample word cloud puts the starter in the strip; removing every sample keeps it;
  - `/notifications/reviews/count?scope=mine` leaves out an admin's queue.
  - Updated: `sampleSeed.test.ts` and `sampleRefresh.test.ts` expect the starter where a hub has no samples, and in
    the sample one's place after removal; `leakHarness.test.ts` walks `GET /admin/hub/admin-log` and
    `DELETE /admin/hub/sample-content/:id` with Floyd's ids.
- **Playwright, `adminMenu.spec.ts`** (8 tests; one demo hub with samples made through the console, visited on
  `<slug>.localhost`):
  - the Admin menu and review icon at 375 px and 1280 px (four items, the count, on screen, Escape closes; the
    account menu without Admin panel; Plugins and Reviews go where they say; "Processes"); a resident has neither;
  - anchors: `/admin#moderation`, `/admin/settings#feedback` (that panel open and in view, the others closed until
    clicked), `/admin/settings#threshold`;
  - a "?" at both widths: the registry's note, the docs link with its anchor, on screen, Escape returns focus; a
    plugin panel's "?" doesn't open the panel;
  - one sample deleted from the list and one from its own page; the strip's starter prompt; "Remove samples" gone and
    Next: set up your hub after the last;
  - the word cloud picker's empty state (the list answers empty), linking to `/wordcloud/new`.
  - Updated: `pluginSwitches.spec.ts` opens the Projects card through its anchor; `reviewQueue.spec.ts`
    ("Processes").
- **Smoke** (13 tests): the Admin menu at 375 px with its counts and the review icon's; a "?" note with the docs link;
  a sample planted on the smoke hub (`plantSample`, removed in afterAll if a run fails) deleted from Settings, then
  Next: set up your hub.

**Counts (2026-10-13, local):**
- Unit: 132 files, 1,523 passed.
- API: 58 files, 731 passed, 10 skipped and 1 todo, in each mode. The one failure in each is still `hubIsolationControllers >
  admin queue counts` (long-used stack, over 1,000 review rows; flagged before).
- Conformance: 97 passed, 3 skipped, 1 todo. Under load (Playwright running at the same time) the hourly-close
  step timed out once in token mode, and passed when run again on its own.
- Playwright (preview build): 107 passed, 2 skipped. `securityHeaders` lost one database connection while two suites
  ran at once, and passed run again alone.
- Smoke (local smoke hub): 13 of 13 in 19 s.

---

## Sign-in: lock the code, the link, Keep me signed in, terms without a checkbox, city-counties (2026-10-14)

**Two migrations to apply to an existing local stack first:** `supabase migration up --local`
(`20261014000000_sign_in_codes`, `20261014010000_jurisdiction_city_county`), then reload the place list:
`CIVIC_TARGET_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node --import tsx scripts/load-jurisdictions.ts`.

- **Unit:**
  - `codeRules.test.ts`: the rules in `civic.auth/codeRules.ts`, against an in-memory store that behaves like
    `take_sign_in_attempt`, with a clock the test moves.
    - A code works once and for ten minutes, and five wrong tries burn it, never the address.
    - **Nuisance attacker:** asking for codes never stops the owner's code. A fourth request while three are live
      is refused with a time. One email a minute, ten new codes an hour.
    - **Guesser:**
      - one machine gets five wrong tries at an address an hour, refused before a try is spent;
      - each guess spends a try on every live code;
      - many machines face at most 10 × 5 tries an hour.
    - The link works once and dies with its code.
    - Times are in the hub's zone, or "UTC" when it has none.
  - `codeEmail.test.ts`: the code on a line of its own after "Your code is:"; the Sign in button and link; none on
    step-up, console and start-page codes.
  - `jurisdictions.test.ts`: `searchTypesFor`, the code kept from the county, `consolidated.csv` well-formed.
  - **Updated:**
    - `hubDocuments.test.ts`: Floyd's golden legal copies regenerated for "In short";
    - `forHub`, `exportManifest`, `hubBundle`: `sign_in_codes`, `platform_sign_in_codes`;
    - `demoPrivilegedSignIn`, `hubWording`: the email now returns `{ html, text }`;
    - `handover`: the setup guide is in the invite's first paragraph.
- **API:**
  - `auditSignIn.test.ts`, rewritten for the new rules:
    - twenty wrong guesses at once spend exactly five tries and burn the code, then a new code works;
    - one email a minute and three live codes, with nothing dropped;
    - one network's five wrong tries at an address leave the owner's next code untouched;
    - the "Try again after" sentence;
    - the console and start-page attempt function is atomic.
  - `signInLink.test.ts`:
    - the link signs in once, as a `code` session, and dies with an expired or burned code;
    - it works only on its own hub;
    - sessions last 7 days, or 90 days with `keep_signed_in: true`.
  - `startPage.test.ts`:
    - the creator's account has the legal version after Create, and so does the audit row;
    - `GET /start/legal`;
    - the per-address and lockout tests are rewritten.
  - `loginHardening.test.ts`: a code burned after five wrong tries, with no lockout.
  - `control.test.ts`: a wrong or spent console code is 400 (`invalid_code`, `no_live_code`), not 401.
  - `jurisdictions.test.ts`: a city-county is found under City, under County and under its own type.
  - `functionGrants.test.ts`: the three new functions.
- **Playwright, `signIn.spec.ts`** (375 px):
  - the code field's `autocomplete="one-time-code"`, `inputmode="numeric"` and digits-only paste;
  - the throttle and burned-code sentences;
  - Keep me signed in (90 days, remembered);
  - the join step with one checkbox and the notice, with "In short" on the Privacy and Terms pages;
  - the link: Confirm, the token gone from the address bar, Join, and a spent link's sentence.
- **Playwright, updated:**
  - `signupWording.spec.ts`: the demo box reads "I'm trying this demo." and the notice is beside Join;
  - `startPage.spec.ts`: the notice and a summary beside "Create my hub", and no terms prompt on the new hub.
- **Smoke** (10 tests): a new resident signs in on the smoke hub **through the email's link** at 375 px, sees the
  notice beside Join, and joins. Its account is deleted in afterAll. The code is planted in the dev database as a
  request would store it (`plantSignInLink`), because the suite can't read email.

- **Conformance, step 6** (2026-10-14, from the production check): an expired, archived vote ends with no
  `active_vote_keys` rows and stays archived. The hourly `vote_close` job runs a close's last step (bridge rows
  cleared, ballots shuffled) for archived votes past their window, and answers `archived_finished`. It applies to any
  type whose descriptor lists `active_vote_keys`. Conformance: 97 passed.

**A hub's own documents replace the shared ones, summary included.** On a long-used local stack, Athens has a Code of
Conduct some test wrote, so its page has no "In short". `signIn.spec.ts` checks the Privacy and Terms pages.

**Counts (2026-10-14, local):**
- Unit: 130 files, 1,510 passed.
- API: 57 files, 720 passed, 10 skipped and 1 todo, in each mode. The one failure in each is `hubIsolationControllers >
  admin queue counts`: on a long-used stack Floyd has more than 1,000 review rows, and `/admin/queue-counts` reads them
  unpaged. CI's fresh database passes it. It is flagged as its own task.
- Conformance: 96 passed, 3 skipped, 1 todo.
- Playwright (preview build): 102 passed, 2 skipped.
- Smoke (local smoke hub): 10 of 10 in 16 s.

---

## Smoke suite (2026-10-13)

A fourth layer: `tests/smoke/`, Playwright against the **live dev deployment**, after every dev deploy. It replaces
the browser half of the dev checklist Adam ran by hand after each release (RUNBOOK-release.md → Dev).

- **What it checks** (`dev.smoke.spec.ts`, one serial group, 19 tests):
  - `/api/health` is ok with no schema gaps, on the deployed commit; an unknown `POST /api/…` answers JSON 404;
  - a resident and an admin are signed in;
  - a new resident signs in through the email's link at 375 px and joins beside the terms notice (since 2026-10-14,
    sign-in slice: the one sign-in that is not a minted session);
  - a clean vote on a beta hub waits in the admins' queue (an approval vote with an empty extra option, which must
    not block Submit);
  - a flagged draft is refused with the draft kept, and "Tell the admins" reaches the queue marked "Flagged by the
    check";
  - approve and decline each land on the list with their confirmation;
  - the Save bar in admin Settings → Copy stays in view, and leaving asks first (nothing is saved);
  - a drafting form at 375px: the slim header, and the bar steps aside while a field has focus;
  - Edit & resubmit after an admin requests changes brings back the same review item;
  - a ballot cast at 375 px on an open vote an admin made: the page holds still, the share banner goes by itself, the
    receipt box has the code beside the download button (since 2026-10-13, vote pages fixes);
  - a "?" opens its note with the docs link; an admin deletes a sample (planted on the smoke hub) and Next: set up
    your hub follows (since 2026-10-13, admin menu slice).
  - a feed item's type pill; the phone's bottom bar and More at 375 px, as a resident (no Admin) and as an admin (the
    Admin group, Reviews with the queues' count); the sidebar at 1280 px with Navigation set to Sidebar, put back in
    `afterAll` (since 2026-10-14, navigation slice; these replace the phone Admin menu test).
  - a software report from the form at 375 px lands with the hub and in Civic.Social's inbox (page and consent with
    it); a hub report stays with the hub; an admin sends it to Civic.Social from its row and the badge follows
    Civic.Social's status (since 2026-10-13, feedback routing; inbox rows read from the dev database, copies deleted
    in `afterAll`).
  - the member count and avatar stack, and the Members page as a member at 375 px; a member hides themselves in
    Settings and leaves the page and the stack; a member's invite from Share this hub goes on the beta hub's
    waitlist marked with who invited (since 2026-10-14, members and invites; the run's invites and waitlist rows
    deleted in `afterAll`).
- **Where it runs:** only on the dedicated smoke hub, which must be in beta and have a slug starting with `smoke`. Sessions are
  minted straight into the dev database with its service-role key (Adam's decision, 2026-10-13: no test-only
  sign-in route in `src/`). `tests/smoke/devStack.ts` refuses the production project, any other hub, a deployment
  serving another hub, and a hub not in beta, before writing anything.
- **The Code of Conduct check is the real one on dev** (Vercel refuses `CIVIC_COC_FAKE`): the flagged text is an
  unmistakable personal attack on a made-up neighbour, and it ends with the fake's `[coc-flag]` marker so a local
  run flags it too. About four AI checks per run.
- **Cleanup** (`afterAll`): pending reviews declined, the approved vote archived, the run's residents' accounts
  deleted (their drafts and sessions go with them), the admin's minted sessions ended. Events and review turns are
  append-only, so their history stays on the smoke hub, which is why it is its own hub. Residents are
  `smoke-<run>-…@example.test`; the beta mail guard holds back every email to them.
- **When it runs:** `.github/workflows/smoke.yml`, on `deployment_status` success for `Production – civic-hub-dev`.
  It waits for the hub to serve the deployed commit, runs `npm run test:smoke`, and shows as the **Smoke / dev**
  check on that commit. Runs never cancel each other, so cleanup always runs. The same workflow's **production** job
  runs on `Production – civic-hub`: health and the JSON 404 only, read-only, no secrets.
- **Configuration:** the variables and secrets are listed in RUNBOOK-release.md → One-time setup. A job with any of
  them missing skips with a notice naming them.
- **Budget:** under 3 minutes (`globalTimeout` 170 s in `playwright.smoke.config.ts`); 9 s locally. No retries: the
  steps build on each other, and a retry would submit everything again.

**Running it locally**, against a local `smoke` hub on the local stack (the guard allows the local stack):

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<the local stack's service-role key> CIVIC_ADMIN_EMAILS=admin@example.test npx tsx scripts/create-hub.ts --id smoke --hostname smoke.localhost --name "Smoke Test Hub" --kind other --mode beta
```

Start an API with `CIVIC_DEV_HUB=smoke` and `CIVIC_COC_FAKE=on` (so bare `localhost` is the smoke hub), and a
`vite preview` in front of it (as in `e2e.yml`). Then:

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CIVIC_SMOKE_BASE_URL=http://localhost:4173 CIVIC_SMOKE_HUB=smoke CIVIC_SMOKE_ADMIN_EMAIL=admin+smoke@example.test CIVIC_SMOKE_SUPABASE_URL=http://127.0.0.1:54321 CIVIC_SMOKE_SERVICE_ROLE_KEY=<the local stack's service-role key> npm run test:smoke
```

Green: **8 of 8 (2026-10-13)**: local stack, 8.7 s; and **live dev, 52 s** (Smoke run 38434395815 on `36ea87a`),
the real Code of Conduct check flagging the test text, and cleanup leaving no open review or session.

---

## Vote pages fixes (2026-10-13)

No migration. Locally, run Playwright against a **preview build** (as CI does): the Vite dev server calls the API
cross-origin, and the specs' `X-Forwarded-For` header fails CORS there, so every page looks signed out. Build the UI,
serve it with `CIVIC_PREVIEW_API=http://localhost:3000 npx vite preview --port 4173` in `ui/`, then run with
`CIVIC_E2E_BASE_URL=http://localhost:4173 CIVIC_E2E_UI_ORIGIN=http://localhost:4173`. Rebuild after each UI change.

- **Playwright, `votePages.spec.ts`** (each at 1280 and 375 px):
  - voting doesn't move the page: the ballot stays where it was on the screen, with scroll anchoring off as Safari
    may have it; the share nudge (banner or the bar's callout) shows and goes by itself;
  - the receipt box, open and closed: the code to the right of the download button on its row, Check it below, the
    privacy line last, at most three lines of code;
  - the check page: codes at most two lines and wider than 120 px, stacked over the vote on a phone, beside it on a
    desktop; Check grey after a check, live for another code;
  - a blank third option doesn't block Submit; one filled option says two are needed.
- **Playwright, updated:** `yourVote.spec.ts` (the label takes the row but its count; `.result-bar-*` classes),
  `actions.spec.ts` (class names), `voteReceipt.spec.ts` (the link is "Check it").
- **API:**
  - `voteOptions.test.ts`: blank options dropped at Submit and at an admin's create; one filled option refused at
    Submit and the draft kept;
  - `hubCreatedReads.test.ts`: the public brief carries the recipients' names, the sent and approved dates, the
    held-back names and reason, and nothing shaped like an email address;
  - `heldBackAndQueues.test.ts`: an approval on the demo hub publishes `addressed_to` and the reason;
  - `briefRegenerate.test.ts`: a conversation takes its regenerated summary when the new brief is published (or, if
    regenerated before, when it is approved), keeps the old one, and emits one `civic.process.updated`;
  - `control.test.ts`: a new hub starts with `plugin.vote.support_threshold` = 0;
  - `pluginToggles.test.ts`: the hourly close leaves a switched-off type open instead of skipping the hub.
- **Conformance:** step 5 adds "the hourly job closes it with nobody reading it" for every type with a deadline.
- **Unit:** `jobRegistry.test.ts` (the deadline close belongs to no plugin).
- **Smoke** (9 tests): the clean vote is an approval vote with an empty extra option; a new test votes at 375 px on an
  admin's open vote (the page holds still, the banner goes, the receipt box layout). Local: 9 of 9 in 15.5 s.

**Counts (2026-10-13, local):**
- `npm test` (lint, unit and API, service role): 184 files, 2,199 passed, 10 skipped, 1 todo.
- API with minted hub tokens: 56 files, 711 passed on the full run with one 500 in `auditConcurrency.test.ts`
  (PostgREST's "invalid response from the upstream server", the pool-reset flake noted below); the file then passed
  10 of 10.
- Unit: 128 files, 1,487 passed.
- The conformance suite: 96 passed, 3 skipped, 1 todo (93 before, plus the hourly close for each of the three types
  with a deadline).
- Playwright (preview build): 96 passed, 2 skipped. `startPage.spec.ts` needs the API's `CIVIC_UI_BASE_URL` to be
  the preview's address, as in `e2e.yml`.

---

## Actions show right away (2026-10-13)

**Before running anything against an existing local stack, apply the new migration:**

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && supabase migration up --local
```

Without it, `/health` names `vote_drafts.check_mode` and every vote draft fails.

- **API:**
  - `accountIds.test.ts`: no answer to a resident or a visitor carries another person's account id. It covers every
    resident action of every type, and every read of the process: state, row, list, comments, events, feed, the type's
    own page and list, and search. A failure names the JSON path.
  - `hubCreatedReads.test.ts`: briefs, meeting summaries and vote results are 404 until published. A published brief
    carries no recipients or emails.
  - `closeEarly.test.ts`:
    - an admin's early close without a note, or with only spaces, is refused 400 `note_required`;
    - after the deadline no note is needed;
    - residents can't close.
  - `briefRegenerate.test.ts`, on a published brief:
    - the new version is staged and the page is unchanged;
    - publishing replaces it in place, updates its one feed card and sends no email;
    - history is kept, and the audit rows are written;
    - publish or discard with nothing waiting answers 409;
    - residents are refused.
  - `voteOptions.test.ts`: 80 characters taken and 81 refused at create; a draft is refused at Submit and kept.
  - `checkMode.test.ts`:
    - before close, the check says only that the vote is open;
    - after close, the log and the verify answer reveal the choice in one mode and nothing in the other;
    - an older vote shows the choice;
    - the draft's default follows the hub setting, the queue shows the mode, and the vote keeps it.
  - `submitRunsCheck.test.ts`: approval votes submit, and a flagged option is refused. The old check route is gone
    (404).
  - `aiLimits.test.ts` and `pluginToggles.test.ts` now prove the check through Submit.
- **Conformance** (`tests/conformance/`):
  - step 4: every action's answer carries `view`, equal to a fresh read by the same caller, and no foreign account id;
    so does the read after the walk;
  - step 5b, for every type with a deadline: close early is refused without a note; with one, the note is on `view`,
    on each close event, in the brief, and in one admin-log row; the brief is then regenerated.
- **Unit:** `closedEarly.test.ts` (the line, in the hub's time zone), `receiptPdf.test.ts` (a well-formed PDF, both
  modes' lines, wrapping, the file name). `processDescriptors.test.ts` now also requires a note on every deadline
  action.
- **Playwright** (`tests/e2e/actors.ts` holds the shared session and live-process helpers):
  - `actions.spec.ts`: two presses cast one ballot and the tally comes from the answer; supporting and commenting
    update without a reload or a second read.
  - `yourVote.spec.ts`: the mark after voting, a reload and close, and not in another browser; labels above their bars;
    a long option in 3 lines with the rest on a tap; tab refresh (`page.clock`).
  - `closeEarly.spec.ts`: a vote and a proposal; the confirm is disabled without a note; the line and the note show;
    a resident has no button.
  - `regenerateSummary.spec.ts`: unpublished, then published (staged, public page unchanged, published, "updated").
  - `receipts.spec.ts`: both modes; the download (name, code, address, private line, no choice) and the check page
    before and after close.

  Every spec runs at 1280 and 375 px.
- **The test runner's cron secret:** against a server whose `CRON_SECRET` isn't the `.env` one, set
  `CIVIC_TEST_CRON_SECRET` to it, or the job tests answer 401.

**Counts (2026-10-13, local):**
- `npm test` (lint, unit and API, service role): 184 files, 2,190 passed, 10 skipped, 1 todo.
- API with minted hub tokens: 56 files, 703 passed, 10 skipped, 1 todo.
- Unit: 128 files, 1,487 passed.
- The conformance suite: 93 passed, 3 skipped (hub-created types), 1 todo (tier 2).
- Playwright: 86 passed, 2 skipped.
- **Flake:** in about 1 of 5 full runs of the suite, one of step 4b's five simultaneous writes answered 500. The one
  caught in the log was PostgREST's "invalid response from the upstream server" (its pool reset after the suite's own
  DDL, as recorded since Audit 3). Eight runs of steps 4 and 4b without step 3's trigger passed, and five full runs in a
  row passed. Rerun the file if it shows.

---

## Submit and save (2026-10-12)

Submit runs the Code of Conduct check; sticky Save; one Modal; zoom allowed;
unknown API routes answer JSON.

- **The fake check** (`CIVIC_COC_FAKE=on`, `src/debug/fakeCodeOfConduct.ts`)
  stands in for the AI call only. The hash, the stored result, the submit gate
  and "tell the admins" are the real ones. Without it, Submit calls the real
  check (or finds it unavailable with no key), and the flag tests fail with
  201 where they expect 400.
  - Tests import the markers from `tests/fixtures/codeOfConduct.ts`.
  - Playwright specs import them from `src/debug/fakeCodeOfConduct.ts`
    directly: Playwright's transpiler can't load the fixture's `src/` imports.
- **The conformance driver submits through the real check.**
  - `submitDraft(..., { check: "passed" | "flagged" | "unavailable", tellAdmins })`
    puts the marker in the draft's description. It no longer writes a check
    result into the row.
  - The new step-2 tests, per drafted type:
    - flagged text is refused, and the draft is kept;
    - "tell the admins" reaches the queue once, flagged, with the note, on a
      beta and a demo hub;
    - a check that can't run goes to an admin.
- **API:**
  - `tests/api/submitRunsCheck.test.ts`:
    - an admin's flagged text waits for review;
    - a clean `tell_admins` is unflagged;
    - a second press is refused the same way;
    - a revision's flag is set, then cleared;
    - the old route still answers.
  - `tests/api/unknownRoutes.test.ts`: JSON 404 for every method; a real route
    still answers.
  - The A4 (`auditLiveExposure`), drafts and sample-refresh tests now prove
    "checked at Submit" instead of "refused until checked".
- **Playwright:**
  - `codeOfConductCheck.spec.ts`:
    - flagged Submit: refused, kept, shown by the field, then fixed;
    - "tell the admins";
    - Escape closes the box and returns focus.
  - `reviewQueue.spec.ts`: approve and decline land on the list.
  - `settingsSave.spec.ts`: Save stays in view; leaving asks; Discard.
  - `ux-polish.spec.ts` "Zoom".
  - `phoneDrafting.spec.ts` (after the release): the focused phone layout for every drafting kind at 375px. No
    browser opens a software keyboard, so "keyboard open" is the field's focus there; check a real phone by hand.
- **Running the console specs locally** (`handover`, `startPage`,
  `assistantLimits`): set `CIVIC_API_BASE` to the hub server too. The console
  helpers default to :3000. The API also needs `CIVIC_UI_BASE_URL` = the UI's
  origin.
- **Servers without `--watch`** (the `hub-local-*` / `hub-coc-*` launch
  configs) run the code they started with. Restart them after a server change.

**Counts (2026-10-12, local):**
- `npm test` (service role): 176 files, 2,151 passed, 10 skipped, 1 todo.
- API in hub-token mode: 50 files, 673 passed.
- The suite: 90 passed, 3 skipped, 1 todo.
- Playwright: 55 passed, 2 skipped.

---

## Plugin conformance suite (2026-10-12)

**Every process type passes one shared suite; registering a type is enough to have it tested.** The steps and
what a plugin author needs are in `tests/conformance/README.md`.

- **Run it:** `tests/api/conformance.test.ts` calls `runConformance({ handlers: getAllHandlers() })`, so it runs
  in both CI API passes. Locally:
  ```bash
  cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CIVIC_API_BASE=http://localhost:3000 npx vitest run tests/api/conformance.test.ts
  ```
- **The server needs `CIVIC_POLIS_FAKE=on`** (development only, refused in production). Conversations then talk
  to an in-memory Polis behind the real adapter (`src/debug/fakePolis.ts`). CI's `api-tests` servers set it. The
  Tier 3 steps make that Polis down, slow or erroring through `PUT /debug/polis-fake`, which exists only under
  the flag.
- **The static half** (`src/processes/descriptorCheck.ts`) also runs without a server, in
  `tests/unit/processDescriptors.test.ts`.
- **Disagreements are refused outside production.** The hub refuses, with a 500 under a dev server, an action
  that is not in its type's descriptor, that runs from or lands in a status it doesn't declare, or that emits an
  undeclared event (Stage 1, at the emission path). So every API and E2E test also checks descriptors. In
  production these are reported (`descriptor.*` codes), not refused.
- **Mutation-checked:** putting the stray `created` back fails step 3 on both hubs, and an event missing from a
  descriptor fails the walk.
- **Not walked:** types only the hub creates (brief, meeting summary, the retired vote results) get step 1 only,
  shown as skipped.
- **The suite installs one trigger per run** (step 3's failing approval) and waits 1.5 s after its DDL, and
  `auditDrafts.test.ts` now waits after its own. This is because of the "ballot flake" Audits 3 and 4 recorded
  (the gateway's 502, "invalid response from the upstream server").
  - **The cause:** PostgREST re-initialises its connection pool on every schema reload, and a request in flight
    at that moment gets the 502.
  - **What triggers it:** any test that runs DDL or `NOTIFY pgrst` causes a reload, and several do.
  - **The evidence:** in a full run on 2026-10-12, both 502s fell in minutes with pool resets. The settles remove
    two sources, not all of them, so a lone 502 under concurrent writes still means "rerun the file".
  - **Production:** nothing runs DDL there while residents act, so it is not a production risk.
- **Fixtures for a live proposal or project:** `tests/fixtures/liveProcess.ts` (draft, submit with the check
  down so it waits for an admin, approve).
  `POST /proposals` and `POST /projects` are gone.
- **E2E locally the CI way** needs `CIVIC_E2E_UI_ORIGIN=http://localhost:4173` as well as `CIVIC_E2E_BASE_URL`;
  without it, the console and start-page specs go to :5173.

**Counts (2026-10-12, local):**
- `npm test`: 174 files, 2,126 passed, 10 skipped, 1 todo.
- API in minted-token mode: 48 files, 651 passed.
- Unit: 126 files, 1,475 passed.
- Playwright: 49 passed, 2 skipped.
- The suite: 78 passed, 3 skipped (hub-created types), 1 todo (tier 2).
- After removing `lifecycle_profile` and the contract version, the same counts held in both modes. The
  service-role pass needed one rerun of `auditConcurrency` and the suite, for the 502 above.

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
  Floyd unaffected, back on restores; since 2026-09-26 also a vote in
  progress when its plugin goes off: its deadline passes, reads while off do
  NOT close it, the first read after it is back on does — **since Phase 5
  part two stamped with the deadline** (`civic.process.updated`, `.ended`,
  `.aggregation_completed` all carry `voting_closes_at`) and recorded then
  (`events.recorded_at`); **the hourly `vote_close` job**: skips Athens while
  Votes is off (the vote stays active), closes it once on, stamped with the
  deadline, actor `system:auto-close`, a second run closes nothing (needs
  `CIVIC_TEST_CRON_SECRET`, default CI's value); and
  `GET /admin/hub/plugins/live`, the Plugins page warning's count, admin
  only), `hubBaseUrl.test.ts` (a stored event
  carries its own hub's origin), `atomicFunctions.test.ts` (`cast_vote` and
  `transition_process` leave nothing behind on a forced mid-function failure
  and refuse another hub's rows), and the per-hub runs in `crons.test.ts`.
- **The super admin (2026-09-26, Phase 5 part one):** `control.test.ts`
  talks to the console with `Host: console.localhost`, so the API server
  needs **`CIVIC_CONSOLE_HOSTNAME=console.localhost`** and
  **`CIVIC_CONSOLE_ADMIN_EMAIL=operator@example.test`** (CI sets both, with
  `CIVIC_DEV_HUB=athens`). It covers: console routes unreachable on a hub
  host and hub routes unreachable on the console host; sign-in (stranger gets
  the same answer and nothing stored; HttpOnly SameSite=Strict cookie; code
  single-use; wrong code refused); the X-Civic-Console header and session
  gates; create (reserved slug with its purpose, first admin required, demo
  by default, serves at its hostname, audit row with the settings written);
  duplicate slug/hostname; edit (rename audited before/after; hostname move
  needs step-up, old hostname stays taken; no move into demo; a refused change
  does not spend the step-up code); plugins; admins (add freely, remove only
  with step-up, never empty); archive (step-up, suspended, slug and hostname
  stay taken, unarchive leaves it suspended); the audit log refuses UPDATE and
  DELETE even for the service role (42501); the audit view. Codes and
  sessions are planted as the service role (`tests/fixtures/consoleCall.ts`).
  Hubs it creates are archived in `afterAll` (they cannot be deleted: the
  append-only audit log references them), so `crons.test.ts` still sees only
  Floyd and Athens. Unit: `controlPlane.test.ts` (the MEETING_*/FLOYD_NEWS_*
  guard, reserved hostnames, one operator, which changes need step-up),
  `reservedSlugs.test.ts` (the database constraint's names ⊂ the one list,
  each with a purpose), `controlBoundary.test.ts` (the hub app cannot import
  `src/control/`). Local run 2026-09-26: 25 files, 249 passed, 5 skipped, in
  both modes; unit 1090.
- **Sample content (2026-09-26, Phase 7):** `sampleContent.test.ts` writes
  a sample process, its spawn, a real process, a sample author and a real
  resident straight into the local stack (service role), then checks the
  database on its own terms — every event of a sample process is stamped
  sample (a real resident's too), a process spawned from one inherits it,
  **a minted Athens hub token cannot delete a real event but can delete a
  sample one**, `hub_admin_audit_log` refuses UPDATE and DELETE even for the
  service role — and the app: sample events are off `GET /events` and
  `/activities/:id`, in `/api/feed` with `sample: true`, `is_sample` on the
  process read model; `/admin/hub/sample-content` is admin-only, counts real
  people's input, refuses removal without a fresh code (planted in
  `pending_verifications`), then removes exactly the sample rows and writes a
  `sample_content.remove` audit row. **It removes ALL of Athens's sample
  content**, so a locally seeded Athens is empty of samples afterwards.
  `sampleSeed.test.ts` creates two hubs through the console with
  `sample_content: true` — a Virginia county (all nine templates, "Board of
  Supervisors" inferred, names filled, no placeholder left, every event
  sample, `GET /events` empty, the feed all `sample: true`, a
  `hub.sample_seed` console audit row, then removal by its admin leaving an
  empty hub that serves, read back through `/control/hubs/:id/admin-audit`)
  and a school district (exactly the three templates that fit, "School
  Board") — and archives both in afterAll, like `control.test.ts`. Unit:
  `sampleContent.test.ts` (every hub table classified for removal/export; the
  row rule; per-hub sample ids; the templates use only the three
  placeholders, 8–10 for a general-purpose government, every vote has 2+
  options and ballots, the outcome matches its vote's ballots, the school
  district set; the governing-body inference). Local run 2026-09-26: API 29
  files, 290 passed, 7 skipped, in both modes; unit 96 files, 1124.
  `consoleRouting.test.ts` (2026-09-27, dev wildcard): every console
  hostname in use (`console.civic.social`, `console.dev.civic.social`,
  `console-civic-hub-dev.vercel.app`) matches both of `vercel.json`'s console
  rules and no hub hostname does — the page is routed there, not by
  `CIVIC_CONSOLE_HOSTNAME`. Unit total 97 files, 1128.
  `hubDeadEnd.test.ts` (2026-09-27, release-1 prep): which `/hub-config`
  answers make the static shell render the dead-end page instead of the app
  (404 `no_hub` → "No hub here", 503 `hub_suspended` → paused; any other
  failure renders the app on fallbacks), and the title the runbooks check.
  Unit total 98 files, 1132.
  **The post-cutover cleanup (`20260926005000`, 2026-09-27)** changed what
  `forHubIsolation.test.ts` pins: the test that the old global key refused a
  second hub's copy became three — each hub keeps its own copy of the same
  address in `pending_verifications` (upserts touch only their own), one
  address holds an account on two hubs (still one per hub), and a raw insert
  naming no hub fails `23502` instead of landing in Floyd; the deprecated
  unscoped `search_processes` is gone (`PGRST202`). API 29 files, 292 passed,
  7 skipped, in both modes, on a stack reset from scratch (where the cleanup
  runs before the four later migrations) and on one where it arrived out of
  order (`supabase migration up --include-all`). The migration was also run
  on a local copy of production's data, outside the suites (HANDOFF,
  "Release-1 prep").
  The no-hub page itself cannot be reached from
  the Vite dev server (its API fallback always lands on a hub); check it with
  a production-shaped build: `npm run build` in `ui/`, then `vite preview`
  with `/api` proxied to the server with the Host kept (`changeOrigin:
  false`, strip `/api`), and open `http://anything.localhost:<port>/`.
  **Running both modes locally** when :3000 is taken: `.claude/launch.json`
  (monorepo root) has `hub-local-3200` (service role) and `hub-local-3201`
  (hub tokens) on the local stack with CI's env; run with
  `CIVIC_API_BASE=http://localhost:320x CIVIC_EXPECT_HUB_DB_MODE=…
  CIVIC_TEST_CRON_SECRET=local-only-cron-secret
  CIVIC_TEST_DIGEST_SECRET=local-only-digest-unsubscribe-secret` (and
  `CIVIC_HUB_SIGNING_KEY` = the local JWT secret for the token pass). Without
  the two secrets the cron and digest tests fail 401, which is the env, not
  the code.
- **Hub export, import and restore (2026-09-26, Phase 5 part two):**
  `hubExportRoundTrip.test.ts` seeds a throwaway hub `rt-<hex>` straight into
  the local stack's Postgres (users, a vote under review with two turns,
  events, a comment, a link, ballots, a waitlist entry, a session, a live
  sign-in code, a secret-shaped setting, and two stored images — one under
  `<hub>/`, one in the legacy `hubs/<hub>/` folder), then drives the **real
  scripts** (`node --env-file=<tmp env> --import tsx scripts/…`): export (counts,
  README, `sessions` / `pending_verifications` / the secret setting left out);
  import refused while the hub exists, nothing changed; a database URL on the
  command line refused; the hub wiped (replica role) and imported back —
  counts, the importer's fingerprint check, `processes.review_id` across the
  cycle, image URLs rewritten onto the hub's prefix and resolving (200), the
  search index rebuilt, a `hub.import` audit row, and `/hub-config` answering
  at `<hub>.localhost`; a "mistake" then restore — refused without
  `--clear-append-only`, restored with it, `hub.restore` audit row with the
  before counts; finally `--no-images` into a **plain Postgres database**
  created in the same cluster from `supabase/migrations/` (no PostgREST, no
  Storage; roles are cluster-wide), dropped afterwards. It needs the stack's
  **Postgres port** (`CIVIC_TEST_DATABASE_URL`, default
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, local only) and
  Storage on. Test hubs stay behind (the audit log references them).
  Unit: `hubBundle.test.ts` (key order for every exported table; omitted
  tables and the secret-setting net, which no real key trips; image owner by
  the plan's rule and the landing key under the hub's prefix; legacy folders
  listed only for the migration-default hub; fingerprint ignores order and
  the search index, equates old-host and rewritten URLs; tar.gz round trip
  with a >100-byte path; a bundle the exporter writes passes the importer's
  self-check, a tampered row or image fails it; insert order breaks the
  processes ↔ process_reviews cycle at `review_id`; a URL on argv refused).
  Local run 2026-09-26, service-role server: 120 files, 1361 passed, 5 skipped.
  **Digest window (fix 6):** `tests/unit/digestRecordedAt.test.ts` — the
  digest keeps events RECORDED after the resident's cursor (`recordedAfter`),
  so a close stamped with a deadline before the cursor but recorded after it
  is mailed, and a future-stamped event recorded before it is not.
  **Console export and the sweep (step 4):** `hubExportConsole.test.ts` —
  `POST /control/hubs/athens/export` refused without a fresh code (nothing
  stored), not reachable on a hub hostname; with a code: the object lands in
  the private `hub-exports` bucket (its public URL does not serve it), the
  signed link downloads a `.tar.gz` whose manifest matches the response, and
  a `hub.export` audit row records key, size and fingerprint. Then the
  `hub_exports_sweep` platform job: an object aged 25 h (its
  `storage.objects.created_at` moved back in Postgres) is deleted, a new one
  kept, 401 without the cron bearer. The test reads the server's cron secret
  from **`CIVIC_TEST_CRON_SECRET`** (default `ci-only-cron-secret`, CI's
  value). `crons.test.ts` covers the sweep route's auth gate;
  `leakHarness.test.ts` skips it with its reason; `jobRegistry.test.ts` now
  checks hub jobs against `JOB_RUNNERS` and platform jobs against
  `PLATFORM_JOB_RUNNERS`.
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

- **Jurisdictions, plugins at creation, purge, platform postal address
  (2026-09-27):** `jurisdictions.test.ts` plants fictional reference rows
  (state `zz`) as the owner and checks the console: the state list, the
  type-ahead (name prefix first, then a later word; a bad type 400), the table
  read-only even to the service role; the slug suggestion's order (plain →
  `-county`/`-town` → `-zz` → `-2`, with what it passed over and why; a
  reserved name skipped); create from the list (OCD id stored, not custom; the
  list's display name when none is sent; several hubs on one jurisdiction,
  listed as information), custom (typed name, no id), and the refusals (a
  loose name with neither, an unknown id, custom with an id); editing a hub's
  jurisdiction (audited `hub.update` before/after; custom refused while an id
  stays). `hubPurge.test.ts` drives `scripts/purge-hub.ts` with an env file:
  a hub with one real resident is refused (exit 2, the resident named,
  nothing changed); an unarchived hub is refused; a console-made, archived,
  sample-only hub with one planted `hub_admin_audit_log` row: no `--confirm` =
  the plan only, a wrong `--confirm` refused, then the purge — every `hub_id`
  row and the `hubs` row gone, the `.tar.gz` holds the admin audit row, the
  `hub.purge` row's `before` equals the full `hubs` row, the earlier audit
  rows survive, and the console creates the slug again. `sampleSeed.test.ts`
  gains a hub created with Conversations off: all nine templates seeded, the
  conversation 404 and out of the feed while off, listed once on, and gone
  with the rest on removal even when switched off again.
  `hubExportRoundTrip.test.ts`: the hub's `jurisdiction_ocd_id` is in
  `hub.json` and survives import; the plain-Postgres import is refused while
  the target's list lacks the id, and succeeds once it has it.
  `hubAdminSettings.test.ts`: the Email section reports the address in use
  (`platform.postal_address`, source `hub`). The tenancy catalog exempts
  `jurisdictions` (`NOT_HUB_SCOPED`); `exportManifest.test.ts` counts 36
  tables. Unit `jurisdictions.test.ts`: slug candidates and their limits,
  names and codes from a row, reference → hub types, the state from an OCD id
  and the county default, the postal-address order (hub → legacy env →
  platform → none), what "redirects to this hub" means, the CSV reader. Local
  run 2026-09-27: API 31 files, 309 passed, 7 skipped, in both modes; unit 99
  files, 1143; Playwright 25/25.

- **Non-place legal text (2026-09-27, third part):** unit
  `jurisdictions.test.ts` renders every shared document for a non-place hub
  (the governing state from `{GOVERNING_STATE}`, no "resident"/"residents",
  "One person, one voice", the complaint line) and reads the default from
  `config/legal/defaults.json`; `hubDocuments.test.ts` knows
  `{GOVERNING_STATE}`; `hubKinds.test.ts` checks an organization's Terms name
  Virginia, then the state its admin saves in `legal.governing_state`. API
  32 files, 318 passed, 7 skipped, both modes; unit 99 / 1151.
- **Jurisdiction codes and hub kinds (2026-09-27, second part):**
  `hubKinds.test.ts` — a place hub still needs a jurisdiction (kind omitted
  or `place`); an `organization` hub with none works end to end (no OCD id,
  name, code, type or governing body; no sample template fits it; a
  jurisdiction type or governing body refused; `/hub-config` says
  `organization`; its documents name no place, state or government; a vote it
  creates is stamped `local`, its activities carry no `location`, its manifest
  no `jurisdictions`); an `issue` hub linked to Virginia gets `us-va`, reads as
  a campaign, may drop the place, may not become `place` without one; a second
  hub's (Athens's) new vote and its events carry Athens's own code, not the
  server's `CIVIC_JURISDICTION=us-va-floyd`. **Needs the jurisdiction list
  loaded** (CI's "Load the jurisdiction list" step; locally
  `node --env-file=<env with CIVIC_TARGET_DATABASE_URL> --import tsx
  scripts/load-jurisdictions.ts`) and the servers started with
  `CIVIC_JURISDICTION=us-va-floyd` (CI; `hub-local-3200/3201` in
  `.claude/launch.json`). `jurisdictions.test.ts` now also checks the derived
  code (`us-zz-<name>-town` at creation, unchanged on relink, a sent code
  refused, none for custom). Tests that create hubs with no place pass
  `hub_kind: "other"`; `sampleSeed.test.ts`'s county uses Floyd County's real
  OCD id under a test name. Unit `jurisdictions.test.ts`: the code rule
  (Floyd County `us-va-floyd`, the town `us-va-floyd-town`, a school district
  under its county, DC), hub kinds, the participant noun, templates by kind,
  and every shared document rendered for a non-place hub (no place
  placeholder, no "resident of", no "local government") and for a place hub
  (identical to the text before the sections). Local run 2026-09-27, on a
  stack migrated from production's history: API 32 files, 317 passed, 7
  skipped, both modes; unit 99 / 1149; Playwright 25/25.
- **Console and sample-content polish (2026-10-06):** `sampleSeed.test.ts`
  now expects eleven templates (a county; four for a school district, the
  word cloud added), the short form "Supervisors" / "School Board" on create,
  the hub page's `governing_body_short` edit reaching `/hub-config`, the
  sample meeting summary published with `is_sample`, times and no recording,
  the sample word cloud's 32 anonymous answers and its being chosen as the
  hub's word cloud (and the setting cleared again by removal), and the sample
  conversation's default Polis address. `hubAdminSettings.test.ts`: the
  `process` field kind (`plugin.wordcloud.onboarding_id` takes one of the
  hub's word clouds, refuses a vote's id or an unknown id, takes empty).
  `crons.test.ts`: a forced admin digest leaves one `job_runs` row on the hub
  it ran for (needs `CIVIC_TEST_CRON_SECRET`). E2E `feed.spec.ts`: the
  meeting-summaries pill carries the served `copy.governing_body_short` (local
  Floyd "BOS"; the old pill said "Board" everywhere). Unit
  `consolePolish.test.ts`: the short-form rule, the default hub name, the
  affiliation line and nouns by kind, the `process` field's validation;
  `sampleContent.test.ts` covers the two new template kinds. Local run
  2026-10-06: API 32 files, 326 passed, 7 skipped, both modes; unit 104 /
  1195; Playwright 26/26. E2E ran against an API on :3000 started from
  `hub-e2e-1006` in `.claude/launch.json` (hub tokens on, localhost → Floyd).
  Same day, second pass: `sampleSeed.test.ts` stores the create form's
  `timezone` and refuses one that is not a zone (no hub made); unit
  `consolePolish.test.ts` checks the state → time-zone map (51 entries, every
  zone valid). API 327 passed, 7 skipped, both modes; unit 1197; Playwright
  26/26. To walk the console's web-address field locally the console needs a
  parent domain: `hub-local-3210` in `.claude/launch.json` runs with
  `CIVIC_CONSOLE_HOSTNAME=console.civic.localhost` (platform domain
  `civic.localhost`).
- **Plugin switches, end to end (2026-10-07):** `pluginToggles.test.ts`
  gained a block that walks **every plugin id** (a table, `PLUGIN_CASES`,
  checked against the 14 ids) on Athens: switched on, then off, then put back
  as it was (the stored row if there was one, else no row). Per plugin, as
  applies: one of its routes answers 404 off and not 404 on; its job is
  skipped for Athens; for each of its process types creation is refused,
  search leaves it out (hits and `total`), links leave it out (the anchor's
  links, its own links 404, link candidates), discovery leaves it out; the
  admin digest's section count is 0 off and above 0 on (the digest run now
  returns `counts` per section). Fixtures are inserted straight into the local
  stack (one public process per type, a unique word in the title, plus a
  link), and deleted after. Two more blocks: the Code of Conduct check
  (`/assistant/:type/drafts/:id/review`) still answers with the Writing
  assistant off while `/message` and `/suggest` 404; a pending review of a
  switched-off type is gone from the admin queue and the creator's list,
  cannot be approved, and comes back (and approves) with the plugin. Unit
  `pluginSwitches.test.ts`: `enabledProcessTypesAmong`, the needs-setup rule
  (`src/shared/pluginSetup.ts`), and the UI's pure gating
  (`ui/src/config/pluginRules.ts`: onboarding target, search chips). E2E
  `pluginSwitches.spec.ts`: Projects switched off in Settings leaves the tab
  strip on in-app navigation with no reload (a marker on `window` survives),
  and back; with the Writing assistant off a vote draft shows no "Get
  suggestions" but "Run Code of Conduct check" still runs and the draft
  reaches "Ready to submit"; a new sign-up on a demo hub with Word clouds
  off (and an onboarding cloud named) stays on `/` with no "Page not
  found". It acts on whichever hub `localhost` resolves to, as its admin
  (session written into the local stack, terms accepted), skips the sign-up
  on a hub not in demo, and puts every setting back in `afterEach` (so a
  timed-out test cleans up too). **Every spec now reads the API from
  `tests/e2e/hubApi.ts`** (`CIVIC_E2E_API_BASE`, default `:3000`); three
  specs had `http://localhost:3000` written in, which failed
  `ECONNREFUSED` against any other server. `feed.spec.ts`'s pill check also
  skips where the pill is rightly gone (Meeting summaries off, or needing
  setup with nothing to show).
  **Order matters less than it looks:** Vitest runs files by cached
  duration and size, not by name. `leakHarnessDb.test.ts`'s vote fixture
  (never deleted) lacked `state.options` and answered 500, failing
  `processes.test.ts` whenever it was the newest vote; fixed. Running the
  API layer more than twice in 15 minutes trips the step-up lockout
  (`sampleContent.test.ts`: "Too many incorrect attempts"), and many runs on
  one stack fill Athens's admin-digest `job_runs` to its cap of 60
  (`crons.test.ts` then counts no new row). Both are local residue; CI runs
  two passes on a fresh stack.
  Local run: API on :3230 from `plugins-api-3230` in the monorepo's
  `.claude/launch.json` (CI's env, service role); the UI as a production
  build behind `vite preview` on :4194 (`/api` proxied to :3230, Host kept),
  Playwright with `baseURL` :4194 and
  `CIVIC_E2E_API_BASE=http://localhost:4194/api`. Result 2026-10-07: API 32 files,
  402 passed, 7 skipped, both modes; unit 106 / 1210; Playwright 28 passed,
  1 skipped.
- **Email and job reporting (2026-10-07, second session):**
  `tests/api/heldBackAndQueues.test.ts` runs on Athens (seeded `demo`) with
  an official added to the officials list and the hub-wide brief recipients
  (both put back in `afterAll`): brief approval and vote-results publishing
  to that official answer 200, publish, record the official under
  `held_back` with "this hub is in demo mode", and the public brief has no
  "Sent to" receipt; a vote closes **finalized** with Briefs off (one
  `result_published`, no brief) and **closed** with a pending brief with it
  on; the admin digest's `counts.reviews` / `counts.briefs` (and `briefs`
  is 0 while Briefs is off; there is no `vote_results` count any more). Two
  blocks run in-process in the server's mode (as `leakHarness`'s digest
  does): the resident digest with a key set and Resend intercepted (every
  other `fetch` goes through), so held-back residents come back as
  `held_back_count` with `failed_count` 0 and `describeJobRun` "ok"; and
  `findBrokenPublications` over archived, deleted, published and genuinely
  pending summaries, which reports only the pending one.
  Unit: `heldBackDelivery.test.ts` (approveBrief records, the admin's
  sentence), `demoPrivilegedSignIn.test.ts` (the real `requestVerification`
  through the real guard with `fetch` stubbed: an official on a demo hub is
  sent their code; anything else to them is still held back; fails without
  the change), `mailer.test.ts` (the report), `jobRunDescribe.test.ts` (every
  new wording), `jobRunVisibility.test.ts` (an archived summary stops the
  real run from re-summarizing the meeting; fails without the change),
  `feedHealth.test.ts` (archived and missing are no longer broken),
  `meetingSummaryAlarm.test.ts` (an empty discovery no longer alerts),
  `adminFeedbackDigest.test.ts` (the two new sections render).
  **Changed on purpose:** `crons.test.ts` now checks for a newer
  `job_runs` row instead of counting rows (the count stops at the 60-row
  cap on a stack that has run the suite a few times; this file's two
  forced admin digests reach the cap sooner). `pluginToggles.test.ts` no
  longer checks the dead vote-results digest section.
  **Known local flake, not new:** `hubSettings.test.ts`'s banner check
  can fail when it runs within 60 s of `leakHarness.test.ts`, which writes
  Floyd's banner straight to the database; the database is right, the
  server is serving its cached copy (the settings cache, review #1a/#14).
  **Third part (votes finish at close; 45-day quiet source):** the
  deadline-close tests in `atomicFunctions` and `pluginToggles` expect
  `finalized`; `jobRunVisibility.test.ts` pins Date to 2026-10-07 (fake
  timers, Date only) so its 2026-09-22 fixture never trips the 45-day flag,
  and one test moves the clock to 70 days to see the flag from the real run.
  `getEventsSince` now pages: a local stack with more than 1,000 events in a
  day (a few suite runs) had made `leakHarness`'s digest miss its marker.
  Result after: API 408 passed, 7 skipped, both modes; unit 1243.
  `finishStuckVotes.test.ts` runs the stuck-vote script's logic in-process
  (both modes): a dry run writes nothing; `--apply` finishes a closed vote
  with no brief (tally, `results_at_close` result and `process.updated`
  both stamped at its close time, a feed card) and leaves a closed vote with
  a brief alone. The local stack's `proc_rlsdb_athens_*` rows (`closed` row,
  `active` state, from `leakHarnessDb`) are reported as skipped, not forced.
  Result 2026-10-07: API 33 files, 408 passed, 7 skipped, both modes; unit
  108 files, 1232 passed; Playwright 28 passed, 1 skipped (production build
  behind `vite preview` on :4195, `/api` → :3230).
  **Event reads past 1,000 rows (2026-10-07, fourth part):**
  `eventReads.test.ts` makes its own hub (`bulk-<run>`, inserted straight
  into `hubs` with an admin roster row) and seeds ~1,500 events: 1,100 open
  votes, 400 ballots on the newest, three moderation actions and a broken
  publication as the oldest event. It checks a page load is one page of 25
  cards with a cursor; that the feed's pages, followed to the end, hold all
  1,100 vote cards once each, newest first, the oldest included; that
  `?surface=` and `?process_id=` page too, and a bad cursor or surface is a
  400; that the moderation log has all three actions; that feed health finds
  the oldest publication; and that an unbounded `select` on the hub's events
  throws `CIVIC_ROW_CAP` while `readAll()` returns every row (both
  in-process, in the server's mode). Events are append-only, so the hub
  stays: it is suspended at the end. Changed on purpose:
  `sampleContent.test.ts` reads its planted `process.updated` events by
  `?process_id=`, since the feed's page now holds cards only.
  **Local note:** running the service-role pass and then the token pass
  back to back can trip the sign-in lockout (`Too many incorrect attempts`)
  in `sampleContent`'s fresh-code step: the first pass's wrong-code tests
  lock the address for 15 minutes. Clear `pending_verifications.locked_until`
  on the local stack between passes (CI's database is fresh each pass).
  Result: API 35 files, 419 passed, 7 skipped, both modes; unit 109 files,
  1258 passed; Playwright 30 passed, 1 skipped (dev UI on :5173, API
  `hub-e2e-1006` on :3000). Load as you scroll (same day): Playwright 31
  passed, 1 skipped.
- **Wording by kind and place (session 3a, 2026-10-07).** New
  `tests/unit/hubWording.test.ts`: for a county, a town, a school district,
  an organization and an issue campaign, the welcome strip, tagline, intro
  and beta bar carry no placeholder and no other kind's wording, and the
  legal pages (rendered through `hubDocumentsWithNotes` under `runWithHub`)
  have every placeholder filled and no draft note. Also the article rule
  (`theName`, `fillSampleText`, the sign-in email), `fitSlug`, the Selectboard
  default, the brief pill, the sign-up return path (`safeReturnPath` refuses
  `//`, `/\`, schemes) and the extended place-name patterns. New
  `tests/e2e/signupWording.spec.ts` (demo hubs only): the code step says
  "Enter any six digits" and the checkbox "I'm trying this demo"; signing up
  from a vote casts it, goes through the onboarding word cloud, and Skip
  returns to the vote. `tests/api/auth.test.ts`: a demo hub's request-code
  answers `no_email: true`. Results: unit 110 files, 1291; API 35 files,
  420 passed, 7 skipped (hub-token pass); Playwright 34 passed, 1 skipped.
- **Samples stay current, every kind, demo submissions (session 3b,
  2026-10-07).** New `tests/unit/sampleRefresh.test.ts`: every place type and
  every other kind gets the required mix (open vote, vote gathering
  endorsements, closed vote with its outcome, proposal, conversation) across
  all eight plugin types; non-place sets name no place, governing body or
  residents; every sample summary has minutes; `refreshReason` (window,
  left-its-phase, the closed vote never); the job's run description; and
  `draftPassedCodeOfConduct` (never run, unavailable, hard block, changed).
  `sampleContent.test.ts`: every child table is either counted as real input
  or named in `NOT_PARTICIPATION` (R46), and `review_turns` follows its
  review. New `tests/api/sampleRefresh.test.ts` (console-made hubs, archived
  after): organization and issue sets; the summary serves `sample_minutes`;
  the job (`/internal/sample-refresh/run?hub=`) replaces a vote closing
  tomorrow, a proposal closing in two days and an endorsement vote that was
  opened, under the same ids, taking a visitor's ballot row with it, leaving
  the closed vote's row untouched, recording one `job_runs` row and none when
  idle; a beta hub is skipped; "Refresh samples" adds all eleven to an empty
  demo hub, backfills minutes, and refuses a live hub; a visitor's proposal
  publishes on demo after a passed check (stored `is_sample` +
  `added_in_demo`, no badge, in the feed), waits for review when the check
  was unavailable, and waits on beta and live; removal counts project
  comments, reactions and visitors' items and deletes their reviews and turns
  (the new `review_turns` guard), while a real review's turn stays
  append-only. New `tests/e2e/sampleSummary.spec.ts` (demo hubs with the
  sample summary; Meeting summaries switched on and put back): the demo bar's
  refresh line, "Read the minutes" shows the text, "Watch recording" shows the
  note and does not navigate. Changed on purpose: `sampleSeed.test.ts` (the
  school district's own set), `hubKinds.test.ts` (an organization gets its
  set), `hubAdminSettings.test.ts` (`{THE_HUB_NAME}` in the templates),
  `leakHarness.test.ts` (the new cron route skipped like `vote-close`),
  `jobRegistry.test.ts`, `jurisdictions.test.ts`.
  **Follow-up (Adam's conditions on the review-history guard):**
  `sampleContent.test.ts` gains "review history":
  - turns are stamped from their review's process, and a client-sent
    `is_sample` on a real turn is overridden;
  - the hub-token role deletes a sample turn;
  - a real turn is refused for both roles, directly and through its
    review's cascade;
  - turning a turn's marker or a real process's `is_sample` /
    `added_in_demo` on is refused (`processes_marker_guard`);
  - removal takes the sample review's remaining turn.
- **Handing a hub over (session 4, 2026-10-08).** New
  `tests/unit/handover.test.ts`: the console owns what residents see only in
  demo; every handover key is also on the hub's Settings page; the console's
  PATCH refuses `mode` and the governing body; `renameFollowers` (followers
  that still read the old name follow, one made someone's own does not);
  `describeFollowOn`; create's `ownership` validated in plain words;
  `parseHandoverPatch`; `movedHostnames`; the page shell's
  `movedToFromResponse` (http(s) origins only); the feedback address's
  fallbacks and that the key is public; the invite's subject, links, mode line
  and escaping. `tests/unit/hubResolver.test.ts` gains "moved hubs": 301 from
  an old address with path and query, 308 for a write with the `/api` prefix
  kept, `hub_moved` for the shell's `/hub-config`, an unused address still
  "no hub", `redirect_to`, and a malformed `redirect_to` is never a Location.
  `tests/api/control.test.ts` (changed on purpose): create with ownership
  details (served publicly where public; postal address not), the first
  admin's invite; a console rename on a demo hub carries to the site and the
  from-name and leaves a custom operator; the mode and plugins writes answer
  409; adding an admin needs a fresh code and invites only the one added; new
  "handover": the panel edits a demo hub and a new hub name carries (registry
  too), a bad value is refused in plain words, a moved hub's old address
  redirects (301 with `Location`) and the shell gets `hub_moved`, and after
  the hub leaves demo the panel answers 409 and a rename says what it did not
  change; "Refresh samples" returns titles with no placeholders left. New
  `tests/api/handover.test.ts` (a console-made hub, archived after): hub
  Settings says the platform may also edit during demo and names console
  writes "the platform operator"; a Settings → Identity rename carries to
  the operator, from-name and registry, and not to an operator made the
  admin's own; `plugin.feedback.contact_email` round-trips and is public;
  adding an admin in hub People invites the new one only; the note goes
  after demo. Changed on purpose: `sampleSeed.test.ts`, `hubKinds.test.ts`,
  `jurisdictions.test.ts` (the governing body is read from `handover`, the
  board label edited through the Handover panel, Conversations switched on
  through the hub's Settings), `controlPlane.test.ts` (mode no longer a
  console step-up), `jobRunDescribe.test.ts`, `meetingSummaryPrompt.test.ts`,
  `waitlistNotification.test.ts` (the hub's noun and name). New
  `tests/e2e/handover.spec.ts`: the Feedback page shows the platform's
  address, then the hub's own once set; Settings → Copy says "Board label";
  the console's Handover panel saves a rename and a postal address, says what
  followed, and shows mode and plugins read-only with links.
  `sampleSummary.spec.ts` reads the shorter demo bar. Needs the migration
  `20261008000000` on the local stack (`supabase migration up --local`).
  **The demo specs need `CIVIC_DEV_HUB=athens`** on the e2e API (launch
  config `hub-e2e-1008-athens`): without it `localhost` is Floyd (beta) and
  five specs skip. Running `tests/api` twice within 15 minutes locks out
  `admin+athens@example.test` (the wrong-code tests), which fails
  `sampleContent.test.ts`'s removal; clear `pending_verifications.locked_until`
  for that address, or wait. Results: unit 112 files, 1,332; API 37 files,
  450 passed and 7 skipped, both modes (449 in the full run plus
  `sampleContent.test.ts` rerun on its own after the lockout above); Playwright 37 passed, 2 skipped (the
  feed pill while Athens has Meeting summaries off, and, until Athens's
  samples are reseeded after the API run removed them, the demo-bar spec).
- **Invite codes and the start page (session 4b, 2026-10-08).** The API
  server needs **`CIVIC_START_HOSTNAME=start.localhost`** as well as the
  console's two variables (CI sets all three), and the migration
  `20261008010000` (`supabase migration up --local`).
  - New `tests/unit/startPage.test.ts`:
    - codes are `XXXX-XXXX-XXXX` without misread letters, never repeat, and
      read loosely (case, spaces, O→0, I/L→1);
    - the hash never contains the code;
    - status order (revoked, used, expired, unused);
    - mint defaults (14 days, 1–90);
    - the start host is its env var only (unset = none), its parent
      domain, and `startCreateBody` fixing demo, the address and the admin;
    - `start` is reserved.
  - `consoleRouting.test.ts` now also holds `vercel.json`'s two start-page
    rules to the start hostnames, and checks they come before the hub
    catch-all.
  - `exportManifest.test.ts` counts 42 tables (the five new ones are
    platform data, not exported).
  - New `tests/api/startPage.test.ts` (fixture `tests/fixtures/startCall.ts`;
    each test uses its own made-up `X-Forwarded-For`, so the hour's
    rate-limit buckets start empty on every run; hubs archived after):
    - **Routing:** the start routes are 404 on a hub's and the console's
      host, and hub and console routes are 404 on the start host.
    - **Requests:** writes need `X-Civic-Start`, and the steps need a session.
    - **Codes:** mint (shown once, hashed, audited), list (no code, no hash),
      revoke (once, audited), console session required.
    - **Refusals:** wrong, malformed, expired, revoked and used codes all
      get the same 403 and message.
    - **Rate limits:** 10 codes per IP; 5 sign-in codes per address from any
      IP; 6 per IP; hashed buckets; 5 wrong sign-in codes lock the address.
    - **Happy path:** the creator is the only admin and the contact, the
      operator is as typed, the code is used with a redemption, the audit
      rows have the creator as actor, the start session ends, and the handoff
      gives an admin session once.
    - **Handoff limits:** it is refused as a bearer token, on another hub,
      after it expires, and for an ordinary token.
    - **Failed creates** (reserved slug, taken slug, a place with no place)
      leave the code unused, and it works after.
    - **Fixed by the server:** mode, address and admin sent by the form are
      ignored.
    - **Races:** two racing creates make one hub (201 and 403).
    - **Revoked after sign-in:** refused, and the page is told.
    - **Second code:** one person redeems a second code (Adam).
    - **Sign-in first:** the form refuses a session not yet signed in.
  - New `tests/e2e/startPage.spec.ts`, Adam's first use:
    - the console mints a code, shown once, and lists it unused;
    - on the start page a wrong code gets the generic message, then the real
      one typed in lower case is accepted, followed by the sign-in;
    - the form picks a listed county, sees the suggestions, sets the address
      and operator, and creates;
    - the browser lands on `<slug>.localhost` with the fragment stripped,
      with a session in which it is admin;
    - the console then shows the code used, by whom, with the hub linked,
      and no Revoke.
    - Another test checks the start page fits 375 px.
  - **The e2e spec needs one origin for hub, console and start page with
    `/api` proxied, keeping Host:** a production build behind `vite preview`
    (`proxy: { '/api': { target: 'http://localhost:<api>', changeOrigin:
    false, rewrite: p => p.replace(/^\/api/, '') } }`). Run it with
    `CIVIC_E2E_UI_ORIGIN=http://localhost:<preview port>` and
    `CIVIC_E2E_API_BASE=http://localhost:<preview port>/api`, with the API's
    `CIVIC_UI_BASE_URL` set to the same origin (the handoff link's port).
    The Vite dev server can't do this: the hub app calls `localhost:3000`
    directly there.
  - **Changed on purpose:** the console's `listHubs()` now pages with
    `readAll()`. The local stack had 1,049 hubs from test runs, and the
    console's list (so `control.test.ts` "lists it") stopped at
    PostgREST's 1,000.
  - Results: unit 113 files, 1,351; API 38 files: hub token 473 passed, 7 skipped; service role 472
    passed, 7 skipped and the `listHubs` failure above, `control.test.ts` 27/27 after the fix;
    Playwright 39 passed, 2 skipped (the same two as before).
- **Ballot secrecy against the raw data (2026-10-10):**
  - `ballotSecrecy.test.ts` holds the raw data the way an operator or a stolen backup would, after a run of votes and
    changes through the app. It needs the local stack's Postgres (`CIVIC_TEST_DATABASE_URL`, default local; refuses any
    other host) and runs `scripts/export-hub.ts --from-postgres --no-images` for Floyd. It checks:
    - no bridge row left, and no row in **any** `public` table holding a voter's id and a receipt;
    - no ballot time, and no participation or event time inside a ballot row;
    - the ballots share one `xmin` (the close's reshuffle) and none with a participation row or event;
    - heap order does not reproduce cast order, and positional pairing with participation does not reproduce who cast
      what;
    - the export has no line with a voter and a receipt, no ballot time, and ballots in receipt order;
    - the change key is stored only hashed.

    And the app's side:
    - a change with the receipt keeps it;
    - without it, 400 `already_voted` with the "browser where you voted" message;
    - a wrong key or another voter's receipt gets `receipt_not_accepted`;
    - an early voter (cast through the legacy `cast_vote`) collects a key once via `POST /votes/:id/claim-receipt`;
    - one participation row and one ballot per voter, and the tally is everyone's final choice;
    - POST verify works; the old GET is 404.
  - `ballotSecrecyCatalog.test.ts` runs `tests/fixtures/ballotSecrecyRules.ts` on the real catalog: no person, time,
    clock or sequence default on `vote_records`; no receipt column outside it (and the retired bridge); nothing new
    writing `active_vote_keys`; `cast_ballot` not touching it. It also checks the database refuses a timed ballot.
  - Unit `ballotSecrecyRules.test.ts` proves each rule fails on the change it stops, plus static guards: no
    `.eq("receipt_id")` or `receipt_id=eq.` in `src/`, no `getActiveChoice`, no `cast_vote` rpc, no `?receipt=` in
    `ui/src`, and the vote log line names no voter.
  - `atomicFunctions.test.ts` and `leakHarnessDb.test.ts` now drive `cast_ballot`; the latter adds `reshuffle_ballots`,
    `claim_vote_key` and `ballot_by_receipt` under an Athens token against Floyd.
  - `leakHarness.test.ts`: POST verify and claim-receipt are in the write plan, and Floyd's receipt is posted against
    Athens's vote.
  - E2E `voteReceipt.spec.ts` covers vote, reload (the choice comes from the held receipt), change with the same
    receipt, the `#receipt=` link, and a fresh browser told its vote is counted with no buttons. The fix for sign-up
    from a vote keeping its receipt is covered by the existing `signupWording.spec.ts`.
  - Results:
    - unit 114 files, 1,362;
    - API 40 files, 494 passed and 7 skipped in each mode (service role on `start-api-3240`, hub token on
      `start-api-3241`). The `sampleContent.test.ts` removal hit the known admin+athens lockout on the second full run
      and passed 17/17 in both modes rerun alone after clearing `locked_until`.
    - Playwright on `hub-e2e-1008-athens` + `hub-ui-5173`: 38 passed (with `signupWording` after the fix), 2 skipped, and `startPage.spec.ts`'s two tests
      failing because that setup is not the preview-build one they need (above). Not run in it; the start page is
      untouched.
  - The full-suite runs came before two small changes: the schema-contract column and the VotePanel account fix.
    Re-run after them: unit, `/health`, and the two vote specs.
- **CI fix and function grants (2026-10-12):**
  - **`api-tests` was red from `26eb49d` to `cd1729a`**, on one thing: `events.test.ts > GET /activities/:id` in the
    first (service-role) pass. It read `/events?page=true&limit=1` and took item 0. A page is filtered after its
    read, so it comes back empty, with `next` set, when the newest event is restricted or its process is withheld
    (§6.1). Which event is newest depends on the file that ran before; on a fresh database (CI's first pass) it
    was a hidden one. Now `newestVisibleActivity()` follows `next` until a page has an item.
  - **`ensureSeedData()` checks its answer.** It answers 409 `reseed_blocked` once any review exists on the hub
    (`review_turns` is append-only), which is nearly always, locally and in CI; that is accepted. Any other
    non-200 now fails the test instead of passing unnoticed. Don't write a test that assumes the seed's own events
    are the newest.
  - **New:** `tests/api/functionGrants.test.ts` (migration `20261012100000`), read from the catalog with
    `has_function_privilege()`, never by calling: PUBLIC and anon can run no function in `public` unless it is on
    `ANON_ALLOWED` (empty); `authenticated` and `service_role` can run exactly the migration's lists; a new function
    gets EXECUTE for no one but its owner. **A migration that adds a function grants it by name** and adds it to the
    lists in that test.
  - **The ten-simultaneous-ballots flake** (`auditConcurrency.test.ts`, hub-token mode) did not recur: alone 6/6,
    full hub-token passes 3/3 here, and every CI hub-token pass has been green. Kong's "invalid response from the
    upstream server" is what an in-flight request gets when Postgres restarts. In Audit 4 that happened because a
    test was calling a refused function (the local image segfaults); that test was fixed before commit. If it
    recurs, check `docker logs supabase_db_civic-hub` for "terminated by signal 11" first.
  - **Results:** unit 125 files, 1,463 passed; API, service role and hub tokens: 47 files, 575 passed and 7 skipped
    each; type-check and lint clean.
- **Audit 4, errors, tooling and the health check (2026-10-12):**
  - **New tests:**
    - `tests/api/auditDrafts.test.ts`, "a failed auto-approval leaves the submission in the queue" (guards `33b65b8`).
      A trigger on the test's own rows (title `Autofail <run>`) makes a vote's "propose" step fail. The admin's
      submit still answers 201 with `auto_approved: false`, one review waits as `pending_review`, and the draft
      stays `submitted`. A second submit is 409 `already_submitted`. It fails on the code before `33b65b8`.
    - Unit `functionContract` checks three things:
      - every `.rpc()` in `src/` and `api/` names a listed function, and every listed one is called;
      - the newest migration definition of each has exactly the listed arguments;
      - `compareFunctions()` reports missing, mismatched and overloaded functions.
    - Unit `errorResponse` checks:
      - status from the type, never from the text;
      - no database text in a 500;
      - the log has the full error, and `reportError` has a redacted line with the route pattern;
      - Retry-After, streams, and `redactValues`.
    - Unit `envConfig`: read at access time, empty is unset, and the dev flags are refused in production.
    - `tests/api/health.test.ts`: `/health` counts the functions. In a rolled-back transaction it finds a function
      left at Audit 2's arguments and a second version of another. It also checks `function_catalog`'s grants.
  - **Status changes the suites now pin** (BUILD-PLAN "Error responses"):
    - a second submit is 409 `already_submitted`, whether or not the first has finished;
    - a closed vote is 409 `vote_closed`, and so is `already_voted`;
    - a conversation action from the wrong status is 409;
    - a sign-in lockout is 429 `locked_out`, and a closed beta is 403 `beta_closed`;
    - with no `ANTHROPIC_API_KEY`, the assistant answers 503 `ai_not_configured` (it was a 500 carrying the
      variable's name, which the UI matched on);
    - hub resolver answers carry the code in `code` (`no_hub`, `hub_moved`…) and a sentence in `error`.
  - **Do not call a function as a role that may not execute it, on the local stack.** On
    `supabase/postgres:17.6.1.111` (CLI 2.110.0), "permission denied for function" kills the backend with signal 11,
    and the whole database restarts. This happens through PostgREST and in plain SQL alike, and for older functions
    too (`tenancy_catalog`, `rate_limit_take`). A denied table read is fine. Mid-suite it shows up as
    `PGRST001`/`PGRST002` 503s and "the database system is not accepting connections" in unrelated files. Check
    grants with `has_function_privilege()` instead. Whether hosted projects behave the same is open (Audit 4
    report).
  - **Playwright without a scratch config.** `playwright.config.ts` takes `CIVIC_E2E_BASE_URL`, and
    `ui/vite.config.ts` proxies `/api` in `vite preview` to `CIVIC_PREVIEW_API`. Locally:
    - start `audit3-api-3270`, then `audit4-ui-5280` (`.claude/launch.json` at the monorepo root);
    - run `CIVIC_E2E_BASE_URL=http://localhost:5280 CIVIC_E2E_UI_ORIGIN=http://localhost:5280
      CIVIC_E2E_API_BASE=http://localhost:5280/api CIVIC_API_BASE=http://localhost:3270 npx playwright test`.
    - CI does the same on :4173 (`.github/workflows/e2e.yml`).
  - **Results:**
    - lint, unit and API with the service role: 171 files, 2,035 passed, 7 skipped (unit 125 files);
    - API with hub tokens: 46 files, 571 passed and 7 skipped. One of ten simultaneous ballots got the local
      gateway's "invalid response from the upstream server" in two of three full passes, and the file passed alone
      three times (seen once in Audit 3). One full pass also had the console refuse to create a sample hub, which
      did not recur;
    - Playwright: 49 passed, 2 skipped;
    - type-check of tests, scripts and `api/`: 0 errors;
    - UI lint: 0 errors;
    - `npm audit`: 0 in both packages.
- **Audit 3, concurrency and one drafts system (2026-10-11):**
  - **New suites:** `tests/api/auditConcurrency.test.ts` (twelve readers, the list and an admin's close at once on
    an expired vote: one `ended`, one `result_published`, one brief; two admin closes; a ballot after the deadline
    through the app and straight at `cast_ballot`; ten ballots at once; ten endorsements at once; six crossing the
    threshold together open the vote once; endorse and withdraw racing; `transition_process` refusing a stale status
    or version and writing no event; the one-brief index). `tests/api/auditDrafts.test.ts` (each of the four kinds:
    owner-only create/read/edit/list, 401s signed out, the one Code of Conduct gate, five submits at once make one
    review; a failed conversation submit releases its draft; the `prjdraft` prefix; the one-review index, in a
    rolled-back transaction). Unit `actionScope`. E2E `drafts.spec.ts` (each kind created end to end on its page).
  - **Direct DB rows:** `auditConcurrency` inserts bare brief rows to test the index. They are `archived` and deleted
    in `afterAll`: a bare `active` brief with no `content` makes every process list on that hub answer 500 (the
    first run did exactly that to most of the suite).
  - **PostgREST retries SQLSTATE 40001 by itself, for ever.** A database function that refuses with 40001 makes the
    request loop until the pool is exhausted (every later request 401s "Invalid or expired session"). Refuse with
    P0001 and a message; `transition_process` does (`process_changed`).
  - **Local duplicates before the index:** a stack that ran the suites before this change has duplicate briefs
    (the race). `supabase migration up --local` fails on the index until they are removed (HANDOFF, "Found on the
    way").
  - **Playwright** as for Audit 2, on a preview build at :5280 proxied to :3270 (`CIVIC_UI_BASE_URL` of the audit3
    servers in `.claude/launch.json`), with a local config overriding `baseURL` and dropping `webServer`.
  - **Results:** unit 122 files, 1,411. API 46 files: 568 passed, 7 skipped in each mode (service role: `leakHarness` and `auditConcurrency` rerun alone after the
    list-route plans were added; part one alone: 45 files,
    553). Playwright 49 passed, 2 skipped. Once, under the full run, one of the ten simultaneous ballots got
    "An invalid response was received from the upstream server" from the local gateway; three reruns passed.
- **Audit 2, sign-in and abuse (2026-10-11):**
  - **Rate limits and the suites.** Sign-in, console and assistant limits count per client IP in the database,
    and every server in a run shares them. Locally the API takes `X-Forwarded-For` as given, so every request
    fixture sends a fresh made-up address (`freshTestIp()` in `tests/fixtures/helpers.ts`, used by `api()`,
    `call()` in `hostCall.ts`, `consoleCall()` and the local `call` helpers in `loginHardening`, `hubPeople`,
    `sampleContent`), and `playwright.config.ts` claims one address per run (`extraHTTPHeaders`). A test of a limit
    passes one address on purpose. A new file with its own request helper must do the same, or it fails 429 once
    the loopback address has used its hour. `CIVIC_RATE_LIMITS=off` exists for local work; the suites do not need it.
  - **Codes and sessions are hashed.** Plant a hub code with `plantHubCode(hub, email, code)` and mint sessions
    with `mintSession` / `mintDemoSession` (`tests/fixtures/adminSession.ts`); never write `pending_verifications.code`
    or a plain `sessions.token` (constraints refuse both).
  - **New suites:** `tests/api/auditSignIn.test.ts` (two console-made hubs, demo and beta: hashed storage, 20
    concurrent wrong guesses spend exactly 5 attempts, 6 concurrent right codes sign in once, the per-IP, per-address
    and cross-hub limits, the console's and start page's attempt functions under concurrency, a demo session never
    privileged, the three triggers, leaving demo); `tests/api/aiLimits.test.ts` (console defaults and overrides, a
    hub admin cannot set them, the message cap, the per-person count, the spent budget; no paid call: the test
    servers have no key, so a counted call answers 500); `tests/api/auditHardening.test.ts` (seed is an admin's
    POST; headers on the API). Unit: `aiLimits`, `securityHeaders` (vercel.json equals the shared headers),
    `reviseFields`, `ssrfGuard` (address forms, pinning, the size cap). E2E: `securityHeaders.spec.ts`.
  - **The CSP in Playwright.** `vite preview` serves the security headers (`ui/vite.config.ts`); the dev server
    cannot. Run the suite against a production build: `npm run build` in `ui/`, then `vite preview` on :5240 with
    `/api` proxied to the API (Host kept), then `CIVIC_API_BASE=http://localhost:<api>
    CIVIC_E2E_API_BASE=http://localhost:5240/api CIVIC_E2E_UI_ORIGIN=http://localhost:5240 npx playwright test`
    with `baseURL` http://localhost:5240. Against the dev server `securityHeaders.spec.ts` skips and says why.
    :5240 because the CI-env API servers name it as `CIVIC_UI_BASE_URL` for the start page's handoff.
  - **Running both modes back to back.** `loginHardening` locks `admin+athens@example.test` for 15 minutes; clear
    its `pending_verifications` row between the two passes.
  - **Results:** unit 121 files, 1,407; API 44 files, 543 passed and 7 skipped in each mode; Playwright 43 passed,
    2 skipped.
- **Audit 1, live exposure (2026-10-11):** within one hub, what visitors and residents must not see or do.
  - New `tests/api/auditLiveExposure.test.ts` (Athens; switches Meeting summaries on for the file and back; archives
    every row it inserts so no later suite lists a bare row):
    - **A2:** search as a visitor, a resident and an admin finds no pending brief, no approved-but-unpublished vote
      result, no pending meeting summary, no admin notes on them, no moderation reason and no recipient email;
      a published brief and a published summary are found by their public text (the controls).
    - **A3:** for every registered type, a resident calling a non-resident action (Polis: start, close, poll_state,
      regenerate_summary) gets 403 and the row is untouched; an admin gets the handler's status rule instead.
    - **A4:** a never-checked draft is refused; `skip_modified_flag` from the client is ignored; a text change written
      behind the flag's back is caught by the hash; a links-only edit keeps a passed check; a live project edit with
      an unavailable check is refused.
    - **A8:** hide/restore of an anonymous comment writes no author id (a named one still does);
      `/events?context=`, `/activities/:id` and `/api/feed?process_id=` serve nothing for an archived or
      pending-review process, to anyone; `POST /reviews/submit` is 404.
    - **C2:** a visitor's and a signed-in resident's `/events`, `/activities/:id` and `/api/feed` carry no raw account
      id; an admin's do; a resident is one token within one process.
  - New unit files: `residentActions.test.ts` (each type's list, no lifecycle action on any, Polis status per
    action), `codeOfConductHash.test.ts` (the hash moves with every checked field and nothing else, option labels
    checked), `searchCardSummary.test.ts` (no admin-notes fallback), `hubSettingsUnavailable.test.ts` (a failed
    read throws, no env roster). `hubResolver.test.ts`: 503 `hub_settings_unavailable`. `publicRedaction.test.ts`:
    the member audience and `scrubAccountIds`. `adminRoster.test.ts` now expects no env roster inside a hub.
    `sampleRefresh.test.ts` (unit) tests `codeOfConductVerdict`.
  - **Fixture `tests/fixtures/codeOfConduct.ts`.** A test that fakes a passed check by writing the draft row must
    also write `coc_checked_hash: checkedHashFor(fields)`. `pendingProposalReview()` makes "a pending review" the way
    a resident does (it replaces `/reviews/submit` in the leak harness, `hubIsolationControllers` and
    `pluginToggles`).
  - **Changed on purpose:** `pluginToggles.test.ts` searched for *pending* vote results and meeting summaries, which
    worked only because of the A2 leak; its fixtures are published now, with an extra pending one for the admin
    digest. `publicAnonymity.test.ts`: a signed-in resident no longer sees `/users/user_…` IRIs; an admin does.
    `sampleRefresh.test.ts` (API): a never-checked submit is refused.
  - New E2E `codeOfConductCheck.spec.ts`: on a vote draft, Ready after the check; "Draft changed" and Submit disabled
    after an edit (the server's decision now); Ready again after the check, and the submit returns 201.
  - Results: unit 118 files, 1,392; API 41 files, 520 passed and 7 skipped **in each mode** (`audit1-api-3250`,
    `audit1-api-3251` in `.claude/launch.json`), with `sampleContent.test.ts` rerun alone after clearing the known
    admin+athens lockout; Playwright on `hub-e2e-1008-athens` + `hub-ui-5173`: 39 passed, 2 skipped, and
    `startPage.spec.ts`'s two tests failing for the setup reason above (the start page is untouched; its API
    suite passed in both modes).

  Its real reviewed process is left behind on purpose (append-only history;
  `pending_review`, out of every list). API then 438 passed, 7 skipped, both
  modes.
  **Local notes:** apply the migration with `supabase migration up --local`
  (a stack that applied the first version of `20261007000000` can re-run the
  file through `psql`; it is idempotent).
  `sampleContent.test.ts` removes Athens's samples, so a later
  `sampleSummary.spec.ts` skips until Athens is re-seeded
  (`scripts/seed-sample-content.ts --hub athens`). Run the two API files
  that use the step-up separately, clearing
  `pending_verifications.locked_until`, as before. Results: unit 111 files,
  1,305; API 36 files, 434 passed, 7 skipped, **both modes**; Playwright 34
  passed, 1 skipped (the feed pill, which skips while Athens has Meeting
  summaries off), against a production build behind `vite preview` on :4196.

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
- **The 1,000-row cap (2026-10-07):** `rowCap.test.ts` (over a stub that
  plays PostgREST's cap: a read with no limit that comes back with 1,000
  rows throws `CIVIC_ROW_CAP`, filtered or not (with `NODE_ENV=production`
  it reports one `[civic-error:CIVIC_ROW_CAP]` line through `reportError()`,
  column names only, and returns the rows; `reportError`'s line format); a read with `.limit()` or
  `.range()`, a write's `.select()` and a single-row read are let through;
  `readAll()` pages past the cap without losing or repeating a row;
  `inChunks()` splits long id lists); `feedActivity.test.ts` checks
  `FEED_EVENT_TYPES` against the classifier: no other emitted type ever
  becomes a card, and every listed type can
- **Plugin switches (2026-10-07):** `pluginSwitches.test.ts` (the type
  filter for search and link candidates, the needs-setup rule, the UI's
  onboarding target and search chips)
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
- **Covers:** critical user journeys — navigation, feed, votes, search, conversations;
  feed paging (`feed.spec.ts`, 2026-10-07: a page load asks for `limit=25`
  with no cursor; reaching the end of the feed loads the next page with the
  cursor the first page returned, and the button goes away at the oldest;
  with IntersectionObserver removed, the "Load more" button does the same;
  over two pages served by the test). **The browser pane cannot check this
  by hand when it is hidden:** a hidden tab never delivers IntersectionObserver
  callbacks. Headless Playwright is a visible page and does;
  plugin switches (`pluginSwitches.spec.ts`, 2026-10-07: Settings → Plugins
  changes the nav without a reload; a new sign-up with Word clouds off stays
  home)
- **Note:** Each test dismisses the intro popup via localStorage before running.
- **Green: 25 of 25 (2026-09-26, Phase 5 part one, step 0.3; again
  2026-09-27 before release 1)**, local stack, hub tokens on. The six known failures that predated this build are gone:
  - **Fixed** (the UI changed on purpose; the check now holds the current
    intent): tab strip order (`Proposals`, and `Outcomes` last; order of
    whichever tabs a hub's plugins show), welcome-banner title (the
    community-pilot copy, carrying the served hub name), suggest-a-vote (the
    compact header button that replaced `.suggest-vote-cta` in 7606a04).
  - **Retired**: the three "not-found shows back link" checks. The per-page
    back links were removed in 339b9ea when the tab strip moved into the App
    layout. Replaced by one parametrised check that each not-found page
    renders and keeps the tab strip's link home.
- **Beta is real in E2E (2026-09-26).** The UI's beta state now comes from
  the served `hubs.mode` (local Floyd: `beta`), so a signed-out visit meets
  the welcome dialog. Every spec's `beforeEach` enters preview
  (`sessionStorage.civic_preview = "1"`), as a visitor who chooses to browse.
  `navigation.spec.ts` checks the dialog follows the served mode, and that
  the drawer's process links work signed out (step 0.2).
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
| Empty transcript + no PDF waits (not ready) | :white_check_mark: unit | | inventing blocks is worse than failing; since 2026-09-29 retried next run, not a failure |
| Listed video without a timed transcript waits — no agenda fallback | :white_check_mark: unit | live | the 2026-09-22 bug; meetingSummaryTimestamps.test.ts (18), meetingSummaryPipeline.test.ts |
| Agenda alone is never summarized | :white_check_mark: unit | | waits for minutes or a recording |
| Timed transcript ⇒ summary has timestamps | :white_check_mark: unit | | meetingSummaryTimestamps.test.ts |
| Model drops timestamps ⇒ one retry, then flagged | :white_check_mark: unit | | "No video timestamps; the transcript had timings, check before publishing" |
| Minutes past 14 days without a transcript go ahead, flagged | :white_check_mark: unit | | `allowMissingTranscript` |
| Block count scales to meeting length | :white_check_mark: unit | | meetingSummaryPrompt.test.ts (11) |
| Prompt demands coverage through adjournment | :white_check_mark: unit | | a 4h24m run had dropped the last hour |
| Prompt forbids omitting a closed session | :white_check_mark: unit | | a run had dropped one with its vote |
| Transcript mishearings corrected by instructions | | live | config, not code — verify per jurisdiction |

**Timing and revisions**

| Flow | Automated | Verified | Notes |
|------|-----------|----------|-------|
| A meeting that has not happened is not summarized | :white_check_mark: unit | | meetingSummaryStaleness.test.ts (17); **since 2026-09-29 the meeting day itself waits too** |
| A same-day summary counts as predating its meeting | :white_check_mark: unit | live | 2026-09-22 written 11:30 UTC that morning |
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
| Flagged summary is never auto-published | :white_check_mark: unit | | jobRunVisibility.test.ts — the real run with auto-publish on |
| Approving a flagged summary needs confirmation (409 without) | :white_check_mark: unit | local | meetingSummaryTimestamps.test.ts; UI confirm checked in the browser on the local stack |
| Batch approve skips flagged summaries | | | `flagged_skipped` in the response; not automated |
| Older summaries with a video and no timestamps count as flagged | :white_check_mark: unit | | `effectiveQualityFlag` |
| Failed or flagged run is recorded in job_runs | :white_check_mark: unit | | jobRunVisibility.test.ts, jobRunDescribe.test.ts (8) |
| Failed run appears in the admin digest with its reason | :white_check_mark: unit | | jobRunVisibility.test.ts: the real admin digest, sent for a job failure alone |
| Plugins page shows each job's last run and last problem | | local | browser check on the local stack, 2026-09-29; no component tests |
| job_runs is hub-scoped and never leaks | :white_check_mark: API | | rlsCatalog.test.ts; leakHarness.test.ts walks `GET /admin/hub/jobs/runs` with a Floyd run carrying the marker |
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
- **Job run log in unit tests (2026-09-29):** every hub job run now writes a `job_runs` row through `forHub()` (`src/services/jobRuns.ts`, best-effort). Unit tests that drive `runJobAcrossHubs` (`cronHubIsolation`, `jobsPerHub`, `jobRunVisibility`) mock that module, so the unit layer never reaches a database whatever the shell's environment. A new unit test that runs a job should do the same.
- **Backups are checked outside this repo (2026-10-05):** the scheduled dumps and hub exports live in the private repo `Mosaic-Foundation/civic-hub-backups`; its watchdog workflow fails (GitHub emails) when the newest dump is ≥ 8 h old or the newest daily dump / hub export ≥ 30 h. Nothing here tests them; the proof is the restore drill in `RUNBOOK-restore-database.md` → Rehearsals. Repeat it after any change to the dump, `export-hub.ts`, `restore-hub.ts` or the bundle format.
- **Both API passes on one local stack (2026-09-29):** run back to back, the token pass's `sampleContent.test.ts` can fail "Too many incorrect attempts … 15 minutes": the service-role pass's deliberate wrong codes locked the same `pending_verifications` row. It is the shared stack, not the code: wait out the lock, or delete the locked row on the LOCAL stack (`pending_verifications?locked_until=gt.now()`) and rerun. CI runs each pass on its own stack.

---

## Running integration tests in CI

**Read this before writing anything in `tests/api/` or `tests/e2e/`.**

**Update 2026-10-12 (Audit 4): CI checks everything the suites rely on.**
- `ci.yml` uses npm 12.2.0 and `npm ci` (as Vercel does), pins every action by commit and the Supabase CLI
  (2.110.0), and runs `npm audit --audit-level=high` in both packages.
- It type-checks `tests/`, `scripts/` and `api/` (`npm run typecheck`, `tsconfig.check.json`) and runs the UI lint
  with its import boundaries.
- **The Playwright suite runs in `.github/workflows/e2e.yml`.** It runs on pushes to `multi-tenant` and by hand
  (workflow_dispatch); a docs-only push skips it, and a newer push cancels the older run. It uses a preview
  build on :4173 and one service-role API on :3000, on the same seeded local stack.

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
*One exception, by Adam's decision (2026-10-13):* the smoke job
(`.github/workflows/smoke.yml`) writes to dev, but only on its own smoke hub,
one run at a time, and it cleans up after itself. That answers both
objections. It checks the deployment, not the code, so it does not replace
the local-stack jobs.

---

*Last updated: 2026-10-14 — navigation (`navSections.test.ts`, `navigation.test.ts`, `hubNavigation.spec.ts`, two smoke tests replacing the phone Admin menu one, the console-made hubs' sidebar). Before that, 2026-10-14 — members and invites (`memberInvites.test.ts`, `membersInvites.test.ts`, `membersInvites.spec.ts`, three smoke tests, the leak harness's member routes). Before that, 2026-10-13 — feedback routing (`feedbackDuplicates.test.ts`, `feedbackInbox.test.ts`, `feedbackRouting.test.ts`, `feedbackRouting.spec.ts`, two smoke tests, the purge of a hub's inbox copies). Before that, 2026-10-13 — the admin menu slice (`helpRegistry.test.ts`, `adminAnchors.test.ts`, `adminMenuSlice.test.ts`, `adminMenu.spec.ts`, three smoke tests, the help-links CI step). Before that, 2026-10-14 — the sign-in slice (`codeRules.test.ts`, `codeEmail.test.ts`, `signInLink.test.ts`, `auditSignIn.test.ts` rewritten, `signIn.spec.ts`, the smoke link sign-in). Before that, 2026-10-13 — vote pages fixes (`votePages.spec.ts`, the preview-build note, conformance step 5's hourly close). Before that, 2026-10-13 — the smoke suite (`tests/smoke/`, `playwright.smoke.config.ts`, `.github/workflows/smoke.yml`). Before that, 2026-10-12 — the plugin conformance suite (`tests/conformance/`, `conformance.test.ts`, `processDescriptors.test.ts`, the fake Polis, `liveProcess.ts` fixtures, the DDL settle). Before that, 2026-10-11 — Audit 2 (rate limits and the fresh test IP, hashed codes and sessions, `auditSignIn` / `aiLimits` / `auditHardening`, the CSP under `vite preview`). Before that, 2026-10-11 — Audit 1 (within-hub exposure: `auditLiveExposure.test.ts`, the check hash fixture, `codeOfConductCheck.spec.ts`). Before that, 2026-10-07 — event reads past 1,000 rows (`eventReads.test.ts`, `rowCap.test.ts`, feed paging in `feed.spec.ts`). Before that, 2026-10-06 — console and sample-content polish (eleven sample templates, the `process` field kind, job_runs recording, the meeting-pill E2E check). Before that, 2026-09-27 — hubDeadEnd.test.ts, E2E 25/25 again, API 290 in token mode (release-1 prep). Before that, 2026-09-27 — consoleRouting.test.ts (dev on *.dev.civic.social). Before that, 2026-09-26 — Phase 7: sample content (marker, stamping triggers, the hub-token delete guard, removal, the console seed). Before that, 2026-09-26 — Phase 5 part two: hub export/import/restore round trip (incl. plain Postgres), console export + sweep, the hourly vote close and the digest's recorded_at window. Before that, 2026-09-25 — Phase 3: the leak harness (both modes), the
RLS catalog test, and CI running the API layer twice. Before that, 2026-09-25 — Phase 2c suites, the E2E known-failure baseline,
and the API layer now running in CI. Previously: 2026-09-22 — recorded that the Supabase CLI local stack now
works end to end, that the migration set builds a working schema from scratch,
and added the hub-config API tests. Previously: 2026-08-26 — added the
archive/restore inventory, the unit-test layer (which CI runs and this file had never documented), the process-linking coverage inventory, and the standing note above on running integration tests in CI.*
