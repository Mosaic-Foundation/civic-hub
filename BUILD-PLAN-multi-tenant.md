# BUILD-PLAN-multi-tenant.md — one deployment, one shared database

Written 2026-09-22 (Phase 0). The contracts in this file are fixed: later
sessions build against them and do not change them without asking Adam.
Decision record: `../decisions/2026-09-22-multi-tenant.md` (ADR-004).
Session ritual: `SESSION-START.md`.

## Goal

civic-hub today is multi-deployment: one codebase, one Vercel project and
one Supabase project per hub, configured by ~50 env vars. The target is one
deployment and one shared Postgres with `hub_id` on every table, forced
row-level security keyed on a `hub_id` JWT claim, and hub identity, copy and
plugin configuration held as data in `hubs` + `hub_settings`. Floyd
(`floyd.civic.social`) is hub #1 and is converted in place. Production is
not touched in any build session; the cutover is a separate session Adam
runs by hand from the Phase 6 runbook.

## Operator facts (recorded 2026-09-22)

| Fact | Value | Why it matters |
|---|---|---|
| Vercel plan (Floyd project) | **Pro** | Wildcard custom domains and per-minute crons are available; no upgrade needed for Phase 5. |
| DNS for `civic.social` | **GoDaddy** | Phase 5 adds `*.civic.social` as a CNAME to Vercel in the GoDaddy DNS panel; the apex and `www` stay on the marketing site (Firebase). **Corrected 2026-09-27:** a CNAME alone routes traffic but Vercel cannot issue the wildcard certificate; it also needs "Enable Vercel DNS" on `civic.social` in the Vercel team (nameservers stay at GoDaddy) and two `NS` records `_acme-challenge` → `ns1`/`ns2.vercel-dns.com`. The production steps are `RUNBOOK-cutover.md` §8; dev's are under Phase 5 → "The dev wildcard". |
| Supabase project (Floyd) | ref `nfhyypwoporfggqcerli`, "Civic-Hub-Floyd", Postgres 17.6, PostgREST v14.5, GoTrue v2.190 | Becomes the shared database. See "Phase 3 approach (verified)". |
| Marketing-site Supabase | ref `ehcyahlmqbqmewdbxdls`, "Website-Civic-Social" (linked from the monorepo root `supabase/`) | Separate project; not part of this work. |

---

## Contracts

### 1. `hubs` table

```sql
create table hubs (
  id                text primary key,            -- the slug: 'floyd', 'athens'
  hostname          text unique not null,        -- 'floyd.civic.social'
  name              text not null,               -- 'Floyd Civic Hub'
  jurisdiction_code text,                        -- 'us-va-floyd' (nullable)
  jurisdiction_name text,                        -- 'Floyd County, Virginia' (nullable)
  space_did         text not null,               -- 'did:web:floyd.civic.social'
  space_type        text not null default 'civic-hub',
  status            text not null default 'active'
                    check (status in ('active', 'suspended')),
  mode              text
                    check (mode is null or mode in ('demo', 'beta', 'live')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

- `id` is the slug and the value stamped into every table's `hub_id`. It is
  lowercase `[a-z0-9-]`, 2–32 chars, never starts or ends with `-`.
- **Reserved slugs, never assignable:** `www`, `admin`, `api`, `polis`,
  `representative`, `demo`, `staging`, `dev`, `mail`, `app`. Enforce with a
  check constraint AND in the control-plane validator.
- `hostname` is the full host the resolver matches on, lowercase, no port.
  One hostname per hub in v1; aliases are a later column, not a second row.
- `space_did` is `generator.id` on emitted activities and `space.id` in the
  discovery manifest, per hub. It replaces the `CIVIC_SPACE_DID` env var.
- `jurisdiction_code` / `jurisdiction_name` replace `CIVIC_JURISDICTION` /
  `CIVIC_JURISDICTION_NAME`. Null means "no civic geography" (the current
  `local` / `none` / `unknown` sentinels are never stored).
- **`source.hub_id` on published activities is NOT this id.** It is
  `hubs.protocol_hub_id` (added in Phase 2a, 2026-09-24, with Adam):
  `civic-hub-local` for Floyd, as production has always published, and
  `civic-hub-<slug>` for a hub created since. `HUB_ID` in `src/config/hub.ts`
  is only the fallback with no hub in scope. Never derived from `hubs.id` at
  runtime; see "Phase 2a" below for the three identifiers.
- `status = 'suspended'` makes the resolver serve the "no hub here" page
  for that hostname while leaving the data in place.
- **`mode` is the hub's lifecycle state** (added 2026-09-22, with Adam). It
  replaces two independent booleans — `CIVIC_BETA_MODE` and the demo bypass —
  which could both be true at once and described a state with no meaning: demo
  admits anyone with any code, beta admits only the allowlist. The only reason
  that was not already a bug is that the demo check returned before the beta
  check ran.

  | mode | sign-in | who may join | banner |
  |---|---|---|---|
  | `demo` | any six digits, no email sent | anyone | demo |
  | `beta` | real code by email | allowlist only, waitlist for everyone else | beta |
  | `live` | real code by email | anyone | none |

  `mode` and `status` are different axes: `status` answers "is this hub
  serving at all", `mode` answers "how open is it, and to whom".

  **Null means unset**, and the reader falls back to the environment
  variables. That is what makes the column safe to add to a live database:
  Floyd's row stays null, production keeps reading `CIVIC_BETA_MODE`, and
  nothing changes until a mode is written deliberately. A `default 'live'`
  would have silently un-gated a hub that is in private beta.

  **A hub admin may set `beta` or `live` only. `demo` is settable solely by
  the control plane or a seed script, never from the hub admin UI** (Adam,
  2026-09-22). Demo is the one mode that turns off email verification, so an
  admin who chose it — by accident, or with a taken-over account — would open
  a real jurisdiction's hub to anyone signing in as anyone. Moving between
  beta and live is an ordinary operator decision; putting a hub into demo is a
  decision about what that hub *is*.

  The restriction runs one way only. **A hub created in demo stays in demo
  until its own admin moves it to beta or live** — a demo graduating into a
  real hub is a real decision, and its admin is the right person to make it.
  What no admin may do is move a hub INTO demo. Enforced by
  `hubModeChangeRejectionReason()` in `src/models/hub.ts`, which every admin
  write path must call.

### 2. `hub_settings`

Primary key becomes `(hub_id, key)`. Columns: `hub_id text not null
references hubs(id)`, `key text not null`, `value text not null`,
`updated_at`, `updated_by`. Existing trigger `hub_settings_touch_updated_at`
is kept.

Key naming is dotted, lowercase, and namespaced. The canonical keys:

| Namespace | Keys |
|---|---|
| `identity.` | `identity.name`, `identity.label`, `identity.tagline`, `identity.page_title`, `identity.description`, `identity.banner_url`, `identity.banner_alt`, `identity.theme`, `identity.logo_url` (added 2026-09-24, Adam), `identity.timezone` (added 2026-09-24, Phase 2c), `identity.jurisdiction_type` (added 2026-09-26, Phase 7; place hubs only; public since 2026-10-07, Adam: the welcome strip and tagline say "town government"), `identity.hub_kind` (added 2026-09-27: `place` / `issue` / `organization` / `other`, unset = place; public) |
| `copy.` | `copy.intro_body`, `copy.residency_intro`, `copy.welcome`, `copy.about`, `copy.resident_noun` (read since 2026-10-07: overrides the kind's noun), `copy.governing_body_name`, `copy.governing_body_short`, `copy.welcome_strip`, `copy.welcome_strip_hidden` (boolean), `copy.beta_banner` (the last three added 2026-10-07, Adam; public) |
| `legal.` | `legal.terms`, `legal.privacy`, `legal.code_of_conduct`, `legal.proposal_best_practices`, `legal.governing_state` (added 2026-09-27: the state whose law governs a non-place hub's documents; admin-editable; unset = `config/legal/defaults.json`, "Virginia"; public, as it is printed in them) |
| `people.` | `people.admin_emails`, `people.board_emails`, `people.brief_recipients`, `people.announcement_authors` |
| `email.` | `email.from_name`, `email.from_address`, `email.postal_address` |
| `beta.` | `beta.allowlist`, `beta.waitlist_enabled` (there is no `beta.enabled`: see `hubs.mode`) |
| `moderation.` | `moderation.comment_identity_mode` |
| `plugin.<id>.` | `plugin.<id>.enabled` and `plugin.<id>.<setting>` |

`<id>` is the registry id: `vote`, `proposal`, `project`, `announcement`,
`brief`, `meeting_summary`, `wordcloud`, `conversation`, `assistant`,
`digest`, `admin_digest`, `search`, `feedback`, `news_sync`.

`moderation.` holds hub-wide participation policy that no single process
type owns. `comment_identity_mode` (`real_name` / `anonymous_optional` /
`anonymous_only`) lives here rather than under `plugin.vote.` because it
governs comments everywhere they appear — proposals, projects and votes —
and a hub sets it once. Ballot secrecy and real-name process creation stay
structural, not settings; do not add them here.

Value encoding: strings are stored as-is; lists are JSON arrays; booleans
are the strings `true` / `false`; numbers are decimal strings. A settings
reader (`src/services/hubSettings.ts`) owns parsing; callers never parse
`value` themselves.

**Public subset.** Only `identity.*`, `copy.*`, `legal.*`, `beta.enabled`,
`beta.waitlist_enabled`, `moderation.comment_identity_mode`,
`plugin.<id>.enabled`, `plugin.conversation.polis_url` and
`plugin.wordcloud.onboarding_id` are served by `/api/hub-config`
(`identity.*` includes `identity.logo_url`, added 2026-09-24, and
`identity.hub_kind`, added 2026-09-27: the hub UI words the sign-up
affirmation by it). `people.*`,
`email.*`, `beta.allowlist`, `beta.demo_mode`, `beta.demo_bypass_code` and
every other `plugin.<id>.<setting>` are admin-only.

The last two plugin keys were added 2026-09-22, confirmed with Adam: the
client renders both — a URL that becomes a link, and the id of a public
process — and both already shipped in the bundle as `VITE_` variables, so
serving them discloses nothing that was not already public. The public subset is a list of keys, not of namespaces: a new
`moderation.*` key is admin-only until it is added to the list. The comment
identity mode is on it because the comment form has to render the anonymity
toggle before anyone is signed in.

#### Alias map — existing keys that keep working until migrated

The settings reader accepts both names for each row below. Reads try the
new key first, then the alias. Writes from the admin UI go to the new key.
A one-off migration script (Phase 4) copies alias rows to their new key
and leaves the old row in place; the alias entry is deleted from the map
only after the cutover.

| Existing `hub_settings` key | New key | Notes |
|---|---|---|
| `brief_recipient_emails` | `people.brief_recipients` | comma list today → JSON array |
| `announcement_authors` | `people.announcement_authors` | already JSON |
| `beta_allowlist` | `beta.allowlist` | comma list today → JSON array |
| `comment_identity_mode` | `moderation.comment_identity_mode` | hub-wide comment policy, so it is not owned by a process type (decided with Adam, 2026-09-22) |
| `support_threshold` | `plugin.vote.support_threshold` | decimal string |
| `officials_migrated` | `people.officials_migrated` | latch; stays a string `true` |

Env vars that become settings (read via the same reader, env var as the
fallback until the cutover writes the row):

| Env var (today) | New key |
|---|---|
| `HUB_NAME`, `VITE_HUB_NAME` | `identity.name` |
| `VITE_HUB_LABEL` | `identity.label` |
| `VITE_HUB_TAGLINE` | `identity.tagline` |
| `VITE_HUB_PAGE_TITLE` | `identity.page_title` |
| `VITE_HUB_DESCRIPTION` | `identity.description` |
| `VITE_HUB_BANNER_URL`, `VITE_HUB_BANNER_ALT` | `identity.banner_url`, `identity.banner_alt` |
| `VITE_HUB_THEME` | `identity.theme` |
| `VITE_HUB_INTRO_BODY` | `copy.intro_body` |
| `VITE_HUB_RESIDENCY_INTRO` | `copy.residency_intro` |
| `VITE_HUB_GOVERNING_BODY_NAME`, `_SHORT` | `copy.governing_body_name`, `copy.governing_body_short` |
| `VITE_HUB_JURISDICTION` | `hubs.jurisdiction_name` (a column, not a setting) |
| `CIVIC_JURISDICTION`, `CIVIC_JURISDICTION_NAME`, `CIVIC_SPACE_DID` | `hubs.jurisdiction_code`, `hubs.jurisdiction_name`, `hubs.space_did` |
| `CIVIC_ADMIN_EMAILS` | `people.admin_emails` |
| `CIVIC_BOARD_EMAILS` | `people.board_emails` |
| `BOARD_RECIPIENT_EMAIL` | `people.brief_recipients` |
| `FEEDBACK_RECIPIENT_EMAIL` | `plugin.feedback.recipients` |
| `RESEND_FROM`, `SMTP_FROM` | `email.from_name`, `email.from_address` |
| `HUB_POSTAL_ADDRESS` | `email.postal_address` |
| `CIVIC_BETA_MODE`, `VITE_BETA_MODE` | `beta.enabled` |
| `DIGEST_ENABLED` | `plugin.digest.enabled` |
| `ADMIN_DIGEST_ENABLED` | `plugin.admin_digest.enabled` |
| `MEETING_SUMMARY_ENABLED`, `MEETING_SOURCE_URL`, `MEETING_CONNECTOR_ID`, `MEETING_EXTRACTION_INSTRUCTIONS`, `MEETING_TITLE_FILTER`, `MEETING_TYPE_EXCLUDE`, `MEETING_WIX_COLLECTION`, `MEETING_YOUTUBE_CHANNEL_ID`, `MEETING_SUMMARY_AUTO_PUBLISH`, `MEETING_SUMMARY_CUTOFF_DATE`, `MEETING_SUMMARY_MAX_PER_RUN` | `plugin.meeting_summary.enabled`, `.source_url`, `.connector_id`, `.extraction_instructions`, `.title_filter`, `.type_exclude`, `.wix_collection`, `.youtube_channel_id`, `.auto_publish`, `.cutoff_date`, `.max_per_run` |
| `FLOYD_NEWS_SYNC_ENABLED`, `FLOYD_NEWS_SOURCE_URL`, `FLOYD_NEWS_SYNC_MAX_PER_RUN` | `plugin.news_sync.enabled`, `.source_url`, `.max_per_run` (module `civic.floyd_news_sync` is renamed `civic.news_sync` in Phase 4; the word Floyd leaves `src/`) |
| (none — was the only code path) | `plugin.news_sync.connector` — which connector reads the feed; `wix-cms` is the one that exists. Added 2026-09-24 with the rename, per Adam's Phase 4 part four prompt. No env fallback and no default: a hub with neither connector nor `source_url` does not sync news. Floyd's `wix-cms` + its feed URL are seed data in `config/hubs/floyd/settings.json`. |
| `VITE_HUB_POLIS_URL`, `POLIS_BASE_URL` | `plugin.conversation.polis_url` |
| `POLIS_AUTH_TOKEN` | stays an env var (a credential), looked up per hub in Phase 4: `POLIS_AUTH_TOKEN__<HUB_ID>`, with the bare `POLIS_AUTH_TOKEN` as the fallback (confirmed with Adam, 2026-09-22). See "Per-plugin credentials" below for where this is headed. |
| `VITE_HUB_ONBOARDING_WORDCLOUD_ID` | `plugin.wordcloud.onboarding_id` |
| `CIVIC_DEMO_BYPASS_CODE`, `VITE_DEMO_MODE`, `VITE_DEMO_BYPASS_CODE` | `beta.demo_bypass_code`, `beta.demo_mode` (admin-only; never in the public subset) |

Stays platform-wide (env var, not a setting): `SUPABASE_URL`, the
Supabase keys, `ANTHROPIC_*`, `RESEND_API_KEY`, `SMTP_*`, `CRON_SECRET`,
`DIGEST_UNSUBSCRIBE_SECRET`, `CIVIC_ANON_SECRET`, `SEARCHAPI_API_KEY`,
`SUPADATA_API_KEY`, `YOUTUBE_API_KEY`, `CIVIC_ALLOWED_ORIGINS`
(becomes a computed list: every active hub's hostname plus the marketing
site), `BASE_URL` / `CIVIC_UI_BASE_URL` (computed from `req.hub.hostname`),
`CIVIC_ALLOW_SEED`, `CIVIC_SEED_FIXTURE`, `NODE_ENV`, `PORT`,
`CIVIC_PLATFORM_POSTAL_ADDRESS` (added 2026-09-27; see "Jurisdictions, …"),
`IMAGE_UPLOAD_MAX_MB`, `LINK_PREVIEW_USER_AGENT`, `CIVIC_HUB_ID` (the
protocol identity, see Contract 1).

#### Per-plugin credentials (direction, not a contract yet)

Where this is headed, from the 2026-09-22 planning conversation: an operator
opens the admin panel, picks a plugin, and enters their own credential for it
— their Polis auth token, their meeting-transcript connector key — instead of
asking whoever runs the deployment to set an env var. That is the right end
state for a hosted offering, and it is what makes a hub genuinely
self-service. It is deliberately **not** in Phases 1–6.

Three things have to be settled before it is built, and none of them are
settled now:

1. **Secrets do not belong in `hub_settings`.** That table is read in bulk:
   `getAllSettings()` exists today and the admin settings endpoint returns
   every row. One careless read and a token is on the wire. A credential
   belongs in its own table — say `hub_secrets (hub_id, key, ciphertext,
   updated_at, updated_by)` — behind a reader that fetches one key at a time
   and has no bulk accessor at all.
2. **Encryption at rest, with a key the database does not hold.** Storing a
   token in a column means anyone with a database dump has the token, which
   is worse than the env var it replaced. The options are Supabase Vault or
   application-level envelope encryption with a platform key held in Vercel.
   Either way the plaintext exists only in the process that uses it.
3. **The admin UI must be write-only.** The field shows whether a credential
   is set and when it changed, never the value, and the API never echoes it
   back. Otherwise a compromised admin session reads every hub's
   credentials, and per-hub credentials have made the blast radius larger
   rather than smaller.

Until that is designed, per-hub credentials stay env vars with the
`<NAME>__<HUB_ID>` convention above. The convention is chosen so the move to
a table is a change of reader, not a change of every call site.

### 3. Data layer — `forHub(hubId): HubDb`

File: `src/db/forHub.ts`.

```ts
export type HubDb = {
  /** A hub-scoped table: the builder shape the code uses, not Supabase's result shape. */
  from(table: TableName): HubQueryBuilder;
  /** A database function; the hub is passed as the named argument `p_hub_id`. */
  rpc<T = unknown>(fn: string, args?: Row): PromiseLike<T>;
  readonly hubId: string;
};

export interface HubQueryBuilder {
  select<T = Row>(columns?: string): HubSelect<T>;   // await → T[]; .maybeSingle() → T | null; .single() → T
  count(): HubCount;                                 // await → number
  insert<T = Row>(values: Row | Row[]): HubWrite<T>; // await → null; .select() → T[]
  upsert<T = Row>(values: Row | Row[], options: { onConflict: string }): HubWrite<T>;
  update<T = Row>(values: Row): HubWrite<T>;
  delete<T = Row>(): HubWrite<T>;
}

export class HubDbError extends Error { code?: string; details?: string }

export function forHub(hubId: string): HubDb;
```

**Methods throw on error and return rows, never Supabase's `{ data, error }`
pair** (Adam, 2026-09-24, so that shape stays inside `src/db/` and a later
change of driver is a change of `forHub.ts`, not of every caller). A failure
throws `HubDbError` carrying the Postgres SQLSTATE in `code` (`23505` for a
unique violation, `PGRST116` for `.single()` finding no row). Filters and
modifiers (`eq`, `in`, `or`, `order`, `limit`, …) chain as before. The
contract as first written (Phase 0) exposed `SupabaseClient["from"]` and
`SupabaseClient["rpc"]`; the builder surface stayed, the result shape did
not. A database function's hub argument is named `p_hub_id`.

- `forHub()` returns a client whose every `select` / `update` / `delete`
  carries `.eq("hub_id", hubId)` and whose every `insert` / `upsert` has
  `hub_id: hubId` stamped onto each row (an explicit different `hub_id` in
  the payload is an error, not an override).
- The client authenticates as the `authenticated` Postgres role with a
  short-lived JWT carrying `hub_id`, so the database's forced RLS is a
  second, independent filter (see "Phase 3 approach (verified)").
  The service-role client is kept only for the control plane
  (`src/control/`) and migrations.
- `hubs` itself has no `hub_id`; it is read by the resolver through the
  service-role client and is never exposed through `HubDb`.
- Nothing outside `src/db/` and `src/control/` imports
  `@supabase/supabase-js` or `src/db/client.ts`. A lint rule
  (`no-restricted-imports`) enforces this from Phase 2.
- An upsert whose conflict target does not name `hub_id` throws (a conflict
  on a global key would update whichever hub's row it hit), and an update or
  delete re-checks its hub filter when it runs.
- Tests: `tests/unit/forHub.test.ts` asserts the filter, the stamp and the
  result shape with a stubbed client; no database needed.
  `tests/api/forHubIsolation.test.ts` runs every operation against two seeded
  hubs in the local stack.

### 4. Request flow

1. `hubResolver` middleware runs before `express.json()` and before
   `ensureSeeded`. It lowercases `req.hostname`, strips a port, looks up
   `hubs` by `hostname` (cached in memory, 60 s TTL, invalidated by the
   control plane), and sets `req.hub` (`{ id, hostname, name, ... }`).
2. Unknown hostname, or `status = 'suspended'`: respond with a plain
   "no hub here" HTML page (HTTP 404, no branding, no data), for every path
   including `/api/*` (which gets `{ error: "no_hub" }` as JSON).
3. Every route handler and service reads `req.hub.id` and calls
   `forHub(req.hub.id)`; nothing reads hub identity from env.
4. Cron routes (`/internal/*`) have no hostname context; they iterate
   active hubs and call the job once per hub with `forHub(hub.id)`.
5. `GET /api/hub-config` returns `{ hub: { id, name, hostname,
   jurisdiction_code, jurisdiction_name, space_did }, settings: <public
   subset> }` for the resolved hub, cacheable for 60 s. The UI fetches it
   once at boot and `ui/src/config/hub.ts` becomes a thin reader over the
   response (env-var defaults remain only as the loading placeholder).
   **Since 2026-10-07** the response also carries `plugin_setup`: for each
   switched-on plugin that still needs setup, `{ missing, shown }` (see
   "Plugin switches, end to end" below). It is computed, not a settings
   key. The UI re-fetches the config after an admin's Settings save
   (`refreshHubConfig()`), so the admin's own page changes without a reload.
6. Local dev: `localhost` maps to the hub named by `CIVIC_DEV_HUB`
   (default `floyd`); `<slug>.localhost` maps to `<slug>` so two hubs can
   be exercised on one dev server.

---

## Phase checklists

Adam holds the Phase 1–6 checklists. Paste each one under its heading
when the phase's first session starts. Until then, the "Done when" line
below each heading is the acceptance check the session is held to.

### Phase 1 — `hubs` table + resolver

Done when: two `hubs` rows, two hostnames, same build; unknown hostname
serves "no hub here"; `/api/hub-config` returns the right row for each.

_checklist to be pasted_

### Phase 2 — `hub_id` on every table + `forHub()`

Done when: every one of the 30 tables has `hub_id not null default
'floyd'` with an index, all 51 raw-client importers go through `forHub()`,
the lint rule passes, and `npm test` is green.

#### Two findings from Phase 1 part three (2026-09-23)

**1. `users.email` is `NOT NULL UNIQUE` across the whole table.** Added in
`20260416000000_initial_schema.sql`, correct while one database served one
hub, and a blocker on a shared one: it makes it impossible for one person to
hold an account on two hubs. The plus-addressed Athens admin
(`you+athens@…`) works today only because it is literally a different
string. Phase 2 must replace the constraint with `unique (hub_id, email)` in
the same migration that adds the column, and that is a genuine schema change
rather than an additive one — the additive-only rule bends here, so it is
called out rather than discovered mid-phase. Note the ordering: the unique
index has to be dropped and recreated after `hub_id` is backfilled, not
before.

**2. Per-user "last digest sent" needs no column of its own, and survives the
cutover.** It lives as `users.last_digest_sent_at`
(`20260423000000_digest_subscription.sql`), a column on `users` rather than
its own table, so it inherits `hub_id` when `users` gets one and is scoped
per (hub, person) for free. Floyd's rows are converted in place at cutover
with their values intact, so nobody gets a re-send and nobody gets a gap —
which matters, because the cursor is what bounds the digest window: a reset
to null falls back to `created_at` and would mail every long-standing
subscriber their entire history in one message. The same is true of
`digest_frequency_days` and the unsubscribe state beside it. Confirm the
column survives the Phase 6 rehearsal rather than assuming it; it is a
one-line check against the restored dump.

#### Phase 2c (2026-09-24): everything per hub at runtime

**`identity.timezone`** (new key, Adam's 2c brief: "add identity.timezone if
no setting exists"): an IANA zone, edited in Identity, validated as one;
empty or unknown reads as UTC. The digest job reads `plugin.digest.send_hour`
in it. Admin-only by the public list (identity.* is public by namespace in
the text above, but the code's list is by key, and nothing public needs it).

**Three keys added with Adam** (2026-09-24, Phase 2c): `plugin.vote.min_duration_days`,
`plugin.vote.max_duration_days`, `plugin.vote.default_duration_days` — the
range of voting windows a resident drafting a vote may pick, and where a new
draft starts. Unset = 14 / 90 / 42, the numbers that were in code and in the
`vote_drafts` column default. A backwards range is read the right way round
and the default clamped into it. The drafting form reads them from
`GET /votes/drafts/duration-limits` (resident-only), not from the public
config, so the public subset is unchanged.

**Plugin toggles at runtime** (`src/services/pluginGate.ts`). Each process
type names its plugin (`PROCESS_TYPE_PLUGINS` in `src/processes/registry.ts`;
`civic.polis_deliberation` → `conversation`, `civic.vote_results` → `vote`).
`plugin.<id>.enabled` off on a hub means, for that hub only: its route mounts
answer 404 (`requirePlugin`, plus the plugin-specific admin and upload
routes); its job is skipped; its process types cannot be created
(`createProcess`, `submitForReview`), read or acted on by id, or listed; the
feed and the digest leave them out (`getHiddenProcessIds`); the brief spawn
is skipped when briefs are off, news sync when announcements are; and the UI
drops the nav items, tabs, pickers and pages (`ui/src/config/plugins.tsx`).
Nothing is deleted. **Not filtered, deliberately:** `GET /events`, the
published record (it still hides non-public statuses as before), and the
digest's `/unsubscribe` and `/user/settings/digest`, so a link in a digest
already sent keeps working.

**Votes and briefs are separate (Adam, 2026-10-07).** A vote finishes when
it closes: it is finalized and posts its own "Vote results" card
(`vote-closed`). A brief is an optional extra for every type: with Briefs
on it is generated pending, and approving it posts a "Vote brief" card and
emails officials, but it never decides whether the vote is finished. A
meeting source with no new meeting in 45 days asks for a check (flagged). **Held back is not failed (2026-10-07):** mail the mode guard holds
back is reported as `held_back` with the reason, and the item still publishes.
Sign-in codes pass the guard on every mode.

**Plugin switches, end to end (2026-10-07).** The gaps from the 2026-10-06
review, closed: a switched-off type is also left out of search (hits and
counts, `enabledProcessTypesAmong`), link candidates, rendered links, brief
links and the "Read the brief" pointer (`hydratePeers`), the discovery
manifest's `processes`, the input / edit / links / share routes under its id,
the admin digest's sections and the admin queue counts; a pending review of
its type is hidden from the queue and the creator's list and cannot be
approved. Feedback off also drops the footer link and the "feedback button"
copy; Word clouds off stops a new account being sent to the onboarding cloud,
and the sample seed no longer names one while the stored switch is off.
**The Writing assistant gates only the AI chat and suggestions** (`/message`,
`/suggest`, and in the UI every affordance hanging off `shellAssistant` in
`useDraftFlow`: the panel, both "Get suggestions" buttons, per-field help);
the Code of Conduct check (`/review`) is moderation and runs with it off
(Adam, 2026-10-07). **Needs setup** (Adam, 2026-10-07): every
plugin stays on at creation as the creator chose. A plugin that needs setup
(today Meeting summaries and News sync: a source) appears on the public site
only when it has something to show — Meeting summaries when the hub has at
least one public summary (sample included) or a configured source; News sync
when a source is configured — and in Settings → Plugins stays on with a
"Needs setup" badge and one line on what is missing. The rule lives in one
place, `src/shared/pluginSetup.ts` (`PLUGIN_SETUP`); another plugin adopts it
by adding an entry. Not in this slice: the cross-instance settings cache, so
on Vercel a save is seen at once by the instance that took it and by others
within the settings cache's 60 s.

**Jobs** (`src/jobs/`): `registry.ts` lists every scheduled job (id, plugin,
path, UTC schedule, deprecated paths) as pure data; `runners.ts` maps each id
to its per-hub runner; `runJob.ts` iterates active hubs (or `?hub=`), skips a
hub whose `plugin.<id>.enabled` is off, isolates each hub's throw, and
reports per hub. `?force=true` skips only a job's own schedule check (the
digest's send hour). The digest runs hourly (`0 * * * *`); the other three
keep their times. The 2a `withMigrationDefaultHub` bridge is gone.

**Storage.** `20260924070000_post_images_bucket.sql` creates `post-images`
(public read, 5 MB, the four image types; `ON CONFLICT DO NOTHING`, so the
dev and production buckets keep their settings) and four policies on
`storage.objects` for `authenticated`: the bucket, and the first path
segment equal to `current_hub_id()` — defined in the same migration, ahead of
Phase 3, as the one function its policies call. It skips with a NOTICE where
there is no storage schema (plain Postgres; the local stack, where storage is
off), and a hosted project that refuses policy creation on
`storage.objects` gets a WARNING rather than a failed deploy — **Phase 3
must check `pg_policies` for all four before turning tokens on.** Proven in
a throwaway database with a stand-in storage schema: an Athens claim sees
and writes only `athens/…`, a write under `floyd/` is refused, no claim sees
nothing.

**Objects stored before the prefix** — `YYYY/MM/…` (every post image before
Phase 2b, all Floyd's) and `hubs/<hub_id>/…` (banners and logos from Phase 1
part five) — are not matched by the policies. Nothing reads them through a
policy (the app uses the service role; residents use the public URL), and
their URLs are stored inside process state and settings rows, so copying them
would mean rewriting every stored URL. **Recommended in 2c, for Adam to confirm: do not copy
at cutover; record the rule in the export instead** — an object whose key
has no hub prefix belongs to the migration-default hub, and
`hubs/<hub_id>/…` belongs to `<hub_id>`. A hub's export bundles its objects
by that rule. If a later phase needs them under the prefix, it copies and
rewrites together, not at cutover.

#### Phase 2a (2026-09-24): the tables, and three identifiers

**Three identifiers, three jobs, never derived from each other at runtime**
(Adam, 2026-09-24, when the collision below turned up):

| Column | Is | Example |
|---|---|---|
| `hubs.id` | the tenant key, stamped into every table's `hub_id` | `floyd` |
| `hubs.protocol_hub_id` | `source.hub_id` on every event the hub publishes | `civic-hub-local` |
| `hubs.space_did` | the space's DID, `generator.id` on activities | `did:web:floyd.civic.social` |

`protocol_hub_id` is new (`20260924000000`), NOT NULL and unique. Floyd's is
`civic-hub-local`, the identity every event it has already published
carries; any other hub's is `civic-hub-<slug>`, written once by
`scripts/create-hub.ts` at creation and never recomputed from `id`.
`emitEvent()` stamps `source.hub_id` from the hub in scope
(`protocolHubId()` in `src/config/hub.ts`); the `HUB_ID` env constant is the
bootstrap fallback for code with no hub in scope, nothing more.

**`processes.hub_id` already existed and meant the protocol id.** It was a
nullable per-row copy of `CIVIC_HUB_ID` (`20260416000200`), echoed into
`source.hub_id` through `process.hubId`. It is **repurposed** as the tenant
column like every other table's: backfilled to `floyd` (with the
`updated_at` and search-doc triggers held off so no process reads as edited
today), NOT NULL, default, FK. `Process.hubId` is the tenant now.

**`hub_id text not null default 'floyd' references hubs(id)` on these 28
tables** (`20260924010000`), in addition to `hub_settings` and `sessions`,
which had it from Phase 1 — 30 of the 31 tables; `hubs` is the registry:

`active_vote_keys`, `brief_responses`, `community_inputs`,
`deliberation_drafts`, `deliberation_submissions`, `deliberation_votes`,
`events`, `feedback_submissions`, `link_previews`, `pending_verifications`,
`process_links`, `process_reviews`, `processes` (repurposed),
`project_comments`, `project_drafts`, `project_sentiments`,
`project_updates`, `projects`, `proposal_drafts`, `proposal_supports`,
`proposals`, `review_turns`, `users`, `vote_drafts`, `vote_participation`,
`vote_records`, `waitlist`, `wordcloud_submissions`.

Foreign keys on these are `ON DELETE RESTRICT`, not `CASCADE` as on
`hub_settings` and `sessions`: settings and credentials are litter once a hub
is gone, but this is what residents said and did, so deleting a hub that
still holds any of it fails. Suspension is how a hub stops serving.

Each table has one hub-leading index on its main lookup path, named
`<table>_hub_..._idx`; where that path is an equality lookup made unique per
hub (the next section), the unique constraint is the index.

**Per-hub uniqueness, beside the old** (`20260924020000`). The new
constraint is added now; the old global one stays until the **cleanup
migration a week after cutover** drops it together with the `DEFAULT
'floyd'`s. Until then the old one still wins: one email is one account on
one hub, so a Floyd resident cannot yet sign up on Utopia with the same
address.

| Table | Old (dropped in cleanup) | New (Phase 2a) |
|---|---|---|
| `users` | `users_email_key` UNIQUE (email) | `users_hub_email_key` UNIQUE (hub_id, email) |
| `pending_verifications` | `pending_verifications_pkey` PK (email) | `pending_verifications_hub_email_key` UNIQUE (hub_id, email) — cleanup makes it the PK |
| `waitlist` | `waitlist_pkey` PK (email) | `waitlist_hub_email_key` UNIQUE (hub_id, email) — cleanup makes it the PK |
| `link_previews` | `link_previews_pkey` PK (url) | `link_previews_hub_url_key` UNIQUE (hub_id, url) — cleanup makes it the PK |
| `project_sentiments` | PK (project_id, user_id) | UNIQUE (hub_id, project_id, user_id) |
| `deliberation_submissions` | PK (process_id, user_id) | UNIQUE (hub_id, process_id, user_id) |
| `deliberation_votes` | PK (process_id, user_id, statement_id) | UNIQUE (hub_id, process_id, user_id, statement_id) |
| `hub_settings` | (global `key` PK, gone since Phase 1) | PK (hub_id, key), unchanged |

The last three never disagree with their old keys (a process or project id
pins one hub); they exist because **`forHub().upsert()` refuses a conflict
target that does not name `hub_id`** — an upsert that conflicts on a global
key updates whichever hub's row it hits.

**Stay global, by design:** generated identifiers — every `id`,
`sessions.token`, `vote_records.receipt_id`. They are random, so a global
unique never blocks a second hub and is strictly stronger. The receipts'
double-vote guard is the existing `(user_id, process_id)` key on
`vote_participation`, already per hub because both ids are. There are no
slug columns outside `hubs`.

**`users.identity_did`** (`20260924030000`): nullable text, no reader. The
seam ADR-004 reserves for portable identity.

#### Exit rights, from the audit (Adam, 2026-09-24)

An audit against four exit-rights rules (one door to hub data; hubs share
through the protocol, never the database; a small named dependency
surface; portable by construction) sorted its findings into now, 2b, 3,
cleanup and outside the repo. Done in Phase 2a:

- **`hubs.db_ref text not null default 'shared'`, `hubs.redirect_to text
  null`** (`20260924040000`). Nothing reads them. `db_ref` names the
  database holding a hub's rows (`shared` = the multi-tenant one);
  `redirect_to` is where a hub's hostname lives after it leaves.
- **Export manifest**: `EXPORT_MANIFEST` in `src/db/schemaContract.ts`, the
  30 tables with `hub_id`, each `export` or `omit`. Omitted, with reasons:
  `sessions` (bearer credentials), `pending_verifications` (live codes),
  `link_previews` (a cache). `tests/unit/exportManifest.test.ts` derives the
  tables with `hub_id` from the migrations and fails on any disagreement,
  including with `forHub()`'s table list.
- **Search is per hub**: `search_processes` / `search_processes_count` take a
  required first argument `p_hub_id` (`20260924050000`), called through
  `forHub().rpc()`, which is where the `p_hub_id` name for RPC hub arguments
  is fixed. The old signatures are deprecated wrappers for the
  migration-default hub until the cleanup migration.
- **The waitlist** reads and writes through `forHub()`.

**Phase 2b adds** (recorded, not done):
1. **First, as its own step with a staging rehearsal:** `unique (hub_id, id)`
   on every parent table and composite foreign keys `(hub_id, x_id) →
   (hub_id, id)` for all 14 row-to-row references (`process_links.from_id`
   and `.to_id`, `sessions.user_id`, `proposal_supports.proposal_id`,
   `feedback_submissions.user_id`, `project_updates` / `project_sentiments` /
   `project_comments.project_id`, `wordcloud_submissions.process_id`,
   `process_reviews.process_id`, `review_turns.review_id`,
   `processes.review_id`, `brief_responses.brief_id` and `.responder_id`).
   Today the database allows a row in one hub to reference another hub's
   row.
2. **A per-hub base URL from `hubs.hostname`.** `baseUrl()` / `uiBaseUrl()`
   read `BASE_URL` / `CIVIC_UI_BASE_URL`, so every hub on the shared
   deployment stamps the same `source.hub_url` and `action_url` on its events.
   **Done in 2c:** both read the hub in scope's `hostname` —
   `https://<hostname>`, or outside production for a local hostname
   (`athens.localhost`) `http://` with the port of the env origin — and fall
   back to the env vars only with no hub in scope. Every caller already went
   through the two functions, so events, email links and admin links follow.
   Events stored before keep the origin they were written with (the log is
   append-only); Athens's and Utopia's dev events from before name Floyd's
   dev host.
3. **A cron registry in code**, one list that the Vercel schedule, the
   `/internal` mounts and the route docs are generated from or checked
   against (today: `vercel.json` "crons", `src/app.ts` mounts and docs).
   **Done in 2c:** `src/jobs/registry.ts`. Routes and docs are generated
   from it; `vercel.json` is checked against it by
   `tests/unit/jobRegistry.test.ts`; `npm run jobs:crontab` prints a crontab
   (`-- --vercel` prints the section to paste).
4. **The `post-images` bucket created by a migration** (today it exists
   only as a comment in `20260427100000`). **Done in 2c:**
   `20260924070000_post_images_bucket.sql` (see "Storage" under Phase 2c).
5. **GRANTs to Supabase role names guarded** so they no-op on plain
   Postgres where `authenticated` / `service_role` do not exist. **Done in
   2c:** every one, in the nine migrations that had them, is inside
   `IF EXISTS (… pg_roles … 'authenticated') AND EXISTS (… 'service_role')`.
   Those nine files were edited in place (their effect is unchanged where the
   roles exist, which is everywhere they have run); a new migration could not
   have guarded them, since a plain-Postgres replay fails before reaching it.
   `tests/unit/portability.test.ts` fails on any unguarded one.
6. **Generic fallbacks for `VERCEL_*` env reads** (`src/app.ts`:
   `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`). **Done in 2c:**
   `src/config/deployment.ts`, with `GIT_COMMIT_SHA` and `DEPLOYMENT_ID` as
   the generic names; nothing else in `src/` reads a `VERCEL_` variable.
7. **The lint rule**: `no-restricted-imports` banning `@supabase/supabase-js`
   and `src/db/client.ts` outside `src/db/` and `src/control/`, keyed on the
   `@civic-raw-client` tag in `client.ts`.
8. **At the end of 2b, two atomic Postgres functions called through
   `forHub().rpc()`**: `transition_process` (a process state change and its
   event, in one transaction) and `cast_vote` (ballot, receipt,
   participation and event, in one transaction). Today each is several
   separate calls: a failure between them leaves state without its event,
   or an event without its state, and a ballot's three writes rely on
   hand-written rollbacks.
   **Done in 2c:** `20260924080000_atomic_transition_and_vote.sql`, called
   through `src/db/atomic.ts`. `transition_process` gained one trailing
   optional argument beyond the brief's signature, `p_state jsonb DEFAULT
   NULL`, because `executeAction` writes state and status in one update and
   the state must be in the same transaction. In use: `executeAction` (a status
   change and its `process.updated` event), `archiveProcess`, `restoreProcess`,
   and every ballot (`recordOrUpdateVote` → `cast_vote`, the `vote_submitted`
   event built by `buildEvent()` and written by the function). Both lock and
   check the process row's hub, check every row a re-vote touches, stamp every
   insert, and refuse an event naming another hub (42501). The ballot-secrecy
   layout is the July audit's, unchanged. Handler-emitted lifecycle events
   inside `handleAction` (a vote's `started`, `ended`) are still written before
   the transition commits — the transaction covers the status change and the
   event that records it, not every event an action emits.

**The cleanup migration after cutover** drops, with the `DEFAULT 'floyd'`s
and the deprecated search wrappers: `users_email_key`,
`pending_verifications_pkey` (email), `waitlist_pkey` (email),
`link_previews_pkey` (url); the per-hub constraints beside them become the
keys.

**Owned by the self-hosting plan, outside this repo:** idempotent early
migrations or a baseline schema, and a migration-history writer for the
bundle (the Supabase CLI records applied migrations in
`supabase_migrations.schema_migrations (version text not null, statements
text[], name text)`, a plain table the bundle can reproduce).

_checklist to be pasted_

### Phase 3 — forced RLS with the JWT claim

Done when: every table has `FORCE ROW LEVEL SECURITY` and a `hub_id` policy;
the app runs end-to-end as `authenticated` with a minted token; a query
with the wrong `hub_id` returns zero rows; service role still sees all; and
`civic-hub/supabase/config.toml` is committed so `supabase start` reproduces
the auth configuration the policies assume.

**Add `supabase/config.toml` in this phase.** `civic-hub/` has none today —
the CLI is used only for `db push`, so nothing about local auth is pinned,
and the spike had to `supabase init` into a scratch directory to get a stack
at all. Without it there is no reproducible local environment for the RLS
work, and Phase 6's rehearsal (restoring a production dump and replaying the
cutover) has nothing to restore into. The file must pin at least the
`[auth]` block including `signing_keys_path`, and the `[api]` schemas. Note
that `signing_keys.json` itself is a private key and is gitignored, never
committed; the committed config points at a path each developer generates
with `supabase gen signing-key --algorithm ES256`.

See "Phase 3 approach (verified)" below for the verified mechanism.

**Phase 3 adds, from the exit-rights audit (Adam, 2026-09-24):**
- **Every policy calls one SQL function, `current_hub_id()`**, which reads the
  JWT claim now (`current_setting('request.jwt.claims', true)::json->>'hub_id'`).
  One definition means a later change of where the hub comes from is one
  function, not thirty policies.
- `FORCE ROW LEVEL SECURITY` on the ten tables that have RLS enabled but not
  forced: `deliberation_drafts`, `hub_settings`, `project_comments`,
  `project_drafts`, `project_sentiments`, `project_updates`, `projects`,
  `proposal_drafts`, `vote_drafts`, `waitlist`.
- **Tokens are verified by PostgREST with its configured key** — the
  Supabase signing key on the hosted project, PostgREST's `jwt-secret` (or a
  static JWK) self-hosted — **never via GoTrue's JWKS endpoint**, so Supabase
  Auth is not a dependency. Where "Phase 3 approach (verified)" below
  mentions `/auth/v1/.well-known/jwks.json`, read it as how the hosted
  project exposes the key, not as what the app relies on.

_checklist to be pasted_

#### Phase 3 as built (2026-09-25)

**Policies (`20260925000000_hub_isolation_policies.sql`).** One template,
`public._civic_apply_hub_policy(regclass)`: enable + FORCE row-level
security, and one policy per table, `hub_isolation`, `FOR ALL TO
authenticated USING (hub_id = (SELECT current_hub_id())) WITH CHECK (same)`.
Applied to every `public` table carrying `hub_id` (30; `hubs` keeps its
deny-all and is read by the service-role registry only). `FOR ALL` is what
`transition_process` / `cast_vote` (SECURITY INVOKER) need: their inserts,
updates and the `FOR UPDATE` lock on `processes` are checked against the
caller's hub. The policy reads `hub_id` only — no ballot, receipt or
participation row decides anything. `sessions` got its hub-leading index
(`sessions_hub_id_idx`). **A table added later calls
`SELECT _civic_apply_hub_policy('<table>')` in its own migration** (and gets
`hub_id` + a hub-leading index); the catalog test fails until it does.

**Minted token (`src/db/hubToken.ts`, `src/db/client.ts`).** Env names:

| Var | Meaning |
|---|---|
| `CIVIC_HUB_MINTED_TOKEN` | the switch; default off; read on every `forHub()` call |
| `CIVIC_HUB_SIGNING_KEY` | an EC P-256 private JWK → ES256 (the production path); an `oct` JWK or any other string ≥ 32 chars → HS256 (PostgREST `jwt-secret`, a project's legacy secret, the local stack) |
| `SUPABASE_PUBLISHABLE_KEY` | the gateway key sent as `apikey` (the plan's snippet named it) |

Claims: `iss: "civic-hub"`, `role: "authenticated"`, `hub_id`, `iat`, `exp`
(60 s). One token per hub, re-minted at half-life, supplied through
supabase-js's `accessToken` callback, so every request carries a current
token for exactly the hub of its `forHub()` — which makes crons, which walk
hubs in one invocation, per hub for free. Scripts are pinned to the service
role (`pinServiceRole()` in `scripts/lib/hubScope.ts`); `src/db/hubs.ts`,
`storage.ts`, `health.ts`'s ping and `schemaCheck.ts` stay service role.
**`GET /health` reports `hub_db: { mode, ok }`**; in `hub_token` mode it
runs one query for the host's hub as that hub's token, so a key PostgREST
does not hold shows as `degraded` (503), not as broken pages.

**Catalog (`20260925010000_tenancy_catalog.sql`).** `public.tenancy_catalog()`,
service role only: one row per `public` table (hub_id, RLS enabled/forced,
hub-leading index, policies with their expressions) plus the post-images
policies on `storage.objects`. `tests/api/rlsCatalog.test.ts` holds every
table to the rules; **run it against a database before switching tokens on
there** (`POST /rest/v1/rpc/tenancy_catalog` with the service key) — this
is the "check `pg_policies`" step from the 2c notes, made mechanical.
`hubs` is the one table without `hub_id` (deny-all, no policy).

**Dev (2026-09-25).** Both migrations applied; catalog clean. Key: **HS256
with the dev project's legacy JWT secret** (Adam's choice for dev; the
project already runs JWT signing keys, and the legacy secret is its
"Previous key", still verifying — do not revoke it before the ES256 switch).
ES256 remains the production path. Phase 3's "done when": FORCE + policy on
every table (catalog test), end-to-end as `authenticated` (CI's second pass,
and this branch against dev with the flag on), wrong `hub_id` → zero rows
and service role sees all (`leakHarnessDb.test.ts`), `config.toml`
committed (Phase 1).

### Phase 4 — settings as data, place-names out of `src/`

Done when: the alias map above is live, every `VITE_HUB_*` / place-name
env var has a settings key, `grep -ri floyd src ui/src` returns only
comments and test fixtures, and the admin Settings tab edits the new keys.

#### Part four (2026-09-24): the backend sweep

**Utopia is in `beta` mode.** Adam's part-four prompt asked for it to be set
at the start of the session; it already was (`hubs.mode = 'beta'` on the dev
project when checked, 2026-09-24), so nothing was written. Utopia was created
`live` in part three as the one hub that could email a stranger; in `beta` the
mail guard suppresses anyone off its admin roster and allow list, like Floyd.

**Crons for per-hub plugins iterate hubs now.** News sync and meeting
summaries run once per active hub inside that hub's scope
(`src/services/cronHubs.ts`), because their configuration is exactly the
per-hub data this phase moves out of the code. The digest crons still run
unscoped until Phase 2. What these crons create still lands in the shared
`processes` table until Phase 2 adds `hub_id`.

**Cutover hazard — Phase 6 must act on it.** Env fallbacks are
deployment-wide: a hub with no row reads the env var. On the shared production
deployment, `MEETING_SOURCE_URL` / `MEETING_YOUTUBE_CHANNEL_ID` / etc. would
answer for every hub without its own row (a new hub would summarize Floyd's
meetings), and a lone `FLOYD_NEWS_SOURCE_URL` would make every hub's news
sync invalid. The runbook seeds Floyd's plugin rows
(`scripts/seed-hub-settings.ts --only plugin.`) and then removes the
`MEETING_*` and `FLOYD_NEWS_*` env vars from production in the same session.
After that, the seven entries in `scripts/place-name-allowlist.txt` marked
"until the cutover" are deleted with the code they excuse.

**Values with no home — decided with Adam, 2026-09-24:**
- The assistant's scenery clause ("a small rural community in the Blue Ridge
  Mountains") is dropped for good; the community line is generic,
  `residents of <jurisdiction_name>`. No key.
- The synced-post author label stays derived, `"<place> Government"`. No key.
- Seed data stays as it is for now: Floyd's one-off production content
  scripts and Athens's demo set in `src/debug/seedDataAthens.ts`. How a new
  hub gets starter content — generic seed data, perhaps launching in demo
  mode — is a later piece of work.
- The place-name check keeps Floyd's names only. Widening it to every hub's
  names belongs with that seed-data work, since Athens's demo set in `src/` is
  the only thing it would catch today.

#### Hub admin edits in the UI (Phase 1 part five, 2026-09-24)

Recorded from Adam's part-five prompt, whose steps list these values; the
code's copy is `src/shared/hubSettingsSections.ts`, and the settings endpoint
(`PUT /admin/hub/settings`) refuses any key not in it. Change both or neither.

| Section | Keys | Notes |
|---|---|---|
| Identity | `identity.name`, `.label`, `.tagline`, `.page_title`, `.description`, `.banner_url`, `.banner_alt`, `.logo_url`, `.timezone` | `identity.name` is the display name; the registry name (`hubs.name`) is unchanged by it. Banner and logo upload under `<hub id>/identity/` in the image bucket (`hubs/<hub id>/` until Phase 2b; those objects keep their keys). |
| Copy & pages | `copy.intro_body`, `.residency_intro`, `.welcome`, `.about`, `.resident_noun`, `.governing_body_name`, `.governing_body_short` | `copy.welcome` and `copy.about` are documents. |
| Legal | `legal.terms`, `.privacy`, `.code_of_conduct`, `.proposal_best_practices`, `.operator_name`, `.contact_email`, `.who_runs_this` | A document saved identical to its shared template is stored as `""`, so the hub keeps following the template ("restore default"). |
| Email | `email.from_name`, `email.postal_address` | `email.from_address` is shown read-only: the sending domain is the platform's. The three digest keys it held moved to Plugins in Phase 2c. |
| Theme | `identity.theme` | Its own section since 2026-09-24: a theme object (preset, primary, accent, background, one hue per process type), stored as canonical JSON; a bare `#rrggbb` still reads as the primary. Model: `src/shared/theme.ts`. |
| Plugins | `plugin.<id>.enabled` for all 14 ids; `plugin.vote.min_duration_days`, `.max_duration_days`, `.default_duration_days`; `plugin.conversation.polis_url`; `plugin.wordcloud.onboarding_id` (kind `process`, added 2026-10-06); `plugin.meeting_summary.connector_id`, `.source_url`, `.youtube_channel_id`, `.title_filter`, `.type_exclude`, `.cutoff_date`, `.auto_publish`, `.extraction_instructions`; `plugin.news_sync.connector`, `.source_url`; `plugin.digest.send_hour` | Added in Phase 2c (Adam, 2026-09-24; per-plugin settings decided 2026-09-22). One card per plugin: the switch, and beneath it that plugin's settings. Keys another section owns are shown read-only with a link, never repeated (one writer per key): announcement authors and brief recipients → Officials; `plugin.vote.support_threshold` and `moderation.comment_identity_mode` → Participation. `youtube_channel_id` is beyond Adam's list: the YouTube connector is one of the choices and needs it. |
| Mode | `hubs.mode` (beta / live) | Its own endpoint with the emailed-code step-up; a demo hub shows "set by the platform". |
| Admins & board | `people.admin_emails`, `people.board_emails` | Existing `POST /admin/hub/people`, step-up. |
| Officials | officials roster + `people.brief_recipients` | Existing `PATCH /admin/settings`. |

**Three keys added with Adam, 2026-09-24:**
- `identity.logo_url` — the hub's browser-tab and home-screen icon, and a
  64 px mark left of the place name on the home page (moved out of the nav
  bar after the walkthrough: at text height it was unrecognisable). A square
  PNG, at least 256 × 256. With none, the icon is the hub's initial on its
  theme colour. **Public**: the one addition to the public subset in part
  five, because every visitor's page renders it.
- `identity.theme` is now read: a `#rrggbb` accent the UI applies over
  `--color-primary` (and a derived hover shade) at boot. Empty = default palette.
- `plugin.digest.send_hour` — 0–23. **Superseded in Phase 2c:** read in the
  hub's `identity.timezone` (UTC when unset, so a value stored before 2c
  keeps its meaning), and the digest job runs hourly and per hub. Unset = 13.
  The original note, kept for the record: 0–23, UTC. **Stored only until Phase 2.** The
  digest cron runs once a day (13:00 UTC) with no hub in scope, and `users`
  has no `hub_id`, so running it per hub now would mail every user on the
  shared table once per hub. `plugin.digest.enabled` and
  `plugin.admin_digest.enabled` are stored per hub on the same terms; the
  cron still reads `DIGEST_ENABLED` / `ADMIN_DIGEST_ENABLED`. Phase 2 makes the
  digest crons hourly and per hub, and they read these three.

_checklist to be pasted_

### Phase 5 — control plane + wildcard hostname

Done when: `*.civic.social` resolves to the one Vercel project (GoDaddy
CNAME plus the `_acme-challenge` delegation, Vercel Pro — steps in
`RUNBOOK-cutover.md` §8), a new hub can be created from `/control/hubs` by a
platform admin with the reserved-slug check enforced, and the Athens demo
runs as hub #2 on the same deployment.

#### The dev wildcard (Adam + management session, 2026-09-27)

Dev takes production's shape so a new dev hub is live the moment it is
created, with no `vercel alias set`: console `console.dev.civic.social`,
hubs `<slug>.dev.civic.social` (production: `console.civic.social`,
`<slug>.civic.social`). Same method as §8, one level down: `*.dev.civic.social`
added to **`civic-hub-dev`**; "Enable Vercel DNS" on `civic.social` (shared
with production, so it is already done for that sitting); at GoDaddy `NS`
`_acme-challenge.dev` → `ns1`/`ns2.vercel-dns.com` and `CNAME` `*.dev` → the
value on Vercel's domain card; then `CIVIC_CONSOLE_HOSTNAME=console.dev.civic.social`
on `civic-hub-dev` and a redeploy. The console's suggested hub address follows
from that variable (`platformDomain()`); `vercel.json` must also name the
console hostname (it does since 2026-09-27; `tests/unit/consoleRouting.test.ts`).
Athens, Utopia and `sample-walk` move to `<slug>.dev.civic.social` through the
console; their old `vercel.app` addresses stay taken.

Checked before starting (2026-09-27): sessions are host-only (hub sign-in is
a bearer token in each origin's `localStorage`; the console cookie has no
`Domain`), so nothing set on a dev host reaches a production host;
`CIVIC_ALLOWED_ORIGINS` is an exact-match list that governs cross-origin
callers only (every hub UI calls its own `/api` on the same origin, so new
hub hostnames need no entry); nothing exists at or under `dev.civic.social`
and there is no `_acme-challenge` record; `dev` is a reserved slug; the
production wildcard matches one label, so it never catches `x.dev.civic.social`.

#### The super admin, as decided (Adam, 2026-09-26)

- **Where it runs: the same Vercel project, on its own hostname.** Express
  routes the console hostname to `src/control/` only; the hub app cannot
  import `src/control/` (lint rule `civic/control-boundary`); every control
  route also checks, on the server, that the request arrived on the console
  hostname and refuses it otherwise.
- **Hostname:** `console.civic.social`; on dev
  `console-civic-hub-dev.vercel.app`. A config value
  (`CIVIC_CONSOLE_HOSTNAME`), never a literal in code. Unset = no console.
- **Sign-in:** the emailed code (same rules as a hub's: `civic.auth/otp.ts`),
  a one-person allow-list (`CIVIC_CONSOLE_ADMIN_EMAIL`, exactly one address),
  and step-up (a fresh code) for anything destructive.
- **Retiring a hub:** `hubs.archived_at` (additive). Archiving sets it and
  `status = 'suspended'`, and takes step-up; unarchiving clears it. **No hard
  delete** — that belongs to the later lifecycle work, with export offered
  first and a retention window. An archived hub's slug and hostname stay
  taken forever (old links, published events and DID documents point at
  them); a hub that moves out uses `redirect_to` instead.
- **Reserved slugs:** one list in code, `RESERVED_HUB_SLUGS` in
  `src/models/hub.ts`, each with what it is for. The original ten stay in the
  `hubs_id_not_reserved_check` constraint; names added since (some are live
  today, e.g. `floyd`, so a constraint could not hold them) are enforced by
  the validator every create path calls.
- **Audit log:** `control_audit_log`, append-only, exempt from the tenancy
  catalog with its reason (not hub data).
- **Guard:** creating a hub on the production database is refused while any
  `MEETING_*` or `FLOYD_NEWS_*` env var is set and a hub already exists:
  those env fallbacks apply to every hub on the deployment, so a second hub
  would inherit Floyd's meeting and news sources. ("Production" = the
  production Supabase ref in `SUPABASE_URL`, the test `create-hub.ts`
  already used. Confirmed by Adam, 2026-09-26.)

**Deferred, not done:** Hub app off the service-role key; super admin in its
own Vercel project. Required before the first paying hub or any self-serve
sign-up. In one project every piece of code can read the key, so the goal
"the super admin is the only surface holding the key" is not met yet: the
hub app still reads it for the registry (`src/db/hubs.ts`), the health ping
and the schema check.

#### The sending domain belongs to the platform, not to a hub (2026-09-23)

**Only `floyd.civic.social` is verified in Resend.** The apex `civic.social`
is not, so every hub on the deployment must currently send as
`noreply@floyd.civic.social` — Athens's mail goes out as
"Athens Civic Hub (demo) <noreply@floyd.civic.social>". Tolerable on dev,
wrong in production: a hub's mail should not authenticate as another hub's
domain, and a resident who checks the sender learns the wrong thing about who
wrote to them. It is the same class of bug as Floyd's operator appearing on
Athens's terms page, one layer down.

The fix is to verify a platform-owned sending domain — `civic.social` itself,
or `mail.civic.social` — and point `RESEND_FROM` at it. Verifying the apex
does NOT disturb the marketing site: Resend's records are a DKIM `TXT` plus an
`MX`/SPF pair on a `send.` subdomain, none of which touch the apex `A`/`CNAME`
that Firebase serves from. Per-hub sending domains (a hub bringing its own
verified domain via `email.from_address`) already work and stay the exception,
not the default.

Until then `email.from_name` carries the per-hub identity, which is why that
setting exists separately from the address at all.

#### Part two: export, import, restore — as decided (Adam + planning session, 2026-09-26)

Exit rights made real: one hub's data leaves as a documented bundle, comes
back into a fresh install, and is restored after a mistake.

- **Database access for import and restore: `pg` (node-postgres)**, a
  devDependency used by `scripts/` and tests only (ADR-005). One code path
  for Supabase (its Postgres port) and a plain Postgres single-hub install.
  **The database URL comes from an env file, never the command line**
  (`node --env-file=<file>`; `CIVIC_TARGET_DATABASE_URL` for import/restore,
  `CIVIC_SOURCE_DATABASE_URL` for an export read straight from Postgres, e.g.
  a restored full dump). A script given a URL as an argument refuses.
- **Clearing `events` and `review_turns`** (append-only triggers) exists
  only in the restore script, behind `--clear-append-only`. **Every import
  and every restore writes a `control_audit_log` row** on the target.
- **Images: every object the hub owns is copied into the bundle and
  imported under the hub's prefix on the target** — including the objects
  stored before the prefix existed (`YYYY/MM/…`, the migration-default hub's;
  `hubs/<id>/…`, `<id>`'s). Their URLs are rewritten to the target's storage
  like every other copied object; an exported hub never depends on the old
  host. The bundle records each object's owner and the rule that assigned it.
  The Phase 2c "do not copy" decision was about moving objects inside one
  bucket at cutover and does not apply to exports.
- **Console export: private `hub-exports` bucket + signed URL.** Vercel caps a
  response at 4.5 MB, so the archive is written to a service-role-only bucket
  and the operator gets a ~10-minute signed URL. Takes step-up; audited
  (`hub.export`, object key and size). **Export objects are deleted after 24
  hours by a sweep job in the registry; the audit row stays.** The bucket
  migration joins the production sitting's list after `20260926010000`.
- **Deadline stamp (fix 6): every close of a past-deadline vote — hourly or
  on read — is stamped with `voting_closes_at`.** Manual closes stay "now".
  **An hourly registry job closes past-deadline votes on hubs where the Votes
  plugin is on**, so the lag is at most an hour everywhere; the lazy close
  stays as the fallback. **The digest selects events by when they were
  recorded (`events.recorded_at`, additive, default `now()`), not by their
  stamped time**, so a backdated close is still in the next digest.
- **Settled in the session:** bundle = a directory (`README.md`,
  `manifest.json` with `format_version`, `hub.json`, `tables/<t>.jsonl`,
  `images/…`); the `.tar.gz` form packs the same layout. Round trip on a
  reset local stack with the seeded `athens` row removed. CI: a seeded test
  hub exported, cleared, restored, and imported into a plain-Postgres
  database in the same cluster.

_checklist to be pasted_

### Phase 6 — cutover runbook (Adam runs by hand)

Done when: the runbook has been rehearsed against a restored dump of
production in a local Supabase, with timings, and the rollback step has
been exercised once.

**The runbook is `RUNBOOK-cutover.md`** (Phase 4 part one, 2026-09-25):
rehearsed against a fresh production dump loaded into the **dev project**
(Adam's call for that session, in place of a local stack), timed, with the
rollback exercised both ways. Decisions made there: code reaches production
by merging `multi-tenant` into `main`; `MEETING_*` / `FLOYD_NEWS_*` leave
production at cleanup, not in the window (the hazard note in Phase 4 said
the window; rollback needs them for the week); a rollback re-adds a unique
index on `hub_settings (key)` for `main`'s settings writer.

_checklist to be pasted_

### Phase 7 — Sample content for new hubs

Decided by Adam (build prompt + two rounds of answers, 2026-09-26). The build
prompt is the design; these are its settled points.

Done when: a hub created from the console with "Start with sample content"
on opens with 8–10 sample processes that read as local, carry a "Sample"
badge under a demo banner, stay out of `/events`, federation, the export and
residents' digests, and come out in one audited action — after which the
hub is empty and still works.

- **The seed set** is a data file of place-neutral templates adapted from the
  Floyd use cases (`seedBetaSlate.ts`, `src/debug/seedData.ts`): a proposal,
  an open vote, a vote gathering endorsements, a closed vote with its
  published outcome, a deliberation with statements, a project with an
  update, two announcements. Substitution only: `{HUB_NAME}`,
  `{JURISDICTION}`, `{GOVERNING_BODY}`. No generated local facts; nothing
  attributed to a real person. Deadlines are relative to the seeding time.
  The list is approved by Adam before the templates are written.
  **Later**, this set becomes the basis for presets (town, county, school
  district): the same content with a different governing body.
- **Fit by jurisdiction type** (Adam, 2026-09-26): each template is tagged
  with the `identity.jurisdiction_type` values it reads right in, and the
  seed skips the rest (no type set = "other"). School districts are not
  covered properly now — only the library-hours vote and its outcome and the
  budget-hearing announcement fit — so a school district hub gets those and
  the operator adds the rest; covering them is the presets work.
- **Tone** (Adam, 2026-09-26): neutral and nonpartisan, and it must read
  right in a city as well as a rural county. Every vote has real options on
  more than one side; statements and comments cover several viewpoints (for,
  against, practical questions), none a strawman. No real people,
  businesses, organizations or places. The copy is in
  `src/services/sampleTemplates.ts`, approved by Adam as written.
- **Authors** are synthetic per-hub users (`user_sample_<hub>_00N`, a
  `.invalid` address, no digest), marked `is_sample`. Ids are per hub because
  `users.id` alone is the primary key.
- **Governing body: one key, `copy.governing_body_name`** (no
  `people.governing_body`; it stays in the Copy section). The console's
  create form infers a default from a new **`identity.jurisdiction_type`**
  setting (county / city / town / village / school district / other;
  admin-only): county → "Board of Supervisors" when `jurisdiction_code` is
  `us-va-…`, "County Commission" elsewhere; city → City Council; town →
  Town Council; village → Village Board; school district → School Board;
  other → blank. The operator can always correct it. Available to the legal
  and About templates as `{GOVERNING_BODY}`.
- **Marker: `is_sample boolean not null default false` on `processes`,
  `events` and `users`.** A column, not a state field: `/events`, the digest,
  the export, federation and removal filter it in SQL; events have no
  process state. Child rows (ballots, comments, supports, updates, links,
  submissions) are found through their sample `process_id`. The database
  stamps `events.is_sample` from the event's process on insert, and a
  process spawned from a sample process (brief, results, converted vote)
  inherits it, so a real resident's action on a sample process can never
  reach public record.
- **Events stay append-only for the hub app.** A DELETE on `events` by the
  hub-token role (`authenticated`) is refused unless `OLD.is_sample`; the
  service role and the owner (BYPASSRLS; scripts, restore, tests) are
  unaffected. A test proves both halves. `review_turns` is unchanged (the
  seed writes no reviews).
- **Sample stays out of** `GET /events`, `/activities/:id`, any federation
  output, the hub export (`isSampleContentRow()`) and every resident digest.
  It stays IN the hub's own feed and lists, with a "Sample" badge. Sample
  votes close on schedule through the hourly `vote_close` job.
- **Demo banner** (new): a strip on every page of a `demo` hub — "This is a
  demo hub. Content marked Sample is illustrative, not public record." — with
  a "Remove sample content" link for the hub's admin. Beta keeps its banner.
- **Removal:** a control in the hub admin's settings, in every mode, deletes
  all sample content for the hub. It warns first that the hub will have no
  processes until the admin creates some, and that real people's input on
  sample processes (comments, endorsements, ballots) goes with them, with a
  count when there is any. Takes a fresh code. Graduating out of demo asks
  the same question.
- **`hub_admin_audit_log`** (new, hub-scoped: `hub_id`, forced RLS,
  append-only, exported with the hub) records every hub-admin action that
  takes a fresh code: sample-content removal, every mode change, admin and
  board roster changes. Nothing is mirrored into `control_audit_log`; the
  console's hub page reads this table through the control plane.
- **Seeding:** `scripts/seed-sample-content.ts --hub <id>` (the
  `seedBetaSlate` pattern: real code paths, fixed ids, `--dry-run`), and a
  "Start with sample content" checkbox, on by default, on the console's
  create form. Running it twice duplicates nothing.
- **Deliberation:** the sample conversation is served by the `seed-` mock
  layer; nothing is sent to Polis. After graduation, real deliberations use
  Polis as usual.

### Jurisdictions, plugins at creation, purge, platform postal address (2026-09-27)

Decided by Adam (build prompt + answers in the session, 2026-09-27). Goal:
every hub's jurisdiction comes from a reference list with a standard id,
never loose free text — now, and for self-created hubs under the SaaS plan.

**Reference table `jurisdictions`** (`20260927000000`): `ocd_id` (primary
key, the Open Civic Data division id), `census_geoid`, `state` (two lowercase
letters, as in the OCD id), `type` (`state`, `county`, `city`, `town`,
`village`, `borough`, `cdp`, `school_district`), `official_name` (the
Census's), `display_name` (ours, below). Platform-wide, not hub data: no
`hub_id`, forced RLS with no policy, the service role may only SELECT, the
loader writes as the owner; `NOT_HUB_SCOPED` in the catalog test. Not in a
hub's export (the hub's own id travels in `hub.json`).

**Sources, license, versions** (verified 2026-09-27; recorded with sha256 in
`config/jurisdictions/SOURCES.md` once downloaded):

| Source | Where | Version | License |
|---|---|---|---|
| Census Bureau Gazetteer files: `2026_Gaz_{state,counties,place,cousubs,unsd,elsd,scsd}_national.zip` | `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/` (index: census.gov → Gazetteer Files → 2026) | 2026 | US government work, not subject to copyright in the US (17 U.S.C. § 105) |
| OCD division ids, `identifiers/country-us.csv` | `github.com/opencivicdata/ocd-division-ids` | commit `b5911539ae7f79b5edf6b301c8002bb3db3e3e87` (2025-12-08) | CC0 1.0 (`LICENSE.md`) |

`scripts/fetch-jurisdiction-sources.sh` downloads exactly these (by hand:
sessions have no network). `scripts/build-jurisdictions.ts` joins them on
the Census GEOID and writes the committed `config/jurisdictions/us-jurisdictions.csv`
and its `.sha256`. A row with no current OCD id for its GEOID is left out and
counted, never given an invented id. `scripts/load-jurisdictions.ts` loads the
committed file on any install (plain Postgres included): checksum first, one
transaction, upsert by id, unlisted rows deleted unless a hub points at them,
the checksum recorded in the table comment so a second run is a no-op.

**OCD id formats** — Adam's working examples, to be confirmed from the file
(see HANDOFF for the result): Floyd County `ocd-division/country:us/state:va/county:floyd`;
the Town of Floyd a `place:` under Virginia. The OCD README: a place's name
drops "city", "township", "borough" unless "city" is in the Census name;
Louisiana has parishes, Alaska boroughs and census areas, and Virginia's
independent cities are places with no county.

**What is in** (by the gazetteer's own words): the 50 states and DC; counties
and parishes; Alaska's boroughs (type `borough`); places named "… city /
town / village / borough" with an active government; census-designated
places; county subdivisions named "… town" with an active government (New
England, New York, Wisconsin); unified, elementary and secondary school
districts. Left out: census areas, independent cities' county-file rows (their
place row covers them), "(balance)" rows, townships, territories, inactive or
fictitious entries.

**Display names** (Adam): "Floyd town" → "Town of Floyd, Virginia"; "… city"
→ "City of …, State"; "… village" → "Village of …, State"; a "… borough"
place → "Borough of …, State"; a CDP drops "CDP": "Merrifield, Virginia";
counties, Alaska boroughs and school districts keep the Census name plus
", State": "Floyd County, Virginia"; a state is its name.

**Hubs point at it:** `hubs.jurisdiction_ocd_id` (nullable, FK, no
uniqueness: several hubs may serve one jurisdiction) and
`hubs.jurisdiction_custom` (`boolean not null default false`; a check: custom
⇒ no OCD id). Custom = the operator chose "Other / not listed" and typed a
name; false with a null id = a hub from before the list, not linked yet.
`jurisdiction_code` and `jurisdiction_name` stay as they are. **A place hub's
jurisdiction comes from the list or is marked custom**; a name with neither is
refused by `planCreateHub()` (every create path); hubs of other kinds may
have none (below). Export: the id is in
`hub.json`; import refuses a bundle whose id is not on the target's list.

**Hub type** (`identity.jurisdiction_type`) gains **`borough`** (governing
body "Borough Council"; the local-government sample templates). The
reference row keeps its precise type; the hub's collapses `cdp` and `state`
to `other` (Adam). A CDP has no government of its own; the console says so.

**Console create form:** state → type → type-ahead (the state's
jurisdictions of that type; name prefix first, then a later word). Choosing
one fills the display name, the OCD id, the hub type and the usual governing
body, and shows the code the server will derive (below). "Other / not listed" takes a typed
name. **Slug suggestion:** the shortest free, unreserved address, in this
order: plain name (`floyd`), name + type (`floyd-town`, `floyd-county`,
`…-schools`), name + state (`floyd-va`), name + a number (`floyd-2`, …); free
means no hub has the slug, it is not reserved, and its hostname under the
platform domain was never used. The operator can edit it. Hubs already
serving the jurisdiction are shown as information. **Plugins** section: a
checkbox per plugin, all on, collapsed; every plugin gets its own
`plugin.<id>.enabled` row at creation, so no env fallback decides for a new
hub. The hub page edits the jurisdiction the same way; the change is a
`hub.update` audit row.

**Sample content ignores plugin switches:** the seed writes every template
the jurisdiction type allows, with every plugin treated as on for the run
(the stored settings are untouched). Content whose plugin is off stays hidden
like any process of that type until it is turned on; removal takes all of it.

**The jurisdiction code** (Adam, 2026-09-27): **derived from the OCD id once,
at creation (or when a code-less hub is first linked), stored, and never
recomputed**; the console shows it and nobody types it (a sent code is
refused). Rule (`jurisdictionCodeFor`, `src/shared/jurisdictionNames.ts`):
`us-<state>` for a state; `us-<state>-<name>` for a county, parish or Alaska
borough; `us-<state>-<segments>-<type>` for anything smaller, where
`<segments>` is every OCD segment below the state, broadest first (a school
district sits under its county: `us-va-floyd-floyd-co-pblc-schs-schools`).
Unique across all 38,858 rows; Floyd County `us-va-floyd` (what Floyd has
always published — env, row and published activities agree), the Town of
Floyd `us-va-floyd-town`. Custom hubs, and hubs with no place, have no code.
**New processes and events take their own hub's code**
(`defaultJurisdiction()` in `src/config/hub.ts`), never the deployment's
`CIVIC_JURISDICTION`, which stamped one hub's place on every hub; a hub with
no code stamps `local`, which publishes no `location`.

**Hub kinds** (`identity.hub_kind`, Adam 2026-09-27). Not every hub has a
jurisdiction: `place` (a local government or community; jurisdiction
required, as above), `issue` (a campaign, e.g. ranked-choice voting),
`organization` (a group or club), `other`. The create form asks it first;
default `place`; unset (every existing hub) = place. For the other kinds the
jurisdiction is an optional **related place** (a listed row or custom);
leaving it empty = no OCD id, not custom, no name, no code, no governing body.
Server rule: a jurisdiction name needs an OCD id or the custom mark; a hub
with no jurisdiction is valid whenever its kind is not `place`; a jurisdiction
type and a governing body are for place hubs only. Fallbacks for a hub that is
not a place: the shared documents have `{{#place}}…{{/place}}` /
`{{^place}}…{{/place}}` sections (the non-place sentences name no place,
state or government; `resolveKindSections` in `src/services/hubDocuments.ts`),
and `{PLACE}` / `{JURISDICTION}` left in a hub's own text read as the related
place or the hub's name; sample names; the hub UI's headings and sign-up
affirmation; "N participants voted" in the feed and digest; the writing
assistant's community line. **Sample content:** every template is tagged
with the hub kinds it fits; all nine fit `place` only (each is about a local
government's services, budget or governing body), so a hub of another kind
gets none and the create form says so. **Writing templates for issue
campaigns and organizations is later presets work**, with the county / town
/ school district presets.

**Legal review before production sign-ups** (Adam, 2026-09-27): the shared
documents are draft starter content, and the lawyer's review before any hub
accepts production sign-ups must now also cover **hubs without a place**
(their `{{^place}}` sentences, governed by `legal.governing_state`), whose
operator may not be Civic.Social — a campaign or an organization running its
own hub is the operator its documents name.

**Census-designated places** (Adam, 2026-09-27): the OCD list has ids for 74
of 12,557; the rest are **not** given ids in the `ocd-division/` namespace. A
hub for one is "Other / not listed" for now, and a group there can link its
county as the related place. A possible later fix: key those rows by Census
GEOID in a namespace that is clearly ours (not `ocd-division/`), or
contribute them upstream to Open Civic Data.

**Later, not built (Adam, 2026-09-27):** an issue campaign may want several
related places — a statewide campaign with local chapters. Today a hub has one
optional link (`hubs.jurisdiction_ocd_id`); several would be a
`hub_jurisdictions (hub_id, ocd_id, role)` table, with the code question
answered for it then.

**Freeing a never-used hub's slug: `scripts/purge-hub.ts --hub <slug>`**,
operator-only, no console button. Refuses unless the hub is archived, has no
users but its admins and the sample authors, no non-sample process or event,
and no other hub's `redirect_to` points at it. Prints the plan; needs
`--confirm <slug>`; exports the hub to a local `.tar.gz` first (which holds
its `hub_admin_audit_log` rows: they are append-only and are deleted with
triggers suspended, the path restore uses, only after the bundle has them);
then, in one transaction, the `hub.purge` audit row (its `before` is the full
`hubs` row, `created_at` included), every row with the hub's `hub_id`, and
the `hubs` row; then its stored images. **`control_audit_log.target_hub_id`
is no longer a foreign key** (`20260927010000`, the one non-additive change,
Adam): the purged hub's audit rows stay, as text; the console's per-hub trail
splits a reused slug's lives at the `hub.purge` row. A hostname a hub had
before a hostname change stays taken.

**Platform postal address: `CIVIC_PLATFORM_POSTAL_ADDRESS`**, a Vercel env
var, platform-wide, kept after the cleanup. A digest footer prints the hub's
`email.postal_address`, else the legacy `HUB_POSTAL_ADDRESS` (until the
cleanup removes it), else the platform's; with none, no address line. The hub
admin's Settings → Email shows the address in use and where it comes from.

### Console and sample-content polish (2026-10-06)

Decided by Adam (session prompt + four answers in the session, 2026-10-06).
Built on `multi-tenant`; dev walk and checks in HANDOFF, "Console and
sample-content polish".

- **Governing body short form** (`copy.governing_body_short`, existing key):
  the distinctive word of the full name — Board of Supervisors →
  "Supervisors"; City / Town / Borough Council → "Council"; County Commission
  → "Commission"; Village Board → "Board"; School Board stays "School Board";
  "… of <members>" gives the members ("Town Board of Trustees" → "Trustees");
  any other "of" is read before it. Rule: `defaultGoverningBodyShort()` in
  `src/shared/jurisdictionType.ts`. **The console writes it**: Create hub has
  a Short form field that follows the governing body until edited, and the
  hub page edits it (`governing_body_short` on `PATCH /control/hubs/:id`). A
  hub with the key unset reads it derived from `copy.governing_body_name`; a
  hub with no governing body (any non-place hub) has none, and the UI drops
  the word: "Meeting summaries", "the governing body". Used for the feed's
  meeting pills and in running text ("passing on to the Supervisors", the
  digest's "delivered to the Supervisors"). The role names "Board member" /
  "Board members" are unchanged: they name the role in the software, not the
  body. Floyd's stored value is still "BOS" (seed data) until its admin or the
  console changes it.
- **Create hub form:** one Type field (the list's search filter, which also
  sets `identity.jurisdiction_type`; for a custom place, the hub type
  itself). Labels "Search the list", "Place name (as shown)", "Hub name".
  **Default hub name = the place without its state + " Civic Hub"**
  ("Floyd County Civic Hub", "Town of Floyd Civic Hub";
  `defaultHubName()` in `src/shared/jurisdictionNames.ts`), place hubs only,
  following the place name until the operator edits it. The place name's
  hint shows the sign-up sentence it lands in, and notes when it differs from
  the list's name.
- **Create hub, second pass (Adam, same day):**
  - *Picker:* the chosen place shows inside the Name field (× clears it,
    typing reopens the search); Enter picks the highlighted match or the only
    one left; "Already served by …" stays under the field. The OCD id and
    Census name are one small line under it (the separate card is gone).
  - *Suggestions, not fills:* once a place is chosen the empty fields show
    grey suggestions — place name, governing body, board label (its short
    form), hub name, web address, time zone. **An untouched suggestion is
    submitted as the value** (Adam); Tab or Enter makes it real text to edit;
    the form never changes a field the operator typed in. This replaces the
    morning's "follows until edited" filling.
  - *Web address:* one field, `[slug].<platform domain>`, with "Use a
    different domain" for the full hostname (Hub id + Domain). Adam's concern
    (two Huntsvilles) holds: names are free, only the address is unique, and
    the suggestion passes over taken ones (`huntsville`, `huntsville-al`,
    `huntsville-2`). A console with no platform domain (local) shows the
    domain fields.
  - *Time zone* on the form (Adam): grey suggestion from the place's state
    (`src/shared/stateTimeZones.ts`: 50 states + DC; the 13 states split
    across zones suggest the larger and the hint says to check). Stored as
    `identity.timezone` (validated at create); the admin changes it later in
    Settings → Identity.
  - *Labels and hints* say where each value appears: Place name ("shown at
    sign-up"), Governing body ("sample content and delivered results"), Board
    label, Hub name ("site header, browser tab, email sender name"), Web
    address, Time zone, First admin, Who can join (was Mode).
  - *Preview:* plain styled text beside the form (Adam: no hub components,
    no crossing the control boundary): web address, a header line (initial,
    hub name), the meeting pill with the board label, the first line of a
    sample card (`sample_preview` on `GET /control/config`, placeholders
    filled in the console), the sign-up sentence, the time zone.
  - Nothing moved off the form (Adam: keep everything).
- **Affiliation by hub kind** (`affiliationClause`, `personLabel`,
  `participantNoun` in `src/shared/hubKind.ts`): place — "I confirm that I
  am a resident of {place}", unnamed people "Resident"; organization — "I
  confirm that I am a member of {hub}", "Member"; issue campaign and other —
  no affirmation (anyone may take part), "Participant". The same nouns for
  "N members voted", the sign-up intro's fallback ("confirm your membership"
  / "review the policies below") and the server's byline fallback
  (`personFallbackName()` in `src/services/creatorDisplay.ts`).
- **Sample content, eleven templates** (the list grew by two, Adam's copy
  defaults accepted): `meeting_summary_regular` — "{GOVERNING_BODY} regular
  meeting", four sections with times (public comment, library-hours trial,
  road resurfacing bid, budget calendar), no recording or minutes, written by
  hand (`ai_model: "sample"`), `source_type: "minutes"` so the cron's upgrade
  pass never touches it; general-purpose governments only. The public page
  says it is a sample and shows its times as plain text, without the AI
  attribution (`is_sample` on `GET /meeting-summary/:id`).
  `wordcloud_value` — "In one word, what do you value most about
  {JURISDICTION}?", 32 anonymous answers inserted as rows (no events, like the
  sample ballots); every place type. **It becomes the hub's word cloud when
  `plugin.wordcloud.onboarding_id` is unset; removal clears that setting when
  it names a sample process** (recorded in the removal's audit row as
  `cleared`).
- **Polis default in one place:** `DEFAULT_POLIS_URL`
  (`src/shared/polisUrl.ts`); the sample seed now uses it, so a hub with no
  `plugin.conversation.polis_url` gets the same conversation address as the
  start action.
- **Word-cloud picker:** `plugin.wordcloud.onboarding_id` joins Settings →
  Plugins → Word clouds, a new field kind **`process`** (`processType`
  in the spec): one of this hub's processes of that type, or empty. The
  validator checks the id's shape; the settings controller checks the process
  exists on this hub and is of the type. One key for both the top strip and
  where a new account lands, as before.
- **Brief "Sent to":** date only — "Sent to City Council on September 25,
  2026." (full time on hover). The process page's pointer the same.
- **`job_runs` on dev:** empty because dev runs with `HUB_CRON_ENABLED=false`
  (DEPLOY-dev.md), whose kill switch also refuses manual runs. Recording
  works locally in both modes (`tests/api/crons.test.ts`). Not changed: a
  run that does nothing (a vote close that closed nothing) still records
  nothing, by design (`src/jobs/describe.ts`).

### Wording by kind and place (session 3a, 2026-10-07)

Decided by Adam (four answers in the session, 2026-10-07). HANDOFF "Every word
fits the hub" has what was built.

- **Operator:** a hub that has not named its own reads as operated by **the
  hub's name** (unchanged; create keeps writing `legal.operator_name`). Every
  other placeholder in the shared documents now has a value: contact →
  `PLATFORM_CONTACT_EMAIL` (`src/shared/platform.ts`, contact@civic.social);
  a place hub with no governing body → "local government"; a place with no
  state in its name → the governing state's default.
- **Draft note:** `{{#draft}}…{{/draft}}` in the templates. The server takes
  it out of the document and serves it beside it (`draft_notes` on
  `GET /hub-config/documents`); the page shows it to admins only.
- **Privacy law:** named for no state. A place hub's line ends "…or to the
  {STATE} Attorney General's office."
- **New keys:** `copy.welcome_strip`, `copy.welcome_strip_hidden`,
  `copy.beta_banner` (public, Settings → Copy). `identity.jurisdiction_type`
  joins the public subset. `copy.resident_noun` is wired in.
- **Defaults by kind and type:** `src/shared/hubCopy.ts` (welcome strip,
  tagline, intro, beta bar, the article rule `theName()`, the vote brief's
  pill "Brief to the <board short>").
- **`/hub-config` gains `content: { samples, welcome }`.** The beta bar
  mentions sample content only while some is left, and no link points at
  `/welcome` unless the hub wrote one ("Learn more" goes to About).
- **Kind sections** in the shared documents work for any kind
  (`{{^issue}}`), not only `place`.

### Samples stay current; every kind; visitors' submissions (session 3b, 2026-10-07)

Decided by Adam (the session prompt's decisions of Oct 7, and three answers in
the session). HANDOFF "Demo hubs stay current" has what was built.

- **The refresh.** A demo hub must always show an open vote, a vote gathering
  endorsements, an open proposal, an active conversation and a closed vote
  with its published outcome. A daily hub job, `sample_refresh` (registry,
  06:45 UTC, `plugin: null`: housekeeping no plugin owns), replaces a live
  sample within **3 days** of its deadline, or one that has left the phase it
  shows, with a fresh copy from the same template **under the same id**. It
  never moves a deadline in place and never touches the closed vote, its
  outcome, the other samples or visitors' items. Demo hubs only. Visitors'
  input on a replaced item goes with it; the demo bar says so. No
  `hub_admin_audit_log` rows: `job_runs` only (a row when something was
  replaced or added, none when idle, as `vote_close`).
- **"Refresh samples"** on the console's hub page: the same refresh now, plus
  any fitting template the hub lacks, plus minutes for a sample summary
  seeded before they existed. Demo hubs only (refused otherwise, so a
  graduated hub never gets samples back); no step-up; recorded in the hub's
  `job_runs` with `trigger: "console"`, no audit row.
- **Every kind** (R18; titles approved by Adam): school districts have their
  own ten plus the budget hearing (the library vote, its outcome and the
  "value most" word cloud are now local-government only); organizations and
  hubs of kind `other` share one set; issue campaigns have one. The
  organization and issue sets use the members' own voice ("we", "our")
  rather than `{HUB_NAME}`, so no article is needed, and are about running
  the group or campaign, never about which side of an issue is right.
- **Sample meeting summary** (issue #7): `minutes` text on every meeting
  template, stored as `state.sample_minutes`, served only for a sample. The
  page shows "Read the minutes" and a "Watch recording" that opens the note
  "In a real hub this links to the meeting video…", going nowhere.
- **Visitors' submissions on a demo hub** (R25). A non-admin's submission on
  a demo hub is stored with `is_sample` and the new `processes.added_in_demo`
  (`20261007000000`), so its events stay off `/events` and it is removed with
  the samples, counted separately first ("the N items visitors added during
  the demo"). It shows no Sample badge (`isSample` is false in the app). One
  that passed the automated Code of Conduct check publishes at once
  (`submitAsCreator`, actor `system:demo-publish`); one whose check never ran
  or was unavailable still goes to review. An unavailable check is now stored
  on the draft as a soft `check_unavailable` entry (submitting stays allowed,
  as before) rather than as an empty pass. Beta and live always review.
  Admins' own submissions are not marked.
- **`review_turns` guard** (in the same migration): its turns may be deleted
  only when the review's process is sample content; everything else stays
  append-only, UPDATE refused for all. The same rule as the events guard.
  Removal deletes the turns first, while the review exists. The export leaves
  them behind with their review (`REVIEW_CHILD_COLUMNS`).
- **Removal counts everything** (R46): `PARTICIPATION_TABLES` adds project
  comments, deliberation votes ("reactions"), brief responses and reviews of
  seeded samples; a unit test makes every child table either counted or named
  in `NOT_PARTICIPATION` with a reason.

### Backups (2026-10-04)

Encrypted scheduled dumps outside Supabase, in a Google Cloud Storage bucket
under the mosaic.social Workspace; restore steps in
`RUNBOOK-restore-database.md`. Nightly per-hub exports run
`scripts/export-hub.ts --from-postgres --no-images` (Adam, 2026-10-04): the
backup job holds no service-role key.

#### Known gap: uploaded images are not backed up

A database dump holds no Storage objects, and the nightly hub exports skip
images. If the `post-images` bucket is lost, every uploaded image (post
images, hub banners and logos) is lost with it; the rows survive and point at
missing files.

**Follow-up (Adam, 2026-10-04), must be on before any large deployment:** an
in-app daily job, registered in `src/jobs/registry.ts` like every other
scheduled job, copies Storage objects created since its last run into the same
GCS bucket. Vercel authenticates to Google through OIDC federation (Vercel's
OIDC token exchanged via Workload Identity Federation; no stored key), as a
service account with `roles/storage.objectCreator` on that bucket only.

#### Upload size limits today (recorded 2026-10-04, unchanged)

| Where | Limit | Source |
|---|---|---|
| App: post images and hub banners | 5 MB (`IMAGE_UPLOAD_MAX_MB`, default 5), JPEG/PNG/WebP/GIF — **now 4 MB, see below** | `src/services/postImageStorage.ts` `imageUploadMaxBytes()`, busboy `fileSize` in `src/controllers/uploadController.ts` |
| App: hub logo | min(that, 1 MB), square PNG | `HUB_IMAGE_LIMITS.logo`, same file |
| App: meeting-summary PDFs (fetched, not uploaded) | 20 MB | `MAX_PDF_BYTES`, `src/modules/civic.meeting_summary/pipeline.ts` |
| App: JSON request bodies | 100 KB (Express default; `express.json()` has no `limit`) | `src/app.ts` |
| Bucket `post-images` | 5 MB, the four image types | `20260924070000_post_images_bucket.sql`, **as written**: the insert is `ON CONFLICT DO NOTHING`, so a bucket that already existed kept its own settings. Production's real value is unverified. |
| Bucket `hub-exports` | none set, so the project's global limit applies; `application/gzip` only | `20260926020000_hub_exports_bucket.sql` |
| Local stack global | 5 MiB | `supabase/config.toml` `[storage]` |
| Supabase project global (dev, prod) | not in the repo; Supabase dashboard → Storage → Settings | — |
| Vercel function request body | 4.5 MB (platform limit) | Vercel docs |

The Vercel body limit is below the app's 5 MB, so an image between ~4.5 and
5 MB is refused by Vercel with a 413 before the app's own "exceeds the 5 MB
upload limit" message can run.

**Fixed 2026-10-05 (Adam: "if it's easy, fix it"):** the server's limit is
4 MB (`UPLOAD_CEILING_MB` in `src/services/postImageStorage.ts`;
`IMAGE_UPLOAD_MAX_MB` can lower it, never raise it), and the browser resize
(`ui/src/components/PostImagePicker.tsx`, every image upload goes through it)
re-encodes smaller in steps when a result is over 3.5 MB. Measured: pure noise
at 4000×3000 comes out at 1.6 MB, so the steps are a safety net. Buckets
unchanged (5 MB).

---

### Error reporting (2026-10-07, Adam)

Errors the operators must see go through **one helper**,
`reportError(code, message, details)` in `src/utils/reportError.ts`. Today it
writes one line to the deployment's logs, starting `[civic-error:<code>]`, so
the logs can be searched by code. **When error tracking (Sentry or similar) is
connected, the operations shell connects it in that one function;** callers
do not change. Details are plain fields and never carry a person's data (no
emails, names or filter values), because they go to a log now and to a third
party later.

The first caller is the 1,000-row guard in `forHub()` (code `CIVIC_ROW_CAP`).
**The switch is `NODE_ENV`, and it stays that way (Adam):** with
`NODE_ENV=production` (both Vercel projects, dev and production) a cut-off
read is reported and its rows are returned, so a resident never gets an error
page from it. Tests and local runs throw. It is deliberately not keyed off the
production database's host.

Not yet routed through it: the terminal error handler in `app.ts` and the
many `console.error` lines in services and jobs. Moving them is a later,
mechanical pass, best done when error tracking is actually connected.

---

## Phase 3 approach (verified)

Verified 2026-09-22 against a throwaway local Supabase (`supabase start`,
CLI 2.110.0, Postgres 17.6, PostgREST v14.15, supabase-js 2.103). The table
and the local stack were deleted afterwards; nothing here touched any hosted
project. Both signing paths were exercised — the legacy HS256 shared secret
and an asymmetric ES256 signing key — and both isolate hubs correctly.

### The mechanism

A `hub_id` claim in the request's JWT, read by a forced RLS policy. The
server mints a short-lived token per request; the database, not the code, is
what stops a query from crossing hubs.

```sql
alter table public.<t> enable row level security;
alter table public.<t> force  row level security;

-- (select ...) so the claim is evaluated once per statement, not once per row.
create policy tenant_isolation on public.<t>
  as permissive for all to authenticated
  using      (hub_id = (select current_setting('request.jwt.claims', true)::json->>'hub_id'))
  with check (hub_id = (select current_setting('request.jwt.claims', true)::json->>'hub_id'));

grant select, insert, update, delete on public.<t> to authenticated, service_role;
```

`auth.jwt()` is the same value — locally it is defined as
`coalesce(current_setting('request.jwt.claim'), current_setting('request.jwt.claims'))::jsonb`
— so `auth.jwt()->>'hub_id'` works identically. Prefer `current_setting`,
which has no dependency on the `auth` schema and keeps the policy readable
in a plain `psql` session.

### Minting the token (the snippet `forHub()` will use)

ES256, which is the production path (see "Which key to use" below). The
private key is a JWK on the server; `kid` in the header tells PostgREST
which JWKS entry to verify with.

```js
import { createPrivateKey, createSign } from "node:crypto";

const jwk = JSON.parse(process.env.CIVIC_HUB_SIGNING_KEY); // { kty:"EC", crv:"P-256", d, x, y, kid, alg:"ES256" }
const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
const b64url = (s) => Buffer.from(s).toString("base64url");

/** Short-lived, hub-scoped. 60 s is ample: it is minted per request. */
export function mintHubToken(hubId, ttlSeconds = 60) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: jwk.kid, typ: "JWT" };
  const payload = {
    iss: "civic-hub",
    role: "authenticated", // MUST be a real Postgres role
    hub_id: hubId,         // the claim the RLS policy reads
    iat: now,
    exp: now + ttlSeconds,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // ES256 signatures are raw r||s (64 bytes), not DER — hence ieee-p1363.
  const sig = createSign("SHA256")
    .update(input)
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}

export function clientForHub(hubId) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintHubToken(hubId)}` } },
  });
}
```

The HS256 variant is the same function with
`createHmac("sha256", JWT_SECRET).update(input).digest("base64url")` and a
header of `{ alg: "HS256", typ: "JWT" }` (no `kid`). It was verified first
and behaves identically; it is the fallback if the signing-keys migration
slips.

### What the spike proved

Five rows, two rows for hub `a` and three for hub `b`:

| Caller | Result |
|---|---|
| Publishable key + token with `hub_id: 'a'` | hub a's 2 rows only |
| Publishable key + token with `hub_id: 'b'` | hub b's 3 rows only |
| Publishable key, no user token (`anon` role) | denied, no rows |
| Secret key (`sb_secret_…`, `service_role`) | all 5 rows — RLS bypassed |
| As hub a, `insert { hub_id: 'b' }` | rejected, SQLSTATE 42501, `new row violates row-level security policy` |
| As hub a, `insert { hub_id: 'a' }` | accepted |
| As hub a, `update … where hub_id = 'b'` | 0 rows affected |
| Tampered signature | 401 `PGRST301` — `None of the keys was able to decode the JWT` |

### Findings that change what Phase 2 and Phase 3 must do

1. **Migrations must grant table privileges explicitly.** The 47 existing
   migrations contain zero `GRANT` statements; they work because the hosted
   project's `supabase_admin` default ACLs grant `authenticated` and
   `service_role` full DML on new tables in `public`. On a local stack a
   table created by the `postgres` role gets only `TRUNCATE/REFERENCES/
   TRIGGER` for those roles, so the first spike run had the service role
   denied on its own table. Every migration from Phase 2 on ends with an
   explicit `grant select, insert, update, delete on <table> to
   authenticated, service_role;`, and the Phase 6 rehearsal (restoring a
   production dump locally) will otherwise diverge from production.

2. **A token with no `role` claim silently becomes `anon`.** It is not an
   error; PostgREST simply runs the request as `anon`, which under
   default-deny returns "permission denied". `mintHubToken` must always set
   `role`, and a unit test must assert it — a missing claim would look like
   a permissions bug, not an auth bug.

3. **PostgREST tolerates about 30 seconds of expiry slack.** Measured: a
   token expired by 5, 15 or 30 seconds was accepted; 45 seconds and beyond
   returned 401 `PGRST303 JWT expired`. Fine for clock skew, but it means a
   60-second TTL is really up to 90 seconds of validity. Do not treat the
   token as a revocation mechanism; hub suspension is enforced by the
   resolver, not by token expiry.

4. **`hub_id` needs an index on every table.** The policy is an equality
   filter evaluated against candidate rows; without the index, every
   policy-checked scan is a seq scan. Phase 2 adds
   `create index <t>_hub_id_idx on <t> (hub_id)` in the same migration as
   the column.

5. **The control plane keeps the service role.** It reads `hubs` and does
   cross-hub work, and `service_role` has `rolbypassrls = true`, so it is
   unaffected by the policies. That is exactly why the lint rule in Phase 2
   matters: the service-role client must not be reachable from request
   handlers.

### Which key to use in production

Supabase now has two systems, and the local stack runs both, which is what
made the difference visible:

- **Legacy shared secret (HS256).** One `JWT_SECRET` signs everything,
  including the `anon` and `service_role` keys. The docs call this "no
  longer recommended", and HS256 specifically "not recommended for
  production". Supabase's API-keys documentation states it is **"deprecating
  the `anon` and `service_role` keys by the end of 2026"**.
- **JWT signing keys (ES256 / RS256).** Asymmetric; the public key is
  served at `/auth/v1/.well-known/jwks.json`, the private key is held by
  whoever mints tokens, and each key has a `kid`. ES256 is Supabase's
  recommendation. Paired with the new API keys: `sb_publishable_…` in place
  of `anon`, `sb_secret_…` in place of `service_role` (it still resolves to
  the `service_role` Postgres role and still bypasses RLS — confirmed in
  the spike).

**Recommendation: mint hub tokens with an ES256 signing key, and move the
server to `sb_publishable_…` / `sb_secret_…` in the same phase.** Reasons:
the legacy keys are on a stated end-of-2026 deprecation, Floyd's project
predates the signing-keys system so it has to be migrated at some point
anyway, and doing it during the tenancy conversion means one coordinated
key change rather than two. The migration is non-breaking while it lasts:
with no `signing_keys_path` set, the local stack's PostgREST held **both**
an ES256 JWKS entry and the HS256 `oct` secret and accepted tokens signed
either way — that is the hosted "Migrate JWT secret" window, where old and
new tokens both verify. Once `signing_keys_path` pointed at a generated
key, PostgREST held only the ES256 key and the HS256 token was refused with
`PGRST301 No suitable key was found to decode the JWT` — which is exactly
what revoking the legacy secret looks like, and is the step that must come
last.

Generate the production key with the CLI, never by hand:

```bash
supabase gen signing-key --algorithm ES256
```

It emits a JWK with `d` (the private scalar). Import the public half in the
dashboard under JWT signing keys; keep the private JWK in
`CIVIC_HUB_SIGNING_KEY` on Vercel (Production scope only) and nowhere else.
It never goes to the browser: the UI only ever gets the publishable key.

### What the current civic-hub Supabase project means for this

From `supabase/.temp` and `supabase/config.toml` (no credentials read):

- **Which project is which** (confirmed with Adam, 2026-09-22):

  | Role | Ref | Name | Org | Notes |
  |---|---|---|---|---|
  | **Production** | `nfhyypwoporfggqcerli` | Civic-Hub-Floyd | `ewarqaimzbloqcjlgbrt` (paid) | Serves `floyd.civic.social`. Postgres 17.6.1, PostgREST v14.5, GoTrue v2.190.0. |
  | **Dev** | `urfmvqhzmamigssqwsya` | civic_hub_floyd_Dev | `fahhqxdrsszbzpaivjik` (free) | Paused when idle; wake it before use. What the local `.env` points at. |

  Other projects in these orgs are not part of this work: `ehcyahlmqbqmewdbxdls`
  (Website-Civic-Social, the marketing site, linked from the monorepo root),
  `cxeiiogotnrfzeekowih` (Representative Space) and `diavaxiwxwofayizrmsl`
  (civic-hub-demo, inactive).

  **The CLI link stays on dev for the whole of this work.** It was pointing at
  production, which meant a `supabase db push` typed in the wrong directory
  would have reached the live database; it was relinked to
  `urfmvqhzmamigssqwsya` on 2026-09-22. **Production migrations are applied
  only in the cutover session, by Adam, from the runbook** — no build session
  pushes to production, and no session relinks to it.

- The production project is Postgres 17.6.1, PostgREST v14.5, GoTrue v2.190.0
  — all recent enough to support JWT signing keys. There is **no `supabase/config.toml` in
  `civic-hub/`**: the CLI is used only for `db push`, so nothing about local
  auth configuration is pinned today. Phase 3 adds a `config.toml` so the
  spike is reproducible and so `supabase start` becomes the rehearsal
  environment for the cutover.
- The monorepo root is linked to a **different** project,
  `ehcyahlmqbqmewdbxdls` ("Website-Civic-Social"), the marketing site. Run
  every CLI command from `civic-hub/`; a `db push` from the repo root would
  target the wrong database.
- The hub authenticates today with `SUPABASE_SERVICE_ROLE_KEY`, a legacy
  key, from all 51 files that import `getDb()`. So the key change and the
  `forHub()` conversion are the same piece of work, which is why Phase 2
  (`forHub()` + lint rule) must land before Phase 3 turns the policies on —
  enabling forced RLS while any request handler still holds a service-role
  client would hide the leak the policies are meant to catch.
- **Do not enable the policies and the new keys in one deploy.** Phase 3's
  order is: add policies in `permissive` form with the column already
  back-filled, switch the app to minted tokens, verify against a restored
  dump locally, and only then revoke the legacy secret.

### Reproducing the spike

The scripts are not committed (they are throwaway, and they contain a local
private key). To rebuild: `supabase init`, `supabase gen signing-key
--algorithm ES256 > supabase/signing_keys.json` wrapped in a JSON array,
set `signing_keys_path` under `[auth]` in `config.toml`, `supabase start`,
apply the policy above to a two-column table, and run the mint snippet.
Note that changing `signing_keys_path` requires the containers to be
**recreated**, not just restarted — a `supabase stop` that leaves the REST
container up will keep serving the old JWKS and every new token fails with
"No suitable key".

