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
| DNS for `civic.social` | **GoDaddy** | Phase 5 adds `*.civic.social` as a CNAME to `cname.vercel-dns.com` in the GoDaddy DNS panel; the apex and `www` stay on the marketing site (Firebase). |
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
- **`source.hub_id` on published activities is NOT this id.** The protocol
  identity string (`HUB_ID` in `src/config/hub.ts`, `civic-hub-local` on
  production today) is a separate field and is unchanged by this work.
  Do not rename it, back-fill it, or derive it from `hubs.id`.
- `status = 'suspended'` makes the resolver serve the "no hub here" page
  for that hostname while leaving the data in place.

### 2. `hub_settings`

Primary key becomes `(hub_id, key)`. Columns: `hub_id text not null
references hubs(id)`, `key text not null`, `value text not null`,
`updated_at`, `updated_by`. Existing trigger `hub_settings_touch_updated_at`
is kept.

Key naming is dotted, lowercase, and namespaced. The canonical keys:

| Namespace | Keys |
|---|---|
| `identity.` | `identity.name`, `identity.label`, `identity.tagline`, `identity.page_title`, `identity.description`, `identity.banner_url`, `identity.banner_alt`, `identity.theme` |
| `copy.` | `copy.intro_body`, `copy.residency_intro`, `copy.welcome`, `copy.about`, `copy.resident_noun`, `copy.governing_body_name`, `copy.governing_body_short` |
| `legal.` | `legal.terms`, `legal.privacy`, `legal.code_of_conduct`, `legal.proposal_best_practices` |
| `people.` | `people.admin_emails`, `people.board_emails`, `people.brief_recipients`, `people.announcement_authors` |
| `email.` | `email.from_name`, `email.from_address`, `email.postal_address` |
| `beta.` | `beta.enabled`, `beta.allowlist`, `beta.waitlist_enabled` |
| `plugin.<id>.` | `plugin.<id>.enabled` and `plugin.<id>.<setting>` |

`<id>` is the registry id: `vote`, `proposal`, `project`, `announcement`,
`brief`, `meeting_summary`, `wordcloud`, `conversation`, `assistant`,
`digest`, `admin_digest`, `search`, `feedback`, `news_sync`.

Value encoding: strings are stored as-is; lists are JSON arrays; booleans
are the strings `true` / `false`; numbers are decimal strings. A settings
reader (`src/services/hubSettings.ts`) owns parsing; callers never parse
`value` themselves.

**Public subset.** Only `identity.*`, `copy.*`, `legal.*`, `beta.enabled`,
`beta.waitlist_enabled`, and `plugin.<id>.enabled` are served by
`/api/hub-config`. `people.*`, `email.*`, `beta.allowlist` and every other
`plugin.<id>.<setting>` are admin-only.

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
| `comment_identity_mode` | `plugin.vote.comment_identity_mode` | hub-wide comment policy; lives under `vote` because votes own comments today. Ask Adam if it should move to a `moderation.` namespace. |
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
| `VITE_HUB_POLIS_URL`, `POLIS_BASE_URL` | `plugin.conversation.polis_url` |
| `POLIS_AUTH_TOKEN` | stays an env var (a credential), but is looked up per hub in Phase 4: `POLIS_AUTH_TOKEN__<HUB_ID>` with `POLIS_AUTH_TOKEN` as the fallback |
| `VITE_HUB_ONBOARDING_WORDCLOUD_ID` | `plugin.wordcloud.onboarding_id` |
| `CIVIC_DEMO_BYPASS_CODE`, `VITE_DEMO_MODE`, `VITE_DEMO_BYPASS_CODE` | `beta.demo_bypass_code`, `beta.demo_mode` (admin-only; never in the public subset) |

Stays platform-wide (env var, not a setting): `SUPABASE_URL`, the
Supabase keys, `ANTHROPIC_*`, `RESEND_API_KEY`, `SMTP_*`, `CRON_SECRET`,
`DIGEST_UNSUBSCRIBE_SECRET`, `CIVIC_ANON_SECRET`, `SEARCHAPI_API_KEY`,
`SUPADATA_API_KEY`, `YOUTUBE_API_KEY`, `CIVIC_ALLOWED_ORIGINS`
(becomes a computed list: every active hub's hostname plus the marketing
site), `BASE_URL` / `CIVIC_UI_BASE_URL` (computed from `req.hub.hostname`),
`CIVIC_ALLOW_SEED`, `CIVIC_SEED_FIXTURE`, `NODE_ENV`, `PORT`,
`IMAGE_UPLOAD_MAX_MB`, `LINK_PREVIEW_USER_AGENT`, `CIVIC_HUB_ID` (the
protocol identity, see Contract 1).

### 3. Data layer — `forHub(hubId): HubDb`

File: `src/db/forHub.ts`.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type HubDb = {
  /** Same builder surface as SupabaseClient["from"], hub-scoped. */
  from<T extends TableName>(table: T): HubQueryBuilder<T>;
  /** For .rpc() calls; hub_id is passed as a named argument. */
  rpc: SupabaseClient["rpc"];
  readonly hubId: string;
};

export function forHub(hubId: string): HubDb;
```

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
- Tests: `tests/unit/forHub.test.ts` asserts the filter and the stamp with
  a stubbed client; no database needed.

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

_checklist to be pasted_

### Phase 3 — forced RLS with the JWT claim

Done when: every table has `FORCE ROW LEVEL SECURITY` and a `hub_id` policy;
the app runs end-to-end as `authenticated` with a minted token; a query
with the wrong `hub_id` returns zero rows; service role still sees all.

See "Phase 3 approach (verified)" below for the verified mechanism.

_checklist to be pasted_

### Phase 4 — settings as data, place-names out of `src/`

Done when: the alias map above is live, every `VITE_HUB_*` / place-name
env var has a settings key, `grep -ri floyd src ui/src` returns only
comments and test fixtures, and the admin Settings tab edits the new keys.

_checklist to be pasted_

### Phase 5 — control plane + wildcard hostname

Done when: `*.civic.social` resolves to the one Vercel project (GoDaddy
CNAME, Vercel Pro), a new hub can be created from `/control/hubs` by a
platform admin with the reserved-slug check enforced, and the Athens demo
runs as hub #2 on the same deployment.

_checklist to be pasted_

### Phase 6 — cutover runbook (Adam runs by hand)

Done when: the runbook has been rehearsed against a restored dump of
production in a local Supabase, with timings, and the rollback step has
been exercised once.

_checklist to be pasted_

---

## Phase 3 approach (verified)

<!-- PHASE3_VERIFIED -->
