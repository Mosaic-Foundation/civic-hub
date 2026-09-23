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
- **`source.hub_id` on published activities is NOT this id.** The protocol
  identity string (`HUB_ID` in `src/config/hub.ts`, `civic-hub-local` on
  production today) is a separate field and is unchanged by this work.
  Do not rename it, back-fill it, or derive it from `hubs.id`.
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
| `identity.` | `identity.name`, `identity.label`, `identity.tagline`, `identity.page_title`, `identity.description`, `identity.banner_url`, `identity.banner_alt`, `identity.theme` |
| `copy.` | `copy.intro_body`, `copy.residency_intro`, `copy.welcome`, `copy.about`, `copy.resident_noun`, `copy.governing_body_name`, `copy.governing_body_short` |
| `legal.` | `legal.terms`, `legal.privacy`, `legal.code_of_conduct`, `legal.proposal_best_practices` |
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
`plugin.wordcloud.onboarding_id` are served by `/api/hub-config`. `people.*`,
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

