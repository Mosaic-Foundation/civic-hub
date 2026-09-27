# RUNBOOK-release-1.md — the release-1 sitting

Takes production (`floyd.civic.social`, Vercel project `civic-hub`, Supabase
**Civic-Hub-Floyd** `nfhyypwoporfggqcerli`) from the cutover build to release
1: the post-cutover cleanup, six migrations (the four Phase 5–7 ones and the
two from 2026-09-27: the jurisdiction list, and the audit log's hub foreign
key), the jurisdiction list's rows, the current `multi-tenant` code, the
console at `console.civic.social`, Floyd's jurisdiction id, and hubs at
`<slug>.civic.social`.

Written 2026-09-27. The cleanup migration was tested on a local copy of
production's data, and the whole migration sequence was rehearsed on the
local stack (HANDOFF, "Release-1 prep"). **Adam runs every production step by
hand.** No session writes to production.

## How to read this

- One action per numbered step. **Who** is in bold at the start: **Adam** (by
  hand), or **script** (a command Adam runs, which does the work).
- Every command starts with `cd …`, so each block can be pasted on its own.
  Paste one block, press Enter, read the result, then go to the next.
- **No production command depends on another command's parsed output.** Where
  a step needs a value from an earlier one, you read it and type it.
- **Worked if** is what you should see. **Stop** means stop: write down what
  you saw and bring it to a session.
- Keys and secrets move from files or the clipboard, never through a chat, a
  commit, a screenshot or a note.
- Keep a notes file open and write down the time and result of each step. It
  becomes the HANDOFF entry.

## At a glance

| § | What | Undo |
|---|---|---|
| 0 | The day before, on dev: the same release | dev only |
| 1 | Pre-checks: health, logs, keys, postal address, Resend, stale votes, snapshot | nothing changes |
| 2 | **Cleanup: migration and env tidy. The point of no return.** | none |
| 3 | Migrations: exactly six; then the jurisdiction list | none |
| 4 | Code to production, health, parity | none |
| 5 | Console: `console.civic.social`, env vars, the platform sender, Floyd's jurisdiction id | none |
| 6 | Wildcard: `*.civic.social` | none |
| 7 | Final check: a throwaway hub, created and archived | none |
| 8 | Afterwards: files to delete | — |

**Nothing after the cleanup (§2) is rolled back.** From §2 step 3 on, a
problem is fixed forward in a session. §1 changes nothing, so stopping during
§1 leaves production exactly as it is. See "Rollback notes" at the end.

**Values to have ready** (password manager, not a file in the repo):

| Value | Used in |
|---|---|
| The platform sending domain you verified in Resend (e.g. `mail.civic.social`) and the address on it, e.g. `noreply@mail.civic.social`: **PLATFORM_SENDER** | §1.6, §5 |
| The one address that may sign in to the console: **CONSOLE_ADMIN** | §5 |
| The platform's postal address for digest footers (e.g. the foundation's mailing address): **PLATFORM_POSTAL_ADDRESS** | §1.5 |
| Production's database password (Supabase → Civic-Hub-Floyd → Database), for the jurisdiction load | §3.7 |

**Choose the time outside 11:30–13:30 UTC** (7:30–9:30 am Eastern), when the
meeting-summary, news, digest and admin-digest jobs run. Budget two hours;
DNS waits are most of it.

---

## 0. The day before, on dev (Adam, ~30 min)

Dev (`civic-hub-dev`, `*.dev.civic.social`) gets the same release first. It
has the four migrations already, so the cleanup arrives there out of order,
together with the two from 2026-09-27.

1. **Adam.** Push `multi-tenant` so dev builds it:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git push origin multi-tenant
   ```
   Worked if: the push succeeds; Vercel → `civic-hub-dev` shows a new
   Production build, then **Ready**.
2. **Adam.** Open `https://<anything-random>.dev.civic.social` (a name no hub
   has). Worked if: a plain page reading **No hub here**, not the app with
   "Could not load the feed: no_hub".
3. **script.** Dev's migration list (read-only; `civic-hub/` is linked to dev):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && cat supabase/.temp/project-ref && ./scripts/db-push.sh --dry-run --include-all
   ```
   Worked if: it prints `urfmvqhzmamigssqwsya`, then lists exactly **three**
   migrations: `20260926005000_post_cutover_cleanup.sql`,
   `20260927000000_jurisdictions.sql`, `20260927010000_audit_log_drop_hub_fk.sql`.
   If the ref is `nfhyypwoporfggqcerli` (production): stop.
4. **script.** Apply them to dev:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && ./scripts/db-push.sh --include-all
   ```
   Answer `y`. Worked if: three `Applying migration …` lines, then
   `Finished supabase db push.`
4a. **script.** The jurisdiction list on dev (`~/civic-keys/dev-db.env` holds
   dev's `CIVIC_TARGET_DATABASE_URL`):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/dev-db.env --import tsx scripts/load-jurisdictions.ts
   ```
   Worked if: `jurisdictions now holds …` with the row count in
   `config/jurisdictions/SOURCES.md`. Run it again: `already loaded … Nothing to do.`
4b. **Adam.** https://console.dev.civic.social → Floyd's dev copy →
   Configuration → Jurisdiction → From the list → Virginia → County → type
   "Floyd" → choose **Floyd County, Virginia** → Save configuration. Worked
   if: the audit trail shows `hub.update` with `jurisdiction_ocd_id`. Athens
   and Utopia are fictional places: leave them unlinked.
4c. **Adam.** Console → Create hub: Virginia → Town → "Floyd" → **Town of
   Floyd, Virginia**. Worked if: the display name, code, OCD id and "Town
   Council" fill in; the slug suggests `floyd-town` (the plain `floyd` is
   reserved); the Plugins section opens to 14 boxes, all ticked. Untick one,
   create (demo, sample content on), and archive it afterwards if you don't
   want it.
5. **Adam.** https://console.dev.civic.social/ → sign in; open any hub; and
   https://athens.dev.civic.social loads. `…/api/health` on
   `civic-hub-dev.vercel.app` → `status ok`.

If any of 1–5 fails, don't hold the sitting: bring it to a session.

---

## 1. Pre-checks (~20 min; nothing changes)

1. **Adam.** https://floyd.civic.social/api/health.
   Worked if: `"status":"ok"`, `"hub_db":{"mode":"hub_token","ok":true}`,
   `"schema":{"ok":true,…}`. Write down `commit` (expected `0b23e9a…`).
2. **Adam.** Vercel → `civic-hub` → Logs, last 24 h, filter **Error**. Look
   for `42501`, `PGRST`, `row-level security`, `hub_db`, `Storage upload
   failed`. Worked if: none. Otherwise stop.
3. **Adam.** Legacy keys are retired (you did this on the 29th, cutover
   runbook §5): Supabase → Civic-Hub-Floyd → Settings → API Keys → "Legacy
   anon, service_role API keys" shows them **disabled**, and Settings → JWT
   Keys shows the legacy HS256 key **revoked**. If not: finish that first
   (cutover runbook §5, last item), then come back.
4. **script.** Local `main` matches GitHub, and GitHub's `main` is still the
   cutover build (read-only):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git fetch origin && git log --oneline -1 origin/main && git log --oneline -1 release-1-cleanup && git log --oneline -1 multi-tenant
   ```
   Worked if: `origin/main` is `0b23e9a HANDOFF: the Floyd cutover…`;
   `release-1-cleanup` is `d108e24 Release 1: the post-cutover cleanup
   migration alone…`. Write down the `multi-tenant` line as **RELEASE
   COMMIT**. If `origin/main` is anything else: stop.
5. **Adam.** Supabase → Civic-Hub-Floyd → **SQL Editor** → New query → Run:
   ```sql
   select key, value from hub_settings
    where hub_id = 'floyd' and key in ('email.postal_address', 'email.from_name', 'email.from_address')
    order by key;
   ```
   Worked if: `email.from_name` is `Floyd Civic Hub` and `email.from_address`
   is `noreply@floyd.civic.social` (§5 removes that row). Note whether
   `email.postal_address` is there.
5a. **Adam.** The platform's postal address, which every hub without its own
   prints in its digest footer. §2 removes `HUB_POSTAL_ADDRESS`, so set this
   first (the release code reads it from §4 on):
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_PLATFORM_POSTAL_ADDRESS production --no-sensitive --force --value "PLATFORM_POSTAL_ADDRESS"
   ```
   (Replace `PLATFORM_POSTAL_ADDRESS`, keeping the quotes.) Worked if:
   `Added` or `Overrode`. §2.9's redeploy picks it up.
   **The alternative** (or both): give Floyd its own address — Floyd → Admin
   → Settings → Email → Postal address → save, then step 5's query shows it.
   Floyd's own address wins over the platform's.
   Between §2.9 and §4 the running code is still `0b23e9a`, which reads only
   Floyd's own row: if Floyd has none, a digest sent in that window has no
   address line. The sitting's time (outside 11:30–13:30 UTC) keeps digests
   out of that window.
6. **Adam.** Resend → **Domains**: the platform sending domain (the one in
   **PLATFORM_SENDER**) shows **Verified**. If not: stop; the console's
   sign-in codes would not arrive.
7. **Adam.** Votes past their deadline but still open, in the SQL editor:
   ```sql
   select id, title, state->>'voting_closes_at' as closes_at
     from processes
    where hub_id = 'floyd' and type = 'civic.vote' and status = 'active'
      and state->>'status' = 'active'
      and (state->>'voting_closes_at')::timestamptz < now()
    order by closes_at;
   ```
   Write down the number of rows as **N**, with their ids.
   **The first `vote-close` run after the code is live (hourly, at :05) closes
   all N**, each stamped with its own deadline, and each close adds a pending
   results brief to Admin → Reviews. Today's code would instead close them the
   moment anyone opens the vote list, stamped with that moment, which is why
   step 9 avoids the vote list.
8. **Adam.** No DNS record exists yet for the names §5 and §6 add:
   ```bash
   dig +short console.civic.social && dig +short _acme-challenge.civic.social NS && dig +short r1-check.civic.social
   ```
   Worked if: it prints nothing. If any line prints: stop.
9. **Adam.** The **BEFORE** snapshot. Open https://floyd.civic.social,
   open the developer console (⌥⌘J in Chrome), paste:
   - **If N is 0:** the full parity snippet, `RUNBOOK-cutover.md` Appendix A.
   - **If N is above 0:** the short snippet in Appendix A of this file. It
     reads only proposals and the feed, which close nothing.

   Press Enter, and copy the table into your notes as **BEFORE**.

**Go/no-go.** All of them passed: go on. Otherwise stop here; nothing has
changed.

---

## 2. Cleanup — the point of no return (~15 min)

After step 3, production's database no longer works with the single-tenant
`main` build (`3283f48`), and the cutover rollback (cutover runbook §6) is
gone for good. The migration drops, from production's schema: the `DEFAULT
'floyd'` on all 30 `hub_id` columns; the global keys (`users_email_key`, and
the email/url primary keys of `pending_verifications`, `waitlist`,
`link_previews`, which become `(hub_id, …)` primary keys); the 14
single-column foreign keys kept beside their composite twins; the hub-less
search functions; and the rollback index if present. It changes no row. It is
one transaction and ends with a check: if anything it names survives, it
fails and changes nothing.

It is pushed from its own branch, `release-1-cleanup` (production's `main`
plus only this migration and the `vote_drafts` trigger production already
has), so the dry run lists it alone. `civic-hub/` stays linked to dev
throughout; production is linked only from a separate folder.

1. **Adam.** A separate folder on that branch, linked to production:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git worktree add ~/civic-release-1 release-1-cleanup
   ```
   ```bash
   cd ~/civic-release-1 && supabase link --project-ref nfhyypwoporfggqcerli
   ```
   If it asks for a database password, press Enter.
   Worked if: `cat ~/civic-release-1/supabase/.temp/project-ref` prints
   `nfhyypwoporfggqcerli`.
2. **script.** Dry run:
   ```bash
   cd ~/civic-release-1 && CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh --dry-run
   ```
   Worked if: it lists exactly **one** migration,
   `20260926005000_post_cutover_cleanup.sql`.
   If it lists anything else, or complains of remote versions missing
   locally: stop. Production is unchanged.
3. **script. The point of no return.** Push:
   ```bash
   cd ~/civic-release-1 && time CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh
   ```
   Answer `y`. Worked if: `Applying migration 20260926005000_post_cutover_cleanup.sql...`,
   then `Finished supabase db push.` (On production's data it took 0.1 s.)
   If it fails: the migration is one transaction, so nothing changed. Copy
   the error and stop; production is still in §1's state.
4. **Adam.** https://floyd.civic.social/api/health → `status ok`, `hub_token
   ok`, same `commit` as §1.1. (Production's current code was tested on the
   cleaned schema.)
5. **script.** The tenancy check (read-only):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env.prod --import tsx scripts/check-tenancy.ts --prod
   ```
   Worked if: the last line starts `CLEAN — 31 tables, 30 hub-scoped`.
   If not: stop.
6. **Adam.** The env tidy: which variables Floyd no longer needs. In the SQL
   editor, run this (read-only). It lists every variable that only ever
   supplied a setting, and whether Floyd has that setting as a row:
   ```sql
   select v.env_var, v.key,
          case when exists (
            select 1 from hub_settings s
             where s.hub_id = 'floyd' and s.key in (v.key, coalesce(v.alias, ''))
               and coalesce(s.value, '') <> '')
          then 'row' else 'NO ROW' end as floyd
     from (values
       ('ADMIN_DIGEST_ENABLED', 'plugin.admin_digest.enabled', null),
       ('BOARD_RECIPIENT_EMAIL', 'people.brief_recipients', 'brief_recipient_emails'),
       ('DIGEST_ENABLED', 'plugin.digest.enabled', null),
       ('FEEDBACK_RECIPIENT_EMAIL', 'plugin.feedback.recipients', null),
       ('FLOYD_NEWS_SOURCE_URL', 'plugin.news_sync.source_url', null),
       ('FLOYD_NEWS_SYNC_ENABLED', 'plugin.news_sync.enabled', null),
       ('FLOYD_NEWS_SYNC_MAX_PER_RUN', 'plugin.news_sync.max_per_run', null),
       ('HUB_NAME', 'identity.name', null),
       ('HUB_POSTAL_ADDRESS', 'email.postal_address', null),
       ('MEETING_CONNECTOR_ID', 'plugin.meeting_summary.connector_id', null),
       ('MEETING_EXTRACTION_INSTRUCTIONS', 'plugin.meeting_summary.extraction_instructions', null),
       ('MEETING_SOURCE_URL', 'plugin.meeting_summary.source_url', null),
       ('MEETING_SUMMARY_AUTO_PUBLISH', 'plugin.meeting_summary.auto_publish', null),
       ('MEETING_SUMMARY_CUTOFF_DATE', 'plugin.meeting_summary.cutoff_date', null),
       ('MEETING_SUMMARY_ENABLED', 'plugin.meeting_summary.enabled', null),
       ('MEETING_SUMMARY_MAX_PER_RUN', 'plugin.meeting_summary.max_per_run', null),
       ('MEETING_TITLE_FILTER', 'plugin.meeting_summary.title_filter', null),
       ('MEETING_TYPE_EXCLUDE', 'plugin.meeting_summary.type_exclude', null),
       ('MEETING_WIX_COLLECTION', 'plugin.meeting_summary.wix_collection', null),
       ('MEETING_YOUTUBE_CHANNEL_ID', 'plugin.meeting_summary.youtube_channel_id', null),
       ('POLIS_BASE_URL', 'plugin.conversation.polis_url', null),
       ('VITE_HUB_BANNER_ALT', 'identity.banner_alt', null),
       ('VITE_HUB_BANNER_URL', 'identity.banner_url', null),
       ('VITE_HUB_DESCRIPTION', 'identity.description', null),
       ('VITE_HUB_GOVERNING_BODY_NAME', 'copy.governing_body_name', null),
       ('VITE_HUB_GOVERNING_BODY_SHORT', 'copy.governing_body_short', null),
       ('VITE_HUB_INTRO_BODY', 'copy.intro_body', null),
       ('VITE_HUB_LABEL', 'identity.label', null),
       ('VITE_HUB_NAME', 'identity.name', null),
       ('VITE_HUB_ONBOARDING_WORDCLOUD_ID', 'plugin.wordcloud.onboarding_id', null),
       ('VITE_HUB_PAGE_TITLE', 'identity.page_title', null),
       ('VITE_HUB_POLIS_URL', 'plugin.conversation.polis_url', null),
       ('VITE_HUB_RESIDENCY_INTRO', 'copy.residency_intro', null),
       ('VITE_HUB_TAGLINE', 'identity.tagline', null),
       ('VITE_HUB_THEME', 'identity.theme', null)
     ) as v(env_var, key, alias)
    order by floyd, env_var;
   ```
   Then open Vercel → `civic-hub` → Settings → **Environment Variables**
   beside it. For each variable in the query's list that **exists on
   Vercel**, its `floyd` column must say `row`.
   If a variable that exists on Vercel says `NO ROW`: removing it would lose
   that value for Floyd. Stop, and bring the line to a session (it writes the
   row, then you continue from this step). A `NO ROW` for a variable that is
   not on Vercel is fine. One exception: `HUB_NAME` and `VITE_HUB_NAME` may
   say `NO ROW`, because without an `identity.name` row the name comes from
   the `hubs` row (step 7), which already says `Floyd Civic Hub`.
7. **Adam.** The identity the `hubs` row replaced, in the SQL editor:
   ```sql
   select name, hostname, jurisdiction_code, jurisdiction_name, space_did, mode from hubs where id = 'floyd';
   ```
   Worked if: every column filled; `hostname` `floyd.civic.social`; `mode`
   `beta`.
8. **Adam.** Vercel → `civic-hub` → Settings → Environment Variables:
   **delete** these, where present (all environments):
   - every `MEETING_*` and every `FLOYD_NEWS_*` variable (the console refuses
     to create a hub on production while any of them is set);
   - the rest of step 6's list: `HUB_NAME`, `HUB_POSTAL_ADDRESS`,
     `POLIS_BASE_URL`, `FEEDBACK_RECIPIENT_EMAIL`, `BOARD_RECIPIENT_EMAIL`,
     `DIGEST_ENABLED`, `ADMIN_DIGEST_ENABLED`, and every `VITE_HUB_*`;
   - the six the `hubs` row replaced (step 7): `CIVIC_JURISDICTION`,
     `CIVIC_JURISDICTION_NAME`, `CIVIC_SPACE_DID`, `VITE_HUB_JURISDICTION`,
     `CIVIC_BETA_MODE`, `VITE_BETA_MODE`.

   > **OPEN (found 2026-09-27; settle before the sitting).** New processes
   > are stamped with `CIVIC_JURISDICTION`, not with the hub's own
   > `jurisdiction_code` (`DEFAULT_JURISDICTION` in `src/config/hub.ts`, used
   > by `processService.createProcess` and a few event paths). Deleting it
   > turns the `jurisdiction` on Floyd's new processes and events from
   > `us-va-floyd` into `local`, so their published activities lose their
   > place; keeping it stamps Floyd's code on every other hub's new
   > processes. HANDOFF (2026-09-27, "The jurisdiction code") has the
   > inventory and the recommended fix; until it is decided, don't delete
   > `CIVIC_JURISDICTION`.

   **Keep everything else**, in particular: `CIVIC_ANON_SECRET` (never
   change it: residents' public pseudonyms), `CIVIC_ALLOWED_ORIGINS`,
   `CRON_SECRET`, `DIGEST_UNSUBSCRIBE_SECRET`, `RESEND_*`, the Supabase keys,
   `CIVIC_HUB_SIGNING_KEY`, `CIVIC_HUB_MINTED_TOKEN`, `CIVIC_ADMIN_EMAILS`
   and `CIVIC_BOARD_EMAILS` (the bootstrap lists, read outside any request),
   `ANTHROPIC_API_KEY`, `POLIS_*` other than `POLIS_BASE_URL`, `SMTP_*`.
   Write down every variable you deleted.
9. **Adam.** Env changes take effect only in a new deployment. Vercel →
   `civic-hub` → Deployments → the top **Production** deployment (`0b23e9a`)
   → ⋯ → **Redeploy**. Wait for **Ready**.
10. **Adam.** https://floyd.civic.social/api/health → `status ok`, `hub_token
    ok`. Then https://floyd.civic.social/api/hub-config → `"id":"floyd"`,
    `identity.name` Floyd's name. Open the home page: name, banner and
    welcome text as before.
    If something is missing: the variable you deleted for it had no row
    after all. Bring the line to a session; don't put the variable back
    without one.

---

## 3. Migrations — exactly six, then the jurisdiction list (~10 min)

1. **Adam.** Move the production-linked folder to the release commit
   (`multi-tenant`; the link stays):
   ```bash
   cd ~/civic-release-1 && git checkout --detach multi-tenant && git log --oneline -1
   ```
   Worked if: the line is your **RELEASE COMMIT** from §1.4.
2. **script.** Dry run:
   ```bash
   cd ~/civic-release-1 && CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh --dry-run
   ```
   Worked if: it lists exactly these **six**, in this order:
   `20260926010000_control_plane.sql`, `20260926020000_hub_exports_bucket.sql`,
   `20260926030000_events_recorded_at.sql`, `20260926040000_sample_content.sql`,
   `20260927000000_jurisdictions.sql`, `20260927010000_audit_log_drop_hub_fk.sql`.
   The last one is the only non-additive one: it drops one constraint, the
   audit log's foreign key to `hubs`, so a never-used hub can be purged
   (`scripts/purge-hub.ts`); no row changes.
   If it lists anything else: stop. (Production runs its current code on the
   cleaned schema, which was tested; nothing is waiting on this.)
3. **script.** Push:
   ```bash
   cd ~/civic-release-1 && time CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh
   ```
   Answer `y`. Worked if: six `Applying migration …` lines, then
   `Finished supabase db push.`
   If one fails: the CLI stops there. Run `cd ~/civic-release-1 && supabase
   migration list` and copy both outputs; stop. The migrations are additive
   and the current code keeps serving.
4. **Adam.** Unlink and remove the folder:
   ```bash
   cd ~/civic-release-1 && supabase unlink
   ```
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git worktree remove ~/civic-release-1 && cat supabase/.temp/project-ref
   ```
   Worked if: the last line prints `urfmvqhzmamigssqwsya` (`civic-hub/` is
   still on dev). If `worktree remove` refuses because of the `.temp` files,
   add `--force` to it.
5. **script.** The tenancy check again:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env.prod --import tsx scripts/check-tenancy.ts --prod
   ```
   Worked if: `CLEAN — 36 tables, 31 hub-scoped` (the 36th is
   `jurisdictions`, platform reference data).
6. **Adam.** https://floyd.civic.social/api/health → `status ok`.
7. **Adam.** An env file for production's database, used only by the next
   step (`chmod 600`; deleted in §8): create `~/civic-keys/prod-pg.env` with
   one line,
   ```
   CIVIC_TARGET_DATABASE_URL=postgresql://postgres.nfhyypwoporfggqcerli:<db password>@<the Session pooler host>:5432/postgres
   ```
   from Supabase → Civic-Hub-Floyd → Connect → **Session pooler** (not the
   transaction pooler).
8. **script.** Load the jurisdiction list (a dry run first; it writes only
   the `jurisdictions` table):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-pg.env --import tsx scripts/load-jurisdictions.ts --dry-run
   ```
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-pg.env --import tsx scripts/load-jurisdictions.ts
   ```
   Worked if: the checksum line matches `config/jurisdictions/us-jurisdictions.sha256`,
   then `jurisdictions now holds …` with the count in
   `config/jurisdictions/SOURCES.md`. If it says `Checksum mismatch`: stop;
   the file in the folder is not the committed one.

---

## 4. Code to production (~10 min)

1. **Adam.**
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git push origin multi-tenant:main
   ```
   Worked if: the push is a fast-forward (`0b23e9a..<release commit>`).
   If it's rejected: `main` has moved since §1.4. Stop.
2. **Adam.** Vercel → `civic-hub` → Deployments: the new Production build.
   Wait for **Ready**.
3. **Adam.** https://floyd.civic.social/api/health.
   Worked if: `status ok`, `hub_db: hub_token, ok`, `schema ok`, and
   `commit` is the release commit.
   If it's a 500 or blank: Vercel → the deployment → Logs; copy the error;
   bring it to a session.
4. **Adam. Parity.** On https://floyd.civic.social, paste the same snippet
   as §1.9 and compare with **BEFORE**.
   - **N = 0:** every row matches. A row may differ only if someone acted on
     Floyd in the meantime (the feed would have a few more events).
   - **N > 0:** `/api/proposals` matches. `/api/feed` may have more items:
     the N votes' closes, if a read or the :05 run has closed them already
     (and anything residents did). After the next :05, run §1.7's query
     again in the SQL editor: worked if 0 rows, and Admin → Reviews shows N
     new results briefs waiting.
   Checked beforehand: on the same local data, this build and `0b23e9a` give
   identical process list, proposals, feed and search.
5. **Adam.** Vercel → `civic-hub` → Settings → **Cron Jobs** lists six,
   including `/api/internal/vote-close/run` (hourly at :05) and
   `/api/internal/hub-exports-sweep/run` (hourly at :15).
6. **Adam.** https://floyd.civic.social/votes loads, and a made-up path
   such as https://floyd.civic.social/process/nope shows the app's
   not-found page, as before.

---

## 5. Console, and the platform sender (~20 min, most of it DNS)

1. **Adam.** Vercel → `civic-hub` → Settings → **Domains** → Add →
   `console.civic.social` → Add. Write down the **CNAME value** it shows.
2. **Adam.** GoDaddy → `civic.social` → DNS → Add New Record:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `console` | the value from step 1 | 1 hour |

   Don't edit or delete any existing record.
3. **Adam.** Env vars, from the production-linked Vercel folder (made at the
   cutover). Check it first: `cat ~/civic-prod-link/.vercel/project.json`
   names `civic-hub`. Then, one block at a time, typing your values:
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_CONSOLE_HOSTNAME production --no-sensitive --force --value console.civic.social
   ```
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_CONSOLE_ADMIN_EMAIL production --no-sensitive --force --value CONSOLE_ADMIN
   ```
   ```bash
   cd ~/civic-prod-link && vercel env add RESEND_FROM production --no-sensitive --force --value PLATFORM_SENDER
   ```
   (Replace `CONSOLE_ADMIN` and `PLATFORM_SENDER` with the values. `RESEND_FROM`
   is a bare address: each hub's name goes beside it from its own
   `email.from_name`.) Worked if: each prints `Overrode` or `Added`.
4. **Adam.** Vercel → Deployments → the top Production deployment (the
   release commit) → ⋯ → **Redeploy**. Wait for **Ready**.
5. **Adam.** Floyd moves to the platform sender (decided 2026-09-27): its
   `email.from_address` row still names `noreply@floyd.civic.social`, and a
   row beats the environment. SQL editor:
   ```sql
   delete from hub_settings where hub_id = 'floyd' and key = 'email.from_address' returning key, value;
   ```
   Worked if: one row, `noreply@floyd.civic.social`. Settings are cached for
   up to a minute.
6. **Adam.** A minute later: sign out of Floyd and sign in again.
   Worked if: the code arrives, from **Floyd Civic Hub** at the
   **PLATFORM_SENDER** address. If no code arrives in 5 minutes: check
   Resend → Emails for the error. Floyd still works for signed-in residents;
   bring it to a session.
7. **script.** After 10–60 minutes:
   ```bash
   dig +short console.civic.social
   ```
   Worked if: Vercel names and addresses.
8. **Adam.** Vercel → Domains: `console.civic.social` **Valid
   Configuration**. Then its row → make it the project's **primary** domain.
   Leave `floyd.civic.social` as it is: it must **not** redirect anywhere.
9. **Adam.** https://console.civic.social → the console's sign-in → your
   **CONSOLE_ADMIN** address → a code arrives from **PLATFORM_SENDER** →
   signed in: the hub list shows `floyd`.
10. **Adam.** https://floyd.civic.social still opens Floyd (not the console),
    and `/api/health` is `status ok`.
11. **Adam.** Floyd's jurisdiction id: console → `floyd` → Configuration →
    Jurisdiction → From the list → Virginia → County → type "Floyd" →
    choose **Floyd County, Virginia**. Check the line under it reads
    `ocd-division/country:us/state:va/county:floyd`, the display name
    `Floyd County, Virginia` and the code `us-va-floyd` (both as today), and
    the hub type County. Leave the governing body as it is → Save
    configuration. Worked if: the audit trail's newest row is `hub.update`
    with `jurisdiction_ocd_id` in its after, and Floyd's pages look as before.

---

## 6. Wildcard `*.civic.social` (~20 min, most of it DNS)

`RUNBOOK-cutover.md` §8, with its step 2 (Enable Vercel DNS) skipped: it was
done for dev on 2026-09-27 and is shared with production.

1. **Adam.** Vercel → project **`civic-hub`** (not `civic-hub-dev`) →
   Settings → Domains → Add → `*.civic.social` → Add. Worked if: listed with
   "Invalid Configuration" and instructions. Write down the **CNAME value**
   it shows.
2. **Adam.** GoDaddy → `civic.social` → DNS → Add New Record, twice:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | NS | `_acme-challenge` | `ns1.vercel-dns.com` | 1 hour |
   | NS | `_acme-challenge` | `ns2.vercel-dns.com` | 1 hour |

3. **Adam.** GoDaddy → Add New Record:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `*` | the value from step 1 | 1 hour |

   Don't edit or delete any existing record (`*.dev`, `_acme-challenge.dev`,
   `console`, `floyd` … all stay).
4. **script.** After 10–60 minutes:
   ```bash
   dig +short anything-at-all.civic.social && dig +short _acme-challenge.civic.social NS
   ```
   Worked if: Vercel names and addresses, then the two `vercel-dns.com` names.
5. **Adam.** Vercel → Domains: `*.civic.social` **Valid Configuration**
   with a certificate. https://anything-at-all.civic.social opens with no
   certificate warning and says **No hub here**.
6. **Adam.** Each of these looks exactly as before: https://civic.social,
   https://floyd.civic.social, https://representative.civic.social,
   https://citizendashboard.civic.social, https://console.civic.social,
   https://athens.dev.civic.social (still dev).

**Undo** (the one step here with an undo, since no site depends on it yet):
delete the `*` CNAME at GoDaddy.

---

## 7. Final check: one throwaway hub (~10 min)

`r1-check` stays taken after this step (an archived hub's hostname does),
unless you free it with §8.5.

1. **Adam.** https://console.civic.social → **Create hub**: Jurisdiction →
   **Other / not listed**, name "Example County, Virginia"; code
   `us-va-example`; hub type County (governing body pre-fills **Board of
   Supervisors**); slug `r1-check` (type it over the suggestion); name
   `Release Check`; leave Plugins as they are; mode **demo**,
   **sample content on**, your address as its admin → create, with the fresh
   code. Worked if: created; the audit shows `hub.create` and
   `hub.sample_seed`. If it's refused naming `MEETING_…` or `FLOYD_NEWS_…`: a
   variable survived §2.8; delete it, redeploy, and retry.
2. **Adam.** https://r1-check.civic.social (in a private window).
   Worked if: the demo bar; feed cards badged **Sample**; "Example County"
   and "Board of Supervisors" filled in, no `{…}` placeholder; the Votes
   page lists sample votes. Nothing of Floyd's anywhere.
3. **Adam.** https://floyd.civic.social: unchanged, no Sample badges.
4. **Adam.** Console → `r1-check` → **Archive**, with a fresh code.
5. **Adam.** A minute later, https://r1-check.civic.social says **This hub
   is paused**.
6. **Adam.** https://floyd.civic.social/api/health: `status ok`,
   `hub_token ok`. Done.

---

## 8. Afterwards

1. **Adam.** Delete the cutover's production data and secrets (cutover
   runbook §7, "Then"): `~/civic-cutover/`, `~/civic-keys/prod-pull.env`,
   `~/civic-keys/prod-db.env`, and `~/civic-prod-link` if you won't need it.
   Keep `~/civic-keys/prod-es256.json` in the password manager.
2. **Adam.** Delete the local branch the cleanup came from; it is not needed
   again and must never be pushed:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git branch -D release-1-cleanup
   ```
3. **A session.** The code tidy left from cutover runbook §7: the "until
   the cutover" entries in `scripts/place-name-allowlist.txt` with the env
   fallbacks they excuse, the alias map in `src/models/hubSettings.ts`, the
   `MEETING_*`/`FLOYD_NEWS_*` create guard, and the 23505 "address in use on
   another hub" guards (unreachable since the cleanup).
4. **Adam.** Tell the beta testers if their sign-in mail now comes from a
   different address (§5).
5. **script, optional.** Free `r1-check`'s slug and hostname: it was never
   used, so it can be purged. Needs `~/civic-keys/prod-db.env` (storage) and
   `prod-pg.env` (§3.7). Without `--confirm` it only prints what it would
   delete; read it, then run the second block:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-db.env --env-file=$HOME/civic-keys/prod-pg.env --import tsx scripts/purge-hub.ts --hub r1-check
   ```
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-db.env --env-file=$HOME/civic-keys/prod-pg.env --import tsx scripts/purge-hub.ts --hub r1-check --confirm r1-check
   ```
   Worked if: `r1-check is purged`; the export it took first is in
   `exports/`. Then delete `~/civic-keys/prod-pg.env`.

---

## Rollback notes

- **§0 (dev):** dev only. The cleanup on dev is not undone either; dev is
  rebuilt from production when needed (`scripts/dev-refresh-from-dump.sh`).
- **§1, every step:** changes nothing. Stopping anywhere in §1 leaves
  production as it was: nothing to undo.
- **§2 steps 1–2** (folder, link, dry run): nothing on production changes.
  To stop here: `cd ~/civic-release-1 && supabase unlink`, then
  `git worktree remove ~/civic-release-1` from `civic-hub/`.
- **From §2 step 3 on: nothing is rolled back.** The cleanup ends the
  cutover's rollback for good, and every later step is fixed forward in a
  session.

---

## Appendix A — short parity snippet (N > 0)

Reads only `/api/proposals` and `/api/feed`, neither of which closes a vote.
Paste into the browser console on https://floyd.civic.social.

```js
(async () => {
  const h = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  const lists = { '/api/proposals': null, '/api/feed': 'events' };
  const out = {};
  for (const [p, key] of Object.entries(lists)) {
    const j = await (await fetch(p)).json();
    const l = Array.isArray(j) ? j : key ? j[key] : Object.values(j).find(Array.isArray);
    out[p] = `${l.length} items ${await h(l.map((x) => JSON.stringify(x)).sort().join('\n'))}`;
  }
  console.table(out);
})();
```

## Appendix B — what was tested, and where

| What | Result |
|---|---|
| Cleanup on a local copy of production's data (2026-09-25 dump, brought to production's 65-migration schema) | applies in 0.1 s; row counts unchanged in all 31 tables; a second run is a no-op; the four apply after it |
| The final check inside the migration | raises (undoing everything) when a `'floyd'` default or a hub-less search survives |
| Production's current code (`0b23e9a`) on the cleaned schema | API suite passes except the two tests that assert pre-cleanup behaviour |
| The CLI sequence, on the local stack from production's history | from `release-1-cleanup`: exactly `20260926005000` pending; then from `multi-tenant`: exactly the four |
| The release build, both modes (service role, hub tokens), cleaned schema | API 29 files / 292 tests; unit 98 / 1132; Playwright 25 / 25 |
| Parity outputs, `0b23e9a` vs the release build, same local data | process list, proposals, feed, search identical |
| The two 2026-09-27 migrations (jurisdictions; the audit log's FK) | applied on the local stack after the four with `supabase migration up`; the whole API layer in both modes and the unit layer pass on it. The six-count dry run was **not** re-rehearsed from production's history; the count follows from the file names |
