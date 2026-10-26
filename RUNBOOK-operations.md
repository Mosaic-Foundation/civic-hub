# RUNBOOK-operations.md: monitoring, alerts, and what to do at 3 am

Since 2026-10-15 (the operations shell). Three outside services watch the deployment. None of them runs on our stack,
and none needs a card. Why these and what they may receive: `../decisions/006-outbound-operations-services.md`.

| Service | Watches | Alerts by | Account |
|---|---|---|---|
| **Better Stack** (Uptime) | `/api/health` on each production hub and the console, the docs, the dev smoke hub; every 3 min | email only (push, SMS and calls are paid) | free: 10 monitors, 1 status page |
| **Healthchecks.io** | a ping from each scheduled job and from the backup dump | email | free (Hobbyist): 20 checks |
| **Sentry** | errors thrown in the API and the UI, dev and production | email, on the **first** occurrence of a new error and when a known one escalates | free (Developer): 5,000 errors a month; a 14-day Business trial at sign-up falls back to it |

All three accounts are under **adam@mosaic.social**. The public status page is **https://status.civic.social**
(Better Stack, "Civic.Social"; fallback address civic-social.betteruptime.com). It lists the production hubs and the
docs.

## What is monitored

**Better Stack monitors.** "URL becomes unavailable", every 3 minutes, from all four regions, IPv4 only. They alert
after a 3-minute confirmation period (a failure that is still there on the recheck), and again on recovery.

| Monitor | URL |
|---|---|
| Floyd Hub | `https://floyd.civic.social/api/health` |
| Demosville Hub | `https://demosville.civic.social/api/health` |
| Longmont Hub | `https://longmont.civic.social/api/health` |
| Console | `https://console.civic.social/api/health` (**not yet created**: add it after the release that serves it, see Setup) |
| Civic Hub Docs | `https://docs.civic.social/` |
| Smoke Test Hub | `https://smoke.dev.civic.social/api/health` (not on the status page) |

That's 6 of the 10 free monitors. A seventh production hub is the last that fits without a paid plan, or drop the
Smoke Test Hub monitor (the smoke suite checks dev after every release) to make room.

`/api/health` answers **503** unless the database answers, the host's hub passes its database check and the schema has
no gaps; a monitor fails on any of them, not only on a dead server (`src/http/health.ts`). It is never cached.

**Healthchecks.io checks.** Each check expects a ping on its cron schedule (UTC) and alerts once the grace period has
passed without one. A `/fail` ping alerts at once. Made by `npm run heartbeats:sync` from `src/jobs/registry.ts`.

| Check | Schedule (UTC) | Grace | Pinged by |
|---|---|---|---|
| `vote-close` | `5,20,35,50 * * * *` | 10 min | the deadline close, every 15 minutes (hourly before Architecture 2) |
| `digest` | `0 * * * *` | 20 min | the hourly resident digest |
| `hub-exports-sweep` | `15 * * * *` | 20 min | the export sweep |
| `admin-digest` | `30 13 * * *` | 2 h | the admin digest |
| `meeting-summary` | `30 11 * * *` | 2 h | meeting summaries |
| `news-sync` | `0 12 * * *` | 2 h | the news sync |
| `sample-refresh` | `45 6 * * *` | 2 h | demo hubs' sample refresh |
| `backup-dump` | every 6 hours (period, not cron) | 6 h | civic-hub-backups `dump.yml` (prod target only). Scheduled `17 */6 * * *`, but GitHub often starts it 2–4 hours late, so the check alerts only after about 12 hours with no dump (`59098b3`). |

Production only: `CIVIC_HEARTBEAT_PING_KEY` is set on civic-hub's Production environment and nowhere else. A job
pings when its run for **every** hub finishes: success, or `/fail` when any hub failed or the run threw. A run for one
hub by hand (`?hub=`) does not ping.

**Sentry.** Project `civic-hub`, environments `production` and `dev`. Every error that reaches `reportError()` (the API's
unexpected 500s and 503s, `[civic-error:descriptor.…]`, the jobs' reported failures) and every uncaught error in the
hub, console and start pages (through `/api/client-errors`). Each event carries tags:
- `code` (the `[civic-error:<code>]` code);
- `hub` (slug);
- `route` (pattern, e.g. `/process/:id/action`);
- `method` and `status`;
- `ref` (the reference the person was shown, which is also in the Vercel log line).

The **release** is the deployed commit. Sent scrubbed: no email, body, cookie, query string or IP address
(`src/utils/errorTracking.ts`, pinned by `tests/unit/errorTracking.test.ts`).

## Where alerts go

- **Email** to adam@mosaic.social, from all three services. That's the only channel on the free plans.
- **Your phone:** through the Gmail app on that account, with a Gmail filter that marks the three services' mail
  important and notifications set to "High priority only" (Setup, step 5). Push straight from the services isn't free:
  Better Stack's push, SMS and calls are paid, and ntfy didn't push on the iPhone (Open items).
- Sentry alerts on each new issue, and when an existing issue escalates (Sentry marks it high priority). A known error
  happening again at its usual rate does not alert; it is counted under its issue.

## When an alert comes

### A hub, the console or the docs is down (Better Stack)

1. Open the URL in the alert in a browser.
2. **It answers 503 with JSON.** Read `db`, `hub_db` and `schema.gaps`:
   - `db.ok: false`: the database is not answering. Check the Supabase dashboard (production project
     `nfhyypwoporfggqcerli`): is it paused, over a limit, or in an incident? Check status.supabase.com.
   - `schema.gaps` not empty: the code needs something the database doesn't have. The release went out of order.
     RUNBOOK-release.md → "Health on the new code". Usually: apply the migration, or run
     `NOTIFY pgrst, 'reload schema';` in the SQL editor.
   - `hub_db.ok: false` on one hub: that hub's token or its RLS check failed. Look in Vercel's logs (civic-hub →
     Logs) for `[civic-error:` around the alert's time.
3. **It answers 403 "request was blocked".** Vercel's firewall stopped the monitor.
   - Check that the custom rule "Uptime health checks" (path `/api/health` → Bypass) is still published (Setup,
     step 4).
   - That rule does **not** cover Vercel's system mitigations (its automatic DDoS protection). If the rule is in
     place and checks are still blocked, add **system bypass rules** for Better Stack's published monitoring IP
     addresses: Firewall → System Bypass. A check every 3 minutes per hub isn't expected to trigger this; it wasn't
     set up on 2026-10-16.
4. **It times out, or Vercel shows its own error page.** Check vercel-status.com and civic-hub's Deployments page. If
   the latest deployment is the cause: Deployments → the previous Production deployment → **⋯ → Instant Rollback**.
5. **Every hub down at once** means the deployment or the database. **One hub down** means that hub (its row, its
   hostname, its token).
6. **Docs down:** the civic-hub-docs Vercel project. Hubs keep working; only the "?" links fail.

### A new error (Sentry email)

1. Open the issue. Read `environment`, `release`, `hub`, `route`, `code`.
2. `environment: dev`: nothing urgent. Fix it in the next session.
3. `environment: production` and the `release` is the commit released today: the release is the likely cause. If
   people can't do something they could yesterday, roll back (Deployments → previous Production deployment →
   Instant Rollback). Otherwise fix forward.
4. For the full log line, search Vercel's logs (civic-hub → Logs) for the `ref` tag's value; the line carries the full
   stack and the database's error code.
5. `code: ui.error`: a page threw in someone's browser. The stack points at the bundle, which is minified (no source
   maps yet), so read the message, the `route` (page path) and the `surface` (hub, console, start).
6. Resolve the issue in Sentry once fixed. If it comes back in a later release, Sentry alerts again.

**A spike** (a known error suddenly frequent) alerts when Sentry marks the issue as escalating (high priority); the
alert rule has that trigger as well as "A new issue is created". For a hard threshold instead: Sentry → Alerts →
Create Alert → Issues → "Number of events in an issue is more than 100 in one hour" → email. Not set up.

### A job's heartbeat is late (Healthchecks.io: "is DOWN")

1. Which check: the job id is the check's name (`vote-close` is `vote_close`).
2. Vercel → civic-hub → Settings → **Cron Jobs**: did the job run? Its **View Logs** shows the invocation.
   - **No invocation:** cron is off for the project, or `HUB_CRON_ENABLED` is `false`. Press **Run** on the job to
     run it now.
   - **It ran, but no ping arrived:** `CIVIC_HEARTBEAT_PING_KEY` is missing or wrong on Production. The log shows
     `[heartbeat] <job>: ping failed`.
   - **It ran past its time** (300 s maximum): the log shows the timeout. The job resumes next hour.
3. `vote-close` late matters most: processes past their deadline read as closed but get no results or brief until it runs. Press **Run** in Cron Jobs.

### A job's heartbeat failed (Healthchecks.io: "/fail")

A hub failed in that run. Hub settings → Plugins on the affected hubs shows each job's last run and last problem
(`GET /admin/hub/jobs/runs`). Vercel's logs for the run show `[civic-error:…]` lines, and Sentry has the error. The
next scheduled run tries again. A fail at 3 am that is followed by a success needs nothing at 3 am.

### The backup is late (Healthchecks.io: `backup-dump`)

1. GitHub → Mosaic-Foundation/civic-hub-backups → Actions → "Database dump". Did the 00:17 / 06:17 / 12:17 / 18:17 run
   start? (GitHub often starts it hours late; the alert means about 12 hours with no dump.)
   - **Failed:** read its log. RUNBOOK-restore-database.md and the backups README cover the identities and the
     bucket.
   - **Didn't start:** GitHub Actions is down (githubstatus.com), or the workflow was disabled (Actions → Database
     dump shows **Enable workflow**).
   - **Succeeded but no ping:** the `HEALTHCHECKS_PING_KEY` secret is missing, or `BACKUP_TARGET` isn't `prod` (the
     step pings only for prod).
2. Run it by hand: Actions → Database dump → **Run workflow** (target `prod`).
3. The watchdog (`watchdog.yml`) still checks the bucket four times a day. It runs on GitHub, so it can't report
   GitHub being down; this heartbeat can.

## Adding a hub

One step: in Better Stack, **Monitors → Floyd Hub → ⋯ → Clone**. Change the URL to
`https://<slug>.civic.social/api/health` and the pronounceable name to the hub's; check that the confirmation period
(3 minutes) and IP version (IPv4 only) carried over. Then **Status pages → status.civic.social → Structure → Search to
add resources** → the new monitor → Save changes.

Nothing else: heartbeats and errors cover every hub already. (Better Stack's API could do this from the console, but
it needs a key on our side; not worth it at this size.)

## Silencing during a release

A production release with migrations can make `/api/health` answer 503 for a minute (RUNBOOK-release.md). To stay
quiet:
1. **Before:** Better Stack → Uptime → Monitors → select the hub monitors and the console → **Pause**.
2. **After** `release.sh prod` reports health ok: select them → **Resume**.

Better Stack also has a per-monitor **Pause** on each monitor's page.

Without migrations, there's no need: Vercel switches deployments without a gap. Heartbeats need nothing: a release
doesn't stop the crons. Sentry needs nothing: a release's new errors are exactly what it is for.

A long planned outage: Better Stack → Status pages → status.civic.social → **Maintenance** → schedule it, so the status page
says so.

## Rotating a key

No key reaches chat or the repository. After changing a Vercel variable, **redeploy** (Deployments → latest
Production → ⋯ → Redeploy), because a variable reaches only new deployments.

| Key | Where it lives | Rotate |
|---|---|---|
| Sentry DSN | Vercel civic-hub (Production) and civic-hub-dev: `CIVIC_ERROR_DSN` | Sentry → Project Settings → Client Keys → **Generate New Key**. Put it in both projects, redeploy both, then **Disable** the old key |
| Healthchecks.io ping key | Vercel civic-hub (Production): `CIVIC_HEARTBEAT_PING_KEY`; GitHub civic-hub-backups secret `HEALTHCHECKS_PING_KEY` | Healthchecks.io → Settings → Ping key → **Revoke**, then **Create**. Update both places straight away and redeploy civic-hub, because every check goes late until they match |
| Healthchecks.io API key | `~/civic-keys/healthchecks.env` (`HEALTHCHECKS_API_KEY`), used only by `npm run heartbeats:sync` | Settings → API Access → **Revoke**, create a new one, and replace the line in the file |

Better Stack holds no key of ours: it only fetches public URLs.

## Setup (done 2026-10-16, as adam@mosaic.social)

1. **Vercel firewall** (civic-hub): Firewall → Configure → New Rule "Uptime health checks": Request Path equals
   `/api/health` → Bypass → Save Rule → Publish. (Done. Vercel warns that it does not bypass system mitigations; see
   "403" above.)
2. **Better Stack** (betterstack.com, free; onboarding: Uptime monitoring and Status page, no integrations, no test
   call):
   - The five monitors in the table above. Each: E-mail only (Push, SMS and Call need a paid plan), confirmation
     period 3 minutes, recovery period 3 minutes, check frequency 3 minutes, IPv4 only, all regions.
   - **To do after the next production release:** the Console monitor (clone Floyd Hub, URL
     `https://console.civic.social/api/health`). Before that release the console answers 404.
   - Status page "Civic.Social", subdomain `civic-social`, custom domain `status.civic.social`, logo link
     www.civic.social, Get in touch `mailto:contact@civic.social`, theme System. Resources: Floyd Hub, Demosville
     Hub, Longmont Hub, Civic Hub Docs.
   - DNS at GoDaddy: CNAME `status` → `statuspage.betteruptime.com` (resolving on 2026-10-16).
   - Better Stack switched on an "AI SRE" integration by default; it isn't used.
3. **Healthchecks.io** (Hobbyist):
   - Settings → Ping key → Vercel civic-hub Production `CIVIC_HEARTBEAT_PING_KEY` (Sensitive) and GitHub
     civic-hub-backups secret `HEALTHCHECKS_PING_KEY`.
   - Settings → API key (full access) → `~/civic-keys/healthchecks.env` as `HEALTHCHECKS_API_KEY=…`.
   - `npm run heartbeats:sync` made the 8 checks (2026-10-16):
     ```bash
     cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && npm run heartbeats:sync
     ```
   - The heartbeat step is in civic-hub-backups `dump.yml` (`0cf3a77`, below). Run #37 pinged `backup-dump`. The job
     checks start when production runs the operations-shell code.
4. **Sentry** (Developer, after a 14-day Business trial; organization `mosaic-foundation`):
   - Set up manually, not with the coding-agent plugin (it would install the SDK, which ADR-006 avoids). Project
     `civic-hub`, platform Express.
   - Organization Security & Privacy: Require Data Scrubber, Require Using Default Scrubbers, Prevent Storing of IP
     Addresses, all on.
   - Alert rule (Monitors → Alerts → "Send a notification for high priority issues", edited): WHEN any of "A new
     issue is created" or "Sentry marks an existing issue as high priority" → email.
   - DSN into `CIVIC_ERROR_DSN` on both Vercel projects. `CIVIC_ERROR_ENVIRONMENT` is `production` on civic-hub
     (Production) and `dev` on civic-hub-dev (all environments). Checked on dev 2026-10-16: a thrown error arrived as
     CIVIC-HUB-2, environment dev, release 515e1c2, no user or IP.
5. **Phone (Gmail):** on the Mac, Gmail (adam@mosaic.social) → search options → From:
   `betterstack.com OR betteruptime.com OR healthchecks.io OR sentry.io OR getsentry.com` → Create filter → Always
   mark it as important (and a label `Civic alerts`). On the iPhone, Gmail app → that account → Notifications → High
   priority only. Turn off Sentry's weekly reports (User Settings → Notifications) so they don't buzz too.

**The backup heartbeat step** (civic-hub-backups `.github/workflows/dump.yml`, after "Dump, encrypt, upload"):

```yaml
      - name: Heartbeat
        if: always() && env.TARGET == 'prod'
        run: curl -fsS -m 10 --retry 3 -o /dev/null "https://hc-ping.com/${{ secrets.HEALTHCHECKS_PING_KEY }}/backup-dump${{ job.status != 'success' && '/fail' || '' }}"
```

## Settings

Every setting the server reads, generated from `src/config/settings.ts` by `npm run settings:doc` (ADR-012); do not
edit the table by hand. The server checks them when it starts: a missing **required** setting (or a database setting
that is not a valid value) stops it with a message naming the setting, never its value, and on Vercel that shows as
every request failing and `/api/health` down. Any other setting that is not its type is logged as
`[settings] <NAME> is not …` and the hub runs on; so is a set variable with one of our prefixes that nothing declares
(`[settings] set but not a setting this hub reads: …`). Search the deployment's log for `[settings]` after a release.

**Layer:** `engine` settings are read by the hub itself; `hosting` settings only by the hosting layer
(`src/hosting/`, the console, `api/`), which is what a host on other services would replace; `dev` settings are
refused in production (`src/config/devFlags.ts`).

<!-- settings:begin (generated by scripts/settings-doc.ts; do not edit) -->

| Setting | Layer | Type | Required | Default | Purpose |
|---|---|---|---|---|---|
| `NODE_ENV` | engine | string | no | `development` | "production" on every deployment (dev and production); development switches are refused there. |
| `PORT` | engine | integer | no | `3000` | The local server's port. |
| `SUPABASE_URL` | engine | url | **always** |  | The database's PostgREST origin (a Supabase project URL, or a PostgREST behind /rest/v1). |
| `SUPABASE_SERVICE_ROLE_KEY` | engine | secret | **always** |  | The service-role key PostgREST accepts. Server only. |
| `SUPABASE_PUBLISHABLE_KEY` | engine | string | no |  | The gateway's publishable key, sent with minted hub tokens. A bare PostgREST needs none. |
| `CIVIC_HUB_MINTED_TOKEN` | engine | boolean | no | `false` | On: hub queries run as `authenticated` under a minted hub token, so forced RLS is live. |
| `CIVIC_HUB_SIGNING_KEY` | engine | secret | when CIVIC_HUB_MINTED_TOKEN is on |  | The key hub tokens are signed with (PostgREST's JWT secret or a private JWK). |
| `BASE_URL` | engine | url | no | `http://localhost:3000` | The API's own origin outside a hub (scripts, local). |
| `CIVIC_UI_BASE_URL` | engine | url | no | `BASE_URL` | The UI's origin when it differs from the API's (local preview, the start page's handoff). |
| `CIVIC_ALLOWED_ORIGINS` | engine | urls | **in production** |  | Extra CORS origins, comma-separated. Unset outside production allows any origin. |
| `CIVIC_CONSOLE_HOSTNAME` | engine | string | no |  | The console's hostname. Unset: no console on this deployment. |
| `CIVIC_CONSOLE_ADMIN_EMAIL` | engine | email | when CIVIC_CONSOLE_HOSTNAME is set |  | The console's one operator. |
| `CIVIC_START_HOSTNAME` | engine | string | no |  | The start page's hostname. Unset: no start page. |
| `CIVIC_DEV_HUB` | dev | string | no | `athens` | Local development: the hub a bare localhost resolves to. |
| `CIVIC_HUB_ID` | engine | string | no |  | Fallback hub id for code with no hub in scope. |
| `HUB_NAME` | engine | string | no |  | Fallback hub name (also a hub-setting fallback). |
| `CIVIC_JURISDICTION` | engine | string | no |  | Fallback place code for code with no hub in scope. |
| `CIVIC_JURISDICTION_NAME` | engine | string | no |  | Fallback place name for CIVIC_JURISDICTION. |
| `CIVIC_SPACE_DID` | engine | string | no |  | Fallback space DID; each hub's row carries its own. |
| `CIVIC_PLATFORM_POSTAL_ADDRESS` | engine | string | no |  | The platform's postal address, printed in a digest footer when the hub has none. |
| `VITE_HUB_PAGE_TITLE` | hosting | string | no |  | Share-card fallback title when /hub-config cannot be read (api/og.ts; also a hub-setting fallback). |
| `VITE_HUB_BANNER_URL` | hosting | string | no |  | Share-card fallback image (api/og.ts; also a hub-setting fallback). |
| `CIVIC_ANON_SECRET` | engine | secret | **in production** |  | Keys the per-process anonymous tokens on the public wire. Unset: every resident reads as one shared "anonymous". |
| `CRON_SECRET` | engine | secret | **in production** |  | Bearer token for /internal/* job routes. Unset: no job route accepts a call. |
| `DIGEST_UNSUBSCRIBE_SECRET` | engine | secret | **in production** |  | Signs digest unsubscribe links (16 characters or more). Unset: the digest job fails. |
| `ANTHROPIC_API_KEY` | hosting | secret | no |  | The AI adapter's Anthropic key. Unset: AI features answer "not set up". |
| `ANTHROPIC_MODEL` | hosting | string | no | `claude-sonnet-4-6` | The model the AI adapter asks. |
| `RESEND_API_KEY` | hosting | secret | no |  | The mail adapter's Resend key. Unset: mail is logged, not sent. |
| `RESEND_FROM`<br>`SMTP_FROM` (older name) | hosting | string | no |  | Default From address (a hub's own setting wins). |
| `POLIS_AUTH_TOKEN` | hosting | secret | no |  | The deliberation adapter's Polis service token. |
| `SEARCHAPI_API_KEY` | hosting | secret | no |  | Video adapter: SearchAPI transcripts (second choice). |
| `SUPADATA_API_KEY` | hosting | secret | no |  | Video adapter: Supadata transcripts (first choice). |
| `SUPABASE_STORAGE_BUCKET` | engine | string | no | `post-images` | The object store's public bucket for post images (the name predates the adapter; any store uses it). |
| `CIVIC_OBJECT_STORE` | hosting | string | no | `supabase` | Which object store: "supabase" (Supabase Storage on the database's project) or "memory" (nothing kept across restarts; the run-anywhere CI job). |
| `LINK_PREVIEW_USER_AGENT` | engine | string | no |  | User-Agent sent when fetching link previews. |
| `IMAGE_UPLOAD_MAX_MB` | engine | number | no |  | Upload size limit in MB, capped by the code's ceiling. |
| `HUB_CRON_ENABLED` | engine | boolean | no | `true` | "false" stops every scheduled job on this deployment. |
| `CIVIC_SEED_FIXTURE` | dev | string | no |  | Local seeding: which fixture auto-seed loads. |
| `CIVIC_ALLOW_SEED` | dev | boolean | no |  | Development: allow /debug/seed. |
| `CIVIC_RATE_LIMITS` | dev | string | no |  | Development: "off" disables rate limits. |
| `CIVIC_SSRF_ALLOW_PRIVATE` | dev | boolean | no |  | Development: let link fetches reach private addresses. |
| `CIVIC_FAKE_ADAPTERS` | dev | boolean | no |  | Development: every outside service is its in-memory fake (src/adapters/fakes/). |
| `CIVIC_POLIS_FAKE` | dev | boolean | no |  | Development, alias kept for one release: the deliberation adapter only is its fake. |
| `CIVIC_COC_FAKE` | dev | boolean | no |  | Development, alias kept for one release: the Code of Conduct check only is answered by the fake AI. |
| `CIVIC_DASHBOARD_FAKE` | dev | boolean | no |  | Development: the console's Dashboard reads hubs' /health from this server. |
| `CIVIC_PLUGINS_UNVERIFIED` | dev | boolean | no |  | Development: mount every configured plugin package without an approved catalog row (catalog:add's conformance run). |
| `CIVIC_ERROR_DSN` | hosting | secret | no |  | The errors adapter's Sentry DSN. Unset: errors go to the log only. |
| `CIVIC_ERROR_ENVIRONMENT` | hosting | string | no |  | The environment tag on every error ("production" or "dev"). |
| `CIVIC_HEARTBEAT_PING_KEY` | hosting | secret | no |  | The heartbeat adapter's Healthchecks.io ping key. Unset: jobs ping nothing. |
| `HEALTHCHECKS_READ_KEY` | hosting | secret | no |  | Console: Healthchecks.io read-only key (the backup card). |
| `BETTERSTACK_API_TOKEN` | hosting | secret | no |  | Console: Better Stack token (the uptime card). |
| `SENTRY_READ_TOKEN` | hosting | secret | no |  | Console: Sentry read token (the errors card). |
| `SENTRY_ORG` | hosting | string | no |  | Console: Sentry organization slug. |
| `SENTRY_PROJECT` | hosting | string | no |  | Console: Sentry project slug. |
| `GIT_COMMIT_SHA`<br>`VERCEL_GIT_COMMIT_SHA` (host, read first) | engine | string | no | `unknown` | The deployed commit (/health, error releases). |
| `DEPLOYMENT_ID`<br>`VERCEL_DEPLOYMENT_ID` (host, read first) | engine | string | no |  | The deployment's id (/health). |

**Hub-setting fallbacks.** Read only when a hub has no row of its own for the setting, for a single-hub self-host
with no settings rows (`ENV_FALLBACKS` in `src/models/hubSettings.ts`), never required:
`ADMIN_DIGEST_ENABLED`, `BOARD_RECIPIENT_EMAIL`, `CIVIC_ADMIN_EMAILS`, `CIVIC_BOARD_EMAILS`, `DIGEST_ENABLED`, `FEEDBACK_RECIPIENT_EMAIL`, `FLOYD_NEWS_SOURCE_URL`, `FLOYD_NEWS_SYNC_ENABLED`, `FLOYD_NEWS_SYNC_MAX_PER_RUN`, `HUB_NAME`, `HUB_POSTAL_ADDRESS`, `MEETING_CONNECTOR_ID`, `MEETING_EXTRACTION_INSTRUCTIONS`, `MEETING_SOURCE_URL`, `MEETING_SUMMARY_AUTO_PUBLISH`, `MEETING_SUMMARY_CUTOFF_DATE`, `MEETING_SUMMARY_ENABLED`, `MEETING_SUMMARY_MAX_PER_RUN`, `MEETING_TITLE_FILTER`, `MEETING_TYPE_EXCLUDE`, `MEETING_WIX_COLLECTION`, `MEETING_YOUTUBE_CHANNEL_ID`, `POLIS_BASE_URL`, `RESEND_FROM`, `SMTP_FROM`, `VITE_HUB_BANNER_ALT`, `VITE_HUB_BANNER_URL`, `VITE_HUB_DESCRIPTION`, `VITE_HUB_GOVERNING_BODY_NAME`, `VITE_HUB_GOVERNING_BODY_SHORT`, `VITE_HUB_INTRO_BODY`, `VITE_HUB_LABEL`, `VITE_HUB_NAME`, `VITE_HUB_ONBOARDING_WORDCLOUD_ID`, `VITE_HUB_PAGE_TITLE`, `VITE_HUB_POLIS_URL`, `VITE_HUB_RESIDENCY_INTRO`, `VITE_HUB_TAGLINE`, `VITE_HUB_THEME`.

<!-- settings:end -->

## What this doesn't cover

- **Push, text or phone-call alerts straight from the services:** paid. The phone hears through Gmail (Setup, step 5).
- **UI source maps:** browser stacks point at minified bundles. They'd need a Sentry token at build time; left for
  later.
- **Dev:** not watched at 3 am. The smoke hub's monitor and dev's Sentry environment are there for daytime checks;
  dev's jobs ping no heartbeats.

## Open items

- **ntfy push on the iPhone.** On 2026-10-16 messages reached the ntfy app (visible after a refresh) but never raised a
  notification, with notifications allowed: the app isn't getting Apple push. To try later: Background App Refresh
  on, reinstall, re-subscribe with "Use another server" off. If it still doesn't push, use **Telegram** instead,
  which Healthchecks.io integrates for free. Better Stack's webhook (for ntfy) wasn't checked: under Integrations →
  Exporting data.
- **The Console monitor**, after the next production release (Setup, step 2).
- **The Gmail filter** (Setup, step 5), if not yet done.
