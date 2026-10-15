# RUNBOOK-operations.md: monitoring, alerts, and what to do at 3 am

Since 2026-10-15 (the operations shell). Three outside services watch the deployment. None of them runs on our stack,
and none needs a card. Why these and what they may receive: `../decisions/006-outbound-operations-services.md`.

| Service | Watches | Alerts by | Account |
|---|---|---|---|
| **Better Stack** (Uptime) | `/api/health` on each production hub and the console, the docs, the dev smoke hub; every 3 min | email; ntfy push if its webhook is set (see Setup, step 1) | free: 10 monitors, 1 status page |
| **Healthchecks.io** | a ping from each scheduled job and from the backup dump | email and ntfy push | free (Hobbyist): 20 checks |
| **Sentry** | errors thrown in the API and the UI, dev and production | email, on the **first** occurrence of a new error | free (Developer): 5,000 errors a month |

The public status page is **https://status.civic.social** (Better Stack). It lists the production hubs and the docs.

## What is monitored

**Better Stack monitors.** Alerts after two failed checks in a row (3-minute confirmation period), and again on
recovery.

| Monitor | URL |
|---|---|
| Floyd hub | `https://floyd.civic.social/api/health` |
| Demosville hub | `https://demosville.civic.social/api/health` |
| Longmont hub | `https://longmont.civic.social/api/health` |
| Console | `https://console.civic.social/api/health` |
| Docs | `https://docs.civic.social/` |
| Dev smoke hub | `https://smoke.dev.civic.social/api/health` |

That's 6 of the 10 free monitors. A seventh production hub is the last that fits without a paid plan.

`/api/health` answers **503** unless the database answers, the host's hub passes its database check and the schema has
no gaps; a monitor fails on any of them, not only on a dead server (`src/http/health.ts`). It is never cached.

**Healthchecks.io checks.** Each check expects a ping on its cron schedule (UTC) and alerts once the grace period has
passed without one. A `/fail` ping alerts at once. Made by `npm run heartbeats:sync` from `src/jobs/registry.ts`.

| Check | Schedule (UTC) | Grace | Pinged by |
|---|---|---|---|
| `vote-close` | `5 * * * *` | 20 min | the hourly vote finalization |
| `digest` | `0 * * * *` | 20 min | the hourly resident digest |
| `hub-exports-sweep` | `15 * * * *` | 20 min | the export sweep |
| `admin-digest` | `30 13 * * *` | 2 h | the admin digest |
| `meeting-summary` | `30 11 * * *` | 2 h | meeting summaries |
| `news-sync` | `0 12 * * *` | 2 h | the news sync |
| `sample-refresh` | `45 6 * * *` | 2 h | demo hubs' sample refresh |
| `backup-dump` | `17 */6 * * *` | 1 h | civic-hub-backups `dump.yml` (prod target only) |

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

- **Your phone:** the ntfy app, subscribed to the topic you chose. Healthchecks.io always pushes there. Better Stack
  pushes there only if its Webhook integration was available on the free plan (Setup, step 1); otherwise its alerts are
  email only.
- **Email** (creatinglake@gmail.com): all three services.
- Sentry alerts once per new issue. A known error happening again does not alert; it is counted under its issue.

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
3. **It answers 403 "request was blocked".** Vercel's firewall stopped the monitor. Check that the rule "Uptime health
   checks" (path `/api/health` → Bypass) is still published (Setup, step 4).
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

**A spike** (a known error suddenly frequent) does not alert on its own. To be told: Sentry → Alerts → Create Alert →
Issues → "Number of events in an issue is more than 100 in one hour" → email. It's free on the Developer plan; not set
up as of 2026-10-15.

### A job's heartbeat is late (Healthchecks.io: "is DOWN")

1. Which check: the job id is the check's name (`vote-close` is `vote_close`).
2. Vercel → civic-hub → Settings → **Cron Jobs**: did the job run? Its **View Logs** shows the invocation.
   - **No invocation:** cron is off for the project, or `HUB_CRON_ENABLED` is `false`. Press **Run** on the job to
     run it now.
   - **It ran, but no ping arrived:** `CIVIC_HEARTBEAT_PING_KEY` is missing or wrong on Production. The log shows
     `[heartbeat] <job>: ping failed`.
   - **It ran past its time** (300 s maximum): the log shows the timeout. The job resumes next hour.
3. `vote-close` late matters most: votes past their deadline stay open until it runs. Press **Run** in Cron Jobs.

### A job's heartbeat failed (Healthchecks.io: "/fail")

A hub failed in that run. Hub settings → Plugins on the affected hubs shows each job's last run and last problem
(`GET /admin/hub/jobs/runs`). Vercel's logs for the run show `[civic-error:…]` lines, and Sentry has the error. The
next scheduled run tries again. A fail at 3 am that is followed by a success needs nothing at 3 am.

### The backup is late (Healthchecks.io: `backup-dump`)

1. GitHub → Mosaic-Foundation/civic-hub-backups → Actions → "Database dump". Did the 00:17 / 06:17 / 12:17 / 18:17 run
   start?
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

One step: in Better Stack, **Uptime → Monitors → the Floyd hub monitor → ⋯ → Clone**. Change the URL to
`https://<slug>.civic.social/api/health` and the name to the hub's. Then **Status pages → Civic Social → Resources →
Add resource** → the new monitor.

Nothing else: heartbeats and errors cover every hub already. (Better Stack's API could do this from the console, but
it needs a key on our side; not worth it at this size.)

## Silencing during a release

A production release with migrations can make `/api/health` answer 503 for a minute (RUNBOOK-release.md). To stay
quiet:
1. **Before:** Better Stack → Uptime → Monitors → select the hub monitors and the console → **Pause**.
2. **After** `release.sh prod` reports health ok: select them → **Resume**.

Without migrations, there's no need: Vercel switches deployments without a gap. Heartbeats need nothing: a release
doesn't stop the crons. Sentry needs nothing: a release's new errors are exactly what it is for.

A long planned outage: Better Stack → Status pages → Civic Social → **Maintenance** → schedule it, so the status page
says so.

## Rotating a key

No key reaches chat or the repository. After changing a Vercel variable, **redeploy** (Deployments → latest
Production → ⋯ → Redeploy), because a variable reaches only new deployments.

| Key | Where it lives | Rotate |
|---|---|---|
| Sentry DSN | Vercel civic-hub (Production) and civic-hub-dev: `CIVIC_ERROR_DSN` | Sentry → Project Settings → Client Keys → **Generate New Key**. Put it in both projects, redeploy both, then **Disable** the old key |
| Healthchecks.io ping key | Vercel civic-hub (Production): `CIVIC_HEARTBEAT_PING_KEY`; GitHub civic-hub-backups secret `HEALTHCHECKS_PING_KEY` | Healthchecks.io → Settings → Ping key → **Revoke**, then **Create**. Update both places straight away and redeploy civic-hub, because every check goes late until they match |
| Healthchecks.io API key | `~/civic-keys/healthchecks.env` (`HEALTHCHECKS_API_KEY`), used only by `npm run heartbeats:sync` | Settings → API Access → **Revoke**, create a new one, and replace the line in the file |
| ntfy topic | the ntfy app; Healthchecks.io's ntfy integration; Better Stack's webhook | Subscribe to a new topic in the app, change it in both integrations, unsubscribe the old one |

Better Stack holds no key of ours: it only fetches public URLs.

## Setup (done once, 2026-10-15)

0. **ntfy:** install the app, and subscribe to a long random topic on ntfy.sh. The topic name is the only secret.
1. **Better Stack** (betterstack.com, free):
   - Monitors as in the table above: "URL becomes unavailable", 3 min, confirmation period 3 min, recovery alerts
     on.
   - Integrations → Webhook (if offered on free) → `https://ntfy.sh/<topic>?title=Civic%20uptime`.
   - Status page "Civic Social" with custom domain `status.civic.social`, listing the three hubs and the docs.
   - DNS at GoDaddy: CNAME `status` → the target Better Stack shows (usually `statuspage.betteruptime.com`).
2. **Healthchecks.io** (Hobbyist):
   - Integrations → ntfy, with the topic.
   - Settings → Ping key → into Vercel civic-hub Production `CIVIC_HEARTBEAT_PING_KEY` (Sensitive) and GitHub
     civic-hub-backups secret `HEALTHCHECKS_PING_KEY`.
   - Settings → API key → `~/civic-keys/healthchecks.env`.
   - Then:
     ```bash
     cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && npm run heartbeats:sync
     ```
   - Then add the heartbeat step to civic-hub-backups `dump.yml` (below).
3. **Sentry** (Developer):
   - Project `civic-hub`, platform Express, "alert on every new issue".
   - Security & Privacy: Data Scrubber, default scrubbers, and Prevent Storing of IP Addresses all on.
   - Client Keys → DSN into `CIVIC_ERROR_DSN` on both Vercel projects. `CIVIC_ERROR_ENVIRONMENT` is `production` on
     civic-hub and `dev` on civic-hub-dev.
4. **Vercel firewall** (civic-hub): Firewall → Configure → New Rule "Uptime health checks": Request Path equals
   `/api/health` → Bypass → Save → Publish.

**The backup heartbeat step** (civic-hub-backups `.github/workflows/dump.yml`, after "Dump, encrypt, upload"):

```yaml
      - name: Heartbeat
        if: always() && env.TARGET == 'prod'
        run: curl -fsS -m 10 --retry 3 -o /dev/null "https://hc-ping.com/${{ secrets.HEALTHCHECKS_PING_KEY }}/backup-dump${{ job.status != 'success' && '/fail' || '' }}"
```

## What this doesn't cover

- **Text or phone-call alerts:** paid on all three services. Push through ntfy instead.
- **UI source maps:** browser stacks point at minified bundles. They'd need a Sentry token at build time; left for
  later.
- **Dev:** not watched at 3 am. The smoke hub's monitor and dev's Sentry environment are there for daytime checks;
  dev's jobs ping no heartbeats.
