# RUN-ANYWHERE.md: the hub on plain Node and Postgres

The engine (processes, the wire, authorization, the plugins) knows nothing about where it runs (ADR-012). Civic.Social
runs it on Vercel and Supabase; a community can run it on any machine with Node and Postgres. This page says what that
takes, and the `run-anywhere` CI job proves it on every push: the engine on plain Node against a plain Postgres
container, no Supabase CLI and no Vercel, with the unit suite and the API suite (service-role mode) green and a hub
serving `/health`, `/.well-known/civic.json` and `/events`.

## What you need

| Piece | What | Why |
|---|---|---|
| Node 24 | `node --import tsx src/index.ts` | The server. `npm run build` + `node dist/index.js` works too. |
| Postgres 17 | any (the CI job uses the `postgres:17` image), created with the ICU `en-US` collation (`initdb --locale-provider=icu --icu-locale=en-US`) | Every table, function and policy is in `supabase/migrations/`; they are plain SQL. The collation is Supabase's: with glibc's `en_US` text sorts differently (punctuation is ignored). |
| PostgREST 14 | the `postgrest/postgrest:v14.5` image, or the binary (12.x mishandles an update filtered with `or=` that returns rows) | The hub's database client (supabase-js) speaks PostgREST. It is open source and runs on its own; nothing else of Supabase is used. |
| A path rewrite | `/rest/v1/*` → PostgREST's `/*` | supabase-js addresses PostgREST at `<SUPABASE_URL>/rest/v1`. `scripts/run-anywhere/rest-proxy.mjs` does it; nginx or Caddy can do the same. |
| An object store | for post images and the console's exports | Supabase Storage on Civic.Social. With `CIVIC_OBJECT_STORE=memory` the hub keeps objects in memory (lost on restart): fine for a trial, not for a hub. See "What a self-hoster supplies". |

The hub does not use Supabase Auth (it has its own sign-in), Supabase Realtime, Edge Functions or the Supabase CLI.

## Start it

On a laptop with Docker, `./scripts/run-anywhere/up.sh` does steps 1 to 3 and prints the settings for step 4.

1. **Roles.** As the database owner, once: `psql -v authenticator_password=<choose one> -f scripts/run-anywhere/roles.sql`.
   It creates `anon`, `authenticated`, `service_role` (which bypasses row-level security, as on Supabase) and
   `authenticator` (the role PostgREST logs in as). The migrations grant to these roles; on a database without them the
   grants are skipped and only the owner could read anything.
2. **Migrations**, in file-name order: `for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done`.
   The storage-bucket migrations skip themselves when there is no `storage` schema. For a trial with the two sample
   hubs, also `psql -f supabase/seed.sql`, then `npx tsx scripts/seed-hub-settings.ts --hub athens` (and `floyd`) and
   `node --import tsx scripts/load-jurisdictions.ts` with `CIVIC_TARGET_DATABASE_URL` set.
3. **PostgREST**, with `PGRST_DB_URI=postgres://authenticator:<password>@<host>/<db>`, `PGRST_DB_SCHEMAS=public`,
   `PGRST_DB_ANON_ROLE=anon` and `PGRST_JWT_SECRET=<32 characters or more>`; then the `/rest/v1` rewrite in front of it.
4. **The hub**, with at least:
   - `SUPABASE_URL`: the rewrite's origin (the name predates the adapter; it is PostgREST's address);
   - `SUPABASE_SERVICE_ROLE_KEY`: `node scripts/run-anywhere/service-key.mjs <jwt secret>` prints it (a JWT with
     `role: service_role`; keep it secret);
   - `NODE_ENV=production`, and the other settings required in production (RUNBOOK-operations.md → Settings lists every
     setting, its type, default and whether it is required; the hub refuses to start without a required one and names
     it);
   - `CIVIC_OBJECT_STORE=memory` until you supply a store.

   Then `node --import tsx src/index.ts`. `/health` answers 200 when the database, the hub's own check and the schema
   are all fine, and says which is not.

   **Hub tokens** (`CIVIC_HUB_MINTED_TOKEN=true`, forced RLS live) work against a bare PostgREST too: set
   `CIVIC_HUB_SIGNING_KEY` to the same JWT secret. The CI job runs the service-role mode only.

5. **Scheduled jobs**: `npm run jobs:crontab -- --script --dir <checkout> --env <env file>` prints a crontab, one line
   per job with its schedule from `src/jobs/registry.ts`. Each line runs `scripts/run-job.ts <job> --all`, the same run
   Vercel Cron makes through `/internal/<job>/run`: job_runs, job_last_run and the heartbeat are written the same way.
   (`npm run jobs:crontab` without `--script` prints lines that call the routes over HTTP with `CRON_SECRET` instead.)

## What a self-hoster supplies

The engine calls each outside service through an adapter (`src/adapters/`); `src/hosting/index.ts` chooses the
implementations. Each is optional: without its settings, it is "not configured" and the hub does without.

| Adapter | Civic.Social's | Without it | To use another vendor |
|---|---|---|---|
| `ai` | Anthropic (`ANTHROPIC_API_KEY`) | the drafting assistant and the Code of Conduct check say they are not set up (submissions go to an admin); meeting summaries and news paraphrasing do not run | one file in `src/hosting/` implementing `AiProvider` |
| `mail` | Resend (`RESEND_API_KEY`, `RESEND_FROM`) | sign-in codes and other mail are written to the server's log | one file implementing `MailTransport` (SMTP, another API) |
| `video` | Supadata, SearchAPI, then YouTube's public transcripts | the public transcripts only, which cloud hosts are often refused | `VideoTranscripts` |
| `deliberation` | Polis (`POLIS_AUTH_TOKEN`, the hub's Polis address) | conversations cannot be created | `DeliberationService` (address, token, fetch) |
| `errors` | Sentry (`CIVIC_ERROR_DSN`) | errors go to the log only | `ErrorSink`; any Sentry-compatible collector already works |
| `heartbeat` | Healthchecks.io (`CIVIC_HEARTBEAT_PING_KEY`) | no outside watcher for late jobs | `HeartbeatSink` |
| `objectStore` | Supabase Storage | `CIVIC_OBJECT_STORE=memory` (lost on restart) | **needed for a real hub**: `ObjectStore` over S3-compatible storage (MinIO, Garage, a cloud bucket) or a directory your web server serves. Public objects must be readable at the URL `putPublic` returns. |

The share cards for links on social media (`api/og.ts`) are a Vercel function; on another host, serve `index.html` for
every page path and the hub works the same, without previews.

What is specific to Civic.Social's hosting, and not needed elsewhere: `vercel.json` (rewrites, crons, headers), `api/`,
`supabase/config.toml` and the Supabase CLI link used by `scripts/release.sh` and `scripts/db-push.sh`, and the console's
reads of Healthchecks.io, Better Stack and Sentry (ADR-007).
