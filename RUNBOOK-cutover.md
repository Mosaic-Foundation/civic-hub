# RUNBOOK-cutover.md — Floyd from `main` to `multi-tenant`

Takes production (`floyd.civic.social`, Vercel project `civic-hub`,
Supabase project **Civic-Hub-Floyd** `nfhyypwoporfggqcerli`) from the
single-tenant `main` build to the `multi-tenant` build: Floyd becomes hub #1
on the shared schema, with minted hub tokens and forced row-level security.

Written and rehearsed end to end on dev (`civic-hub-dev`,
`urfmvqhzmamigssqwsya`) against a fresh copy of production's data on
2026-09-25. Rehearsal timings are next to each step, and the full rehearsal
record is at the end. **Adam runs every production step by hand.** No
session writes to production.

## How to read this

- One action per numbered step. **Who** does it is in bold at the start:
  **Adam** (by hand), or **script** (a command Adam runs, which does the work).
- Every command starts with `cd …`, so each block can be pasted on its own.
  Paste one block, press Enter, read the result, then go to the next.
- **Worked if** is what you should see. **If not** is what to do instead. When
  a step says *stop*, stop: production is still in a good state at every stop
  point, and the next session can pick it up from your notes.
- Keys and secrets move from **files**, never by hand-pasting into a terminal
  or a form that shows them. Nothing secret goes into a chat, a commit, a
  screenshot or a note.
- Keep a notes file open and write down the time and result of each step.
  It becomes the HANDOFF entry.

## At a glance

| When | What | Time (from rehearsal) |
|---|---|---|
| A day before | Preparation: values, digest recipients, keys, env vars, redeploy `main` on the new key (with a write test), snapshot, beta-tester notice | ~45 min, nothing visible to residents |
| The quiet window | Backup, migrations, Floyd's settings, deploy `multi-tenant`, pre-switch check, tokens on | ~25 min of steps, **budget 90 min** |
| Straight after | Verification walk | ~30 min |
| The watching week | Daily checks; day 3+ retire the legacy keys | 10 min a day |
| A week later | Cleanup migration and env tidy (the point of no return) | a session plus ~30 min |
| Any time in the week | Rollback, if needed | ~5 min |

---

## 1. Preparation — a day before

Nothing in this section changes what residents see: the `main` code ignores
every new variable, and the new secret key does the same job as the old one.

### 1a. Values only you know (Adam, 10 min)

`vercel env pull` cannot read back variables marked *Sensitive*; it writes
the literal text `[SENSITIVE]` instead. The settings seed refuses that text,
so it needs the real values from you. In the rehearsal the seed stored
"[SENSITIVE]" as Floyd's name before this guard existed. Write these down in
your password manager, not in a file in the repo:

| Variable | What it is | If you don't know it |
|---|---|---|
| `HUB_NAME` | Floyd's display name | `Floyd Civic Hub` (what the `hubs` row already says) |
| `HUB_POSTAL_ADDRESS` | Postal address in email footers | Leave empty; set it later in Admin → Settings → Email |
| `POLIS_BASE_URL` | The Polis server's URL | Leave empty; set it later in Admin → Settings → Plugins |
| `MEETING_SOURCE_URL` | Meeting-summary source page | Leave empty; Floyd's seed file supplies `https://www.floydcova.gov/agendas-minutes` |
| `DIGEST_ENABLED` | Whether the resident digest runs | `true`, if Floyd's digest goes out today |

"Leave empty" means passing `""` in step 2f; that key is then left unset.

### 1a½. Digest recipients: nobody loses the digest (Adam + script, 5 min)

**Why.** Under `main` the resident digest has no mail guard: every subscriber
gets it. Under `multi-tenant` the beta mail guard also covers scheduled jobs:
while Floyd is `beta`, mail goes only to the admin roster and the beta allow
list. On 2026-09-25, **3 of Floyd's 28 subscribers were on neither**, and
would have stopped getting the digest the morning after cutover. Adam's fix:
add them to the allow list. That also lets them sign in during the beta. It
has to happen **today**, while `main` can still save the list; after the
migrations, `main`'s settings saves fail.

1. **Adam.** Pull production's env (it holds secrets; it's deleted in §7):
   ```bash
   mkdir -p ~/civic-prod-link && cd ~/civic-prod-link && vercel link --project civic-hub --yes && vercel env pull ~/civic-keys/prod-pull.env --environment=production
   ```
2. **Adam.** Create `~/civic-keys/prod-db.env` (`chmod 600` it) with two lines:
   ```
   SUPABASE_URL=https://nfhyypwoporfggqcerli.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<production's secret key: the current one now; the civic-hub-server one after 1b>
   ```
3. **script.** Who would be withheld (read-only; `--show` prints the addresses in full):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-pull.env --env-file=$HOME/civic-keys/prod-db.env --import tsx scripts/check-digest-recipients.ts --hub floyd --pre-cutover --show
   ```
   Worked if: `would be WITHHELD by the beta mail guard: 0`.
   If it lists addresses (expected: 3): Floyd → Admin → Settings → Beta allow
   list → add each → save. Run step 3 again until it says 0.
   If it stops on `CIVIC_ADMIN_EMAILS holds "[SENSITIVE]"`: put
   `CIVIC_ADMIN_EMAILS="you@…"` (Floyd's admin addresses, comma-separated) in
   front of `node`.

### 1b. Keys (Adam, ~10 min)

1. **Adam.** Make a private folder for the keys:
   ```bash
   mkdir -p ~/civic-keys && chmod 700 ~/civic-keys
   ```
2. **script.** Generate production's ES256 signing key. The file is a private key; never `cat` it.
   ```bash
   cd ~/civic-keys && umask 077 && supabase gen signing-key --algorithm ES256 > prod-es256.json
   ```
   Worked if: `wc -c ~/civic-keys/prod-es256.json` prints a number near 290.
3. **Adam.** Copy it to the clipboard without showing it:
   ```bash
   pbcopy < ~/civic-keys/prod-es256.json
   ```
4. **Adam.** Import it as a **standby** key. Supabase → **Civic-Hub-Floyd** →
   Settings → **JWT Keys** → JWT Signing Keys → **Create Standby Key** →
   **Import an existing private key** → ⌘V → save.
   Worked if: an **ES256** key marked **Standby** is listed next to the current
   key. Do **not** rotate it to current. Do **not** touch the "Previous key".
   If not: repeat step 3; the pasted text must start with `{"kty":"EC"`.
5. **Adam.** Create the server's secret key: same project → Settings → **API
   Keys** → "Publishable and secret API keys" → Secret keys → **New secret
   key**, named `civic-hub-server`. Leave the page open.

### 1c. Production env vars (Adam, ~10 min)

1. **Adam.** The separate folder linked to the production Vercel project was
   made in 1a½.1 (it keeps `civic-hub/` linked to dev). Check:
   `cat ~/civic-prod-link/.vercel/project.json` names `civic-hub`.
2. **script.** Signing key, from the file:
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_SIGNING_KEY production --sensitive --force < ~/civic-keys/prod-es256.json
   ```
3. **Adam.** Server secret key: click the copy button next to `civic-hub-server`
   (step 1b.5), run this, and paste when it asks:
   ```bash
   cd ~/civic-prod-link && vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force
   ```
4. **Adam.** Publishable key: copy the `sb_publishable_…` key from the same page, then:
   ```bash
   cd ~/civic-prod-link && vercel env add SUPABASE_PUBLISHABLE_KEY production --force
   ```
5. **script.** Token switch, **off** for now:
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_MINTED_TOKEN production --no-sensitive --force --value false
   ```
6. **Adam.** Put the same secret key in `civic-hub/.env.prod` as
   `PROD_SUPABASE_SERVICE_ROLE_KEY` (it may already hold an `sb_secret_` key;
   the check scripts use this file). Put the same key in
   `~/civic-keys/prod-db.env` (made in 1a½.2) in place of the old one.
7. **Adam. Change no other variable.** Production's old variables
   (`HUB_NAME`, `CIVIC_SPACE_DID`, `MEETING_*`, `FLOYD_NEWS_*`,
   `CIVIC_BETA_MODE`, `CIVIC_ANON_SECRET` …) stay until the cleanup week.
   `main` needs them if you roll back, and it refuses to start without
   `CIVIC_SPACE_DID` (the rehearsal's first rollback crashed on exactly that).
   **Never change `CIVIC_ANON_SECRET`**: it keeps residents' public pseudonyms
   stable. Never set `CIVIC_DEV_HUB` on production.

### 1d. Redeploy `main` on the new key — this is the rollback target (Adam, 5 min)

1. **Adam.** Vercel → `civic-hub` → Deployments → the top **Production**
   deployment (commit `3283f48`, or whatever `main` is by then) → ⋯ →
   **Redeploy**. Env changes only take effect in a new deployment: always set
   the variable first, then redeploy, then check.
2. **Adam.** When it's Ready, open https://floyd.civic.social/api/health.
   Worked if: `"status":"ok"`, `"db":{"ok":true}`. (`main` shows no `hub_db` line; that's expected.)
   If `db` is not ok: the secret key was mis-copied. Redo 1c.3 and redeploy.
   Still failing: re-run 1c.3 with the old `eyJ…` service_role key (API Keys →
   "Legacy anon, service_role API keys") and redeploy. The site is back as it was; stop.
3. **Adam. A write, on the new key.** `/api/health` only reads, and this
   deployment stays the rollback target all week. Sign in as an admin on
   https://floyd.civic.social → Admin → Settings → save the support threshold
   unchanged. Worked if: "Saved".
4. **Adam. An upload, on the new key.** Start an announcement, attach any
   photo, and check the preview shows it; discard the draft.
   Worked if: the image appears. (Rehearsed from the session with `main`'s
   `supabase-js` and an `sb_secret_` key on dev: upload OK.)
   If either fails: same recovery as step 2 (old key back, redeploy), then stop.
5. **Adam.** Write down this deployment's URL (`civic-hub-….vercel.app`) in
   your notes as **ROLLBACK TARGET**.

### 1e. Take a snapshot to compare against (Adam, 2 min)

1. **Adam.** Open https://floyd.civic.social in a browser, open the developer
   console (⌥⌘J in Chrome), paste the **parity snippet** from the appendix, and
   press Enter. Copy the table it prints into your notes as **BEFORE**.

### 1f. Tell the beta testers (Adam)

Send the "before" message from section 4, with the window's date and time.
**Choose the window outside 11:30–13:30 UTC** (7:30–9:30 am Eastern), when
the meeting-summary, news, digest and admin-digest jobs run. Evening Eastern
is ideal.

---

## 2. The quiet window

Budget **90 minutes**; the steps took about 25 in rehearsal. There are go/no-go
points after 2c, 2e and 2h. Before each one, production is in a known-good
state.

### 2a. Fresh backup (Adam + script, ~2 min; rehearsal: dump 26 s)

1. **Adam.** Link a scratch folder (not `civic-hub/`) to production:
   ```bash
   mkdir -p ~/civic-cutover/dump && cd ~/civic-cutover && supabase init --workdir dump --yes && supabase link --project-ref nfhyypwoporfggqcerli --workdir dump
   ```
   If it asks for a database password, press Enter.
2. **script.** Dump schema, data and history (read-only):
   ```bash
   cd ~/civic-cutover && D=$PWD/dump && time (supabase db dump --linked --workdir $D -f $D/schema.sql && supabase db dump --linked --workdir $D --data-only -f $D/data.sql && supabase db dump --linked --workdir $D --data-only -s supabase_migrations -f $D/migrations.sql)
   ```
   Worked if: three "Dumped schema to …" lines; `ls -la ~/civic-cutover/dump/*.sql`
   shows `data.sql` of roughly 2.5 MB or more. Use absolute paths as written:
   the CLI resolves `-f` inside the workdir.
3. **Adam.** Remove the scratch link:
   ```bash
   cd ~/civic-cutover && supabase unlink --workdir dump
   ```
   Keep `~/civic-cutover/dump/` until the cleanup week. It holds residents'
   data: don't upload it anywhere.

### 2b. Point `civic-hub/` at production, for the migrations only (Adam, 1 min)

1. **Adam.**
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && supabase link --project-ref nfhyypwoporfggqcerli
   ```
   Worked if: `cat supabase/.temp/project-ref` prints `nfhyypwoporfggqcerli`.
   **2d relinks to dev. Do not end the session without doing 2d.**

### 2c. Migrations (script, ~1 min; rehearsal: repair 3 s, push 7.7 s)

0. **script.** Make sure your local `main` is exactly GitHub's `main`: step 2
   builds the list of 47 migrations from it.
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git fetch origin && git rev-parse main origin/main && git status -sb | head -1
   ```
   Worked if: the two long ids are **identical**. If not:
   `git checkout main && git pull --ff-only && git checkout multi-tenant`, then
   run it again. If `main` has moved past `3283f48`, stop and bring it to a
   session: the rehearsal compared production against `3283f48`'s 47 migrations.
1. **script.** See the migration history (read-only):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && supabase migration list
   ```
   Worked if (expected): the **Remote** column is **empty** for every row.
   Production's history was empty on 2026-09-25; its tables were made before
   the CLI tracked them.
   If Remote already lists versions: stop and bring the output to a session.
2. **script.** Record `main`'s 47 migrations as already applied. This writes
   history only, no schema. The rehearsal diffed production's schema against
   those 47 first; they match.
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git ls-tree --name-only main supabase/migrations/ | sed -E 's#.*/([0-9]+)_.*#\1#' | xargs supabase migration repair --status applied
   ```
   Worked if: `Repaired migration history: [20260416000000 … 20260907120000] => applied` (47 versions).
3. **script.** Dry run:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh --dry-run
   ```
   Worked if: it lists exactly **17** migrations, `20260922000000_grant_table_privileges.sql`
   through `20260925010000_tenancy_catalog.sql`.
   If it lists 64: step 2 did not take. Stop; do not push.
4. **script.** Push:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && time CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh
   ```
   Answer `y`. Worked if: 17 "Applying migration …" lines, then `Finished supabase db push.`
   If a migration fails: the CLI stops. Run `supabase migration list` to see
   which of the 17 are now recorded as applied, and copy both outputs. The
   migrations are additive, and `main` keeps working on the migrated schema,
   so the site stays up. Go to 2d, and stop.
5. **Adam.** Go/no-go: https://floyd.civic.social/api/health still shows
   `"status":"ok"`. This is still `main`, now on the migrated schema; the
   rehearsal proved `main` serves correctly there. Check `select mode from
   hubs where id = 'floyd'` in the SQL editor reads `beta`.

### 2d. Point `civic-hub/` back at dev (Adam, 30 s)

1. **Adam.**
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && supabase link --project-ref urfmvqhzmamigssqwsya
   ```
   Worked if: `cat supabase/.temp/project-ref` prints `urfmvqhzmamigssqwsya`.

### 2e. Floyd's settings (script, ~2 min; rehearsal: 1 s)

1. **Adam.** Pull production's env again, so it has yesterday's changes (it holds secrets; it's deleted in §7):
   ```bash
   cd ~/civic-prod-link && vercel env pull ~/civic-keys/prod-pull.env --environment=production
   ```
2. **script.** Dry run, with the values from 1a on the command line. They win
   over both files. Put your values between the quotes:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && HUB_NAME="Floyd Civic Hub" HUB_POSTAL_ADDRESS="" POLIS_BASE_URL="" MEETING_SOURCE_URL="" DIGEST_ENABLED="true" node --env-file=$HOME/civic-keys/prod-pull.env --env-file=$HOME/civic-keys/prod-db.env --import tsx scripts/seed-hub-settings.ts --hub floyd --dry-run
   ```
   Worked if: it prints `Hub: floyd (Floyd Civic Hub)`, `Mode: beta`, and
   about 30 settings, and **no value reads `[SENSITIVE]`**.
   If it stops naming variables that "hold Vercel's [SENSITIVE] placeholder":
   add each one it names to the front of the command, with a value or `""`.
3. **script.** The same command without `--dry-run`.
   Worked if: `Wrote 28 settings for "floyd".` (about 28–31).
4. **Adam.** Go/no-go: https://floyd.civic.social still looks the same. `main`
   does not read these rows; they are for the next step.
5. **script. Digest recipients, with the real guard.** Now that production has
   `hubs` and Floyd's settings, run the check in its normal mode (read-only):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/prod-pull.env --env-file=$HOME/civic-keys/prod-db.env --import tsx scripts/check-digest-recipients.ts --hub floyd
   ```
   Worked if: `mode: beta` and `would be WITHHELD by the beta mail guard: 0`.
   If anyone is withheld: someone subscribed since yesterday. Don't deploy yet.
   `main` can't save the allow list any more, so add them in the SQL editor:
   `update hub_settings set value = value || ',new@address' where hub_id = 'floyd' and key = 'beta_allowlist';`
   then run this again until it says 0. (Rehearsed on dev: 28 of 28 after the
   three were added.)

### 2f. Deploy `multi-tenant`, tokens still off (Adam, ~3 min; rehearsal build 40–45 s)

1. **Adam.**
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && git checkout main && git pull && git merge --ff-only multi-tenant && git push && git checkout multi-tenant
   ```
   Worked if: the merge says "Fast-forward" and the push succeeds.
   If `--ff-only` refuses: `main` has commits `multi-tenant` lacks. Stop
   (production is still `main` on the migrated schema, which is fine) and
   bring it to a session.
2. **Adam.** Vercel → `civic-hub` → Deployments: the new Production build
   appears within a minute. Wait for **Ready**.
3. **Adam.** https://floyd.civic.social/api/health.
   Worked if: `"status":"ok"`, `"hub_db":{"mode":"service_role","ok":true}`,
   and `"commit"` is the `multi-tenant` head.
   If it's a 500 or blank: Vercel → the deployment → Logs. For a missing
   variable, set it and redeploy. Otherwise do **Rollback** (section 6).
4. **Adam.** Open https://floyd.civic.social/api/hub-config.
   Worked if: `"id":"floyd"`, `"hostname":"floyd.civic.social"`,
   `"mode":"beta"`, and `identity.name` is Floyd's name.

### 2g. Pre-switch check (script, 10 s)

1. **script.** Holds every table to the rules CI uses. Read-only.
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env.prod --import tsx scripts/check-tenancy.ts --prod
   ```
   Worked if: the last line starts `CLEAN — 31 tables, 30 hub-scoped`.
   If it says `NOT READY` and lists tables: **do not turn tokens on.** The
   site is fine on the service role. Copy the lines into your notes and stop.
   If it says `tenancy_catalog() failed`: the migrations did not all apply; go back to 2c.

### 2h. Tokens on (Adam, ~2 min; rehearsal redeploy 42 s)

1. **script.**
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_MINTED_TOKEN production --no-sensitive --force --value true
   ```
2. **Adam.** Vercel → `civic-hub` → Deployments → the top Production
   deployment (the `multi-tenant` one from 2f) → ⋯ → **Redeploy**. Wait for Ready.
3. **Adam.** https://floyd.civic.social/api/health.
   Worked if: `"hub_db":{"mode":"hub_token","ok":true}` and `"status":"ok"`.
   If `"status":"degraded"`, `hub_db ok:false`: PostgREST is refusing the
   token, usually because the signing key on Vercel isn't exactly the file.
   Redo 1c.2, then redeploy. If that doesn't fix it within 10 minutes: set
   the switch back to `false` (step 1 with `--value false`), redeploy, and
   stop. Floyd runs on the service role, which is safe.

---

## 3. Verification — straight after (Adam, ~30 min)

**Parity first (2 min).** On https://floyd.civic.social, paste the parity
snippet (appendix) into the console again, and compare with **BEFORE**.
Worked if: every row matches. A row can differ only if someone acted on
Floyd during the window; the feed would then have one or two more events.
Anything else that differs: note it, then do the walk below. If pages are
wrong, **Rollback**.

**The walk.** These are the signed-in items the session could not do,
chosen from the beta smoke checklist. Use your phone for at least the first
three.

1. Home signed out: welcome dialog, beta banner, feed readable. Close the
   dialog; open Terms: Floyd's operator, no other place named.
2. Sign in as an admin (a real code arrives by email). Sign out, sign back in.
3. Open the tool-library proposal (`/proposal/proc_c34075135a2b451d`):
   endorse, then "Remove my support". Worked if: the count goes up and back.
4. Post a comment on a throwaway process, then delete or archive it.
5. Admin → Settings: open each section; save the support threshold
   unchanged. Worked if: "Saved".
6. Upload an image, the storage path on the hub token: start an
   announcement, attach any photo, and check the preview shows it. Discard the
   draft. (Or Admin → Settings → Identity → banner with a copy of the current
   banner, then save.) Worked if: the upload succeeds and the image shows.
7. Send feedback from the top bar ("Suggest a topic"). Worked if: it reaches you.
8. Admin → Reviews, Feedback, Waitlist all load.
9. Signed out again: residents show as "Resident N" and officials by name
   and title, as before.
10. `/api/health` one last time: `status ok`, `hub_token ok`.

If everything passes, send the "after" message (section 4). If something
fails and it isn't one of the six known Playwright gaps (tab order, the
not-found back links, the welcome-banner title wording, the suggest-a-vote
card), decide: fix forward in a session, or **Rollback**.

---

## 4. The beta-tester messages (Adam)

**Before (the day before):**

> Hi all — a quick heads-up. On [DAY] between [TIME] and [TIME] Eastern
> we're moving the Floyd Civic Hub onto new infrastructure that will let
> other towns run their own hubs. You shouldn't notice anything, but the
> site may be slow or show an error for a minute or two in that window.
> Nothing you've posted, voted or supported will change. If something looks
> off afterwards, the Feedback button at the top of every page comes
> straight to me. Thanks for helping test.

**After (once verification passes):**

> The Floyd Civic Hub move is done. Everything should look and work exactly
> as before. If anything seems different or broken, please use the Feedback
> button and tell me what you were doing. Thank you!

**Back to normal (only if you rolled back and people noticed):**

> We've switched the Floyd Civic Hub back to its previous setup while we
> look into something. Everything you've posted is still there. Thanks for
> your patience.

---

## 5. The watching week

Once a day, about 10 minutes (Adam):

- [ ] https://floyd.civic.social/api/health → `status ok`, `hub_token ok`.
- [ ] Vercel → `civic-hub` → Logs, last 24 h, filter **Error**. Look for
      `42501`, `PGRST`, `row-level security`, `hub_db`, `Storage upload
      failed`. Any of these is a table or path the tokens don't cover yet.
      Copy the line and bring it to a session. Tokens can go off by setting
      `CIVIC_HUB_MINTED_TOKEN=false` and redeploying, without a rollback.
- [ ] Day 1: the resident digest arrived at the usual time (13:00 UTC,
      9 am Eastern). `identity.timezone` is unset, so it's the same hour as before.
- [ ] Day 1: the admin digest (13:30 UTC), meeting summaries (11:30 UTC) and
      news sync (12:00 UTC) ran. Admin panel → meeting summaries / feed.
      The news job has a new path (`/api/internal/news-sync/run`, was
      `floyd-news-sync`); Vercel → Settings → Cron Jobs should list it.
- [ ] Feedback inbox: anything from testers that sounds like "broken" or "different".
- [ ] Any day this week: **restore the missing `vote_drafts` trigger**. It
      isn't in the cutover set on purpose; the window pushes exactly the 17
      rehearsed migrations. The fix waits in
      `supabase/after-cutover/20260926000000_vote_drafts_updated_at_trigger.sql`
      (idempotent; a no-op wherever the trigger already exists).
  1. **A session** moves it into `supabase/migrations/`, commits, and Adam
     pushes. Until then, production's history says `20260524000000` is applied
     although its trigger is missing (it was one of the 47 marked applied).
  2. **Adam.** As 2b–2d: link `civic-hub/` to production,
     `CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh --dry-run`
     (worked if: exactly **1** migration, this one), then without `--dry-run`,
     then relink to dev.
  3. **Adam.** SQL editor: `select tgname from pg_trigger where tgrelid = 'public.vote_drafts'::regclass and not tgisinternal;`
     Worked if: `set_vote_drafts_updated_at`. (Rehearsed on a local copy of
     production: created once, no-op on a second run, and `updated_at` then updates.)
- [ ] Day 3 or later, if every check so far is clean: **retire the legacy keys**:
  1. **Adam.** Supabase → Civic-Hub-Floyd → Settings → API Keys → "Legacy
     anon, service_role API keys" → **Disable JWT-based API keys**.
  2. **Adam.** `/api/health`: `status ok`, `db ok`, `hub_token ok`. If `db`
     fails, something still uses a legacy key: re-enable them on the same tab
     (reversible) and stop.
  3. **Adam.** Settings → JWT Keys → the **Legacy HS256** "Previous key" →
     **Revoke**. Permanent. Supabase won't allow it until step 1 is done.
  4. **Adam.** `/api/health` again, same result.
  5. **Adam.** Save `~/civic-keys/prod-es256.json` in your password manager.

Rollback stays available all week (section 6); it becomes impossible only
after the cleanup below.

---

## 6. Rollback (back to `main`) — any time in the watching week

**It does not undo the migrations.** Nothing is dropped: the `hubs` table,
the `hub_id` columns, the policies and Floyd's settings rows all stay, and
`main` ignores them. Every `hub_id` defaults to `'floyd'`, the service role
bypasses the policies, and `main` never reads `hubs`. Rows written during
the week stay and remain visible to `main`.

1. **Adam.** Vercel → `civic-hub` → Deployments → the **ROLLBACK TARGET**
   from 1d.5 → ⋯ → **Instant Rollback** → Continue → **Confirm Rollback**.
   Seconds; no build. **From now on Vercel does not put new production builds
   live automatically:** a push or a Redeploy builds but does not take
   `floyd.civic.social` until you **Undo Rollback** (below). The overview page
   shows an "Undo Rollback" button while this is in force.
   Use that one, not an older `main` deployment: older ones carry the legacy
   `eyJ…` key, which stops working once the legacy keys are disabled.
2. **Adam.** Supabase → Civic-Hub-Floyd → **SQL Editor** → New query → Run:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS hub_settings_key_rollback ON hub_settings (key);
   ```
   Worked if: "Success. No rows returned". Why: `main` saves settings as
   "upsert on `key`", and the migration made the key `(hub_id, key)`. Without
   this line, every admin settings save fails (`42P10`); everything else works.
   It is valid only while Floyd is the only hub. If it fails with "duplicate
   key", a second hub exists: stop and bring it to a session.
3. **script.** Token switch off, so a later roll-forward starts safely:
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_MINTED_TOKEN production --no-sensitive --force --value false
   ```
4. **Adam.** Check: `/api/health` → `status ok`, `db ok`, `commit` is the
   ROLLBACK TARGET's commit (`main`), and no `hub_db` line. Home page, one vote, one proposal. Admin →
   Settings → save the support threshold unchanged: it saves.
5. **Adam.** Send "Back to normal" only if testers noticed anything.

**Rolling forward again:**
1. **Adam.** SQL Editor: `DROP INDEX IF EXISTS hub_settings_key_rollback;`
   It must go before any second hub is created.
2. **Adam.** Vercel → the last `multi-tenant` deployment → ⋯ → **Redeploy**
   (not Promote: a redeploy picks up the switch as `false`). Wait for Ready.
   **It is not live yet**: automatic promotion is still off from the rollback.
3. **Adam.** Project overview → **Undo Rollback** → choose the deployment from
   step 2 → Confirm. This puts it live and turns automatic promotion back on.
4. **Adam.** `/api/health` → `hub_db: { mode: "service_role", ok: true }` and
   the `multi-tenant` commit. If it still shows `main`'s commit, step 3 picked
   the wrong deployment. Then 2g and 2h again.

---

## 7. Cleanup — a week later (a session writes it; Adam reviews and runs it)

**This is the point of no return.** After it, `main` no longer works against
the database, so rollback is gone. Do it only after a clean week.

**The cleanup migration** (a new file, written in a later session, because
it drops things and the build rules allow additive changes only; Adam
approves the drops). From the migrations' own notes and the build plan:
- Drop the `DEFAULT 'floyd'` on every `hub_id` column (`20260922020000`,
  `20260924010000`: "a migration device"), so a writer that forgets its hub
  fails instead of landing in Floyd.
- Drop the old global keys kept beside the per-hub ones (`20260924020000`):
  `users_email_key`, `pending_verifications_pkey` (email), `waitlist_pkey`
  (email), `link_previews_pkey` (url); the per-hub constraints become the
  keys. Until then one email is one account on one hub, across all hubs.
- Drop the old single-column foreign keys kept beside the composite ones
  (`20260924060000`).
- Drop the deprecated search-function wrappers (`20260924050000`).
- `DROP INDEX IF EXISTS hub_settings_key_rollback;`, in case a rollback left it.

**Run it** like 2b–2d: link `civic-hub/` to production, `db-push.sh` with
`CONFIRM_PRODUCTION_PUSH`, relink to dev, then 2g's check, then
`/api/health`.

**Env tidy, in the same sitting** (Adam, in `civic-hub` → Settings →
Environment Variables):
- Remove `MEETING_*` and `FLOYD_NEWS_*`. Their values are Floyd's `plugin.*`
  rows now. Left in place, a second hub would inherit Floyd's meeting and news
  sources. Adam decided 2026-09-25 to remove them here, not in the window, so
  rollback keeps working all week.
- Remove the other variables the settings replaced (`HUB_NAME`, `VITE_HUB_*`,
  `CIVIC_JURISDICTION*`, `CIVIC_BETA_MODE`, `VITE_BETA_MODE`,
  `BOARD_RECIPIENT_EMAIL` …). A session lists them from `src/models/hubSettings.ts`'s
  env-fallback table first. **Keep** `CIVIC_ANON_SECRET`, `CIVIC_ALLOWED_ORIGINS`,
  `CRON_SECRET`, `DIGEST_UNSUBSCRIBE_SECRET`, `RESEND_*`, the Supabase keys
  and anything the session's list doesn't name.
- Redeploy and check `/api/health`.

**Code tidy** (a session): delete the seven "until the cutover" entries in
`scripts/place-name-allowlist.txt` with the env fallbacks they excuse, and
the alias map entries in `src/models/hubSettings.ts` (the reader still
answers the old `hub_settings` keys; no copy script is needed before that).

**Then** delete `~/civic-cutover/`, `~/civic-keys/prod-pull.env` and
`~/civic-keys/prod-db.env`, and `~/civic-prod-link` if you won't need it.

---

## 8. Wildcard domain `*.civic.social` (not needed for Floyd's cutover)

**When.** Floyd's cutover doesn't need this: `floyd.civic.social` keeps its
own record, pointing at `civic-hub`. Do it when the second real hub is about
to go live (Phase 5), after the cleanup.

**The method.** Phase 0 chose a wildcard `CNAME` at GoDaddy, the DNS host
for `civic.social` (nameservers `ns07/ns08.domaincontrol.com`), pointing at
Vercel, on the Pro plan. Vercel's documentation (checked 2026-09-25) adds a
requirement Phase 0 didn't record: with outside DNS, Vercel can issue the
wildcard certificate only if `_acme-challenge.civic.social` is delegated to
Vercel with two `NS` records. The nameservers stay at GoDaddy.

**What it can't break** (checked with `dig`, 2026-09-25):
- Every existing name keeps its own record, and a wildcard never overrides a
  name that has one: the apex and `www` (Firebase), `floyd`,
  `representative`, `citizendashboard`, `demo-hub` (Vercel).
- There is no `_acme-challenge.civic.social` record today, so nothing
  (Firebase included) renews a certificate through it. If a future service
  asks for an `_acme-challenge` TXT on `civic.social`, it will conflict:
  tell the session setting it up.
- A name given any record of its own later (for example `mail` for the
  platform sending domain) stops matching the wildcard. That's intended, and
  it's why hub slugs can never be names already in use; `mail`, `www` and
  `app` are reserved.

1. **Adam.** Vercel → project **`civic-hub`** (not `civic-hub-dev`) →
   Settings → Domains → **Add Domain** → `*.civic.social` → Add.
   Worked if: listed with "Invalid Configuration" and instructions. Write
   down the **CNAME value** it shows; the docs say `cname.vercel-dns-0.com`,
   but use exactly what your screen says.
2. **Adam.** Vercel → team → **Domains** → `civic.social` → DNS Records →
   **Enable Vercel DNS**. Do **not** change the nameservers at GoDaddy.
3. **Adam.** GoDaddy → `civic.social` → DNS → **Add New Record**, twice:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | NS | `_acme-challenge` | `ns1.vercel-dns.com` | 1 hour |
   | NS | `_acme-challenge` | `ns2.vercel-dns.com` | 1 hour |

4. **Adam.** GoDaddy → Add New Record:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `*` | the value from step 1 | 1 hour |

   Don't edit or delete any existing record.
5. **script.** After 10–60 minutes:
   ```bash
   dig +short athens-check.civic.social
   ```
   Worked if: it prints Vercel names and addresses. And
   `dig +short _acme-challenge.civic.social NS` prints the two `vercel-dns.com` names.
6. **Adam.** Vercel → Domains shows `*.civic.social` **Valid Configuration**
   with a certificate. `https://anything-at-all.civic.social` opens with no
   certificate warning and says **No hub here**.
7. **Adam.** https://civic.social, https://floyd.civic.social,
   https://representative.civic.social and https://citizendashboard.civic.social
   each look exactly as before.

**Undo:** delete the `*` CNAME at GoDaddy. No existing site uses it. After
it works, a new hub's hostname is just its `hubs` row.

---

## Appendix A — parity snippet

Paste into the browser console on https://floyd.civic.social. It reads
public pages only and prints a table of counts and fingerprints. Lists are
compared order-free.

```js
(async () => {
  const h = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  const lists = { '/api/process': 'processes', '/api/proposals': null, '/api/feed': 'events', '/api/search?q=floyd': null };
  const pages = ['/api/process/proc_c34075135a2b451d/state', '/api/process/proc_beta_vote_energy_001/state', '/api/process/proc_861a092e431845a3/state', '/api/process/proc_58293e6945e44a98/state'];
  const out = {};
  for (const [p, key] of Object.entries(lists)) {
    const j = await (await fetch(p)).json();
    const l = Array.isArray(j) ? j : key ? j[key] : Object.values(j).find(Array.isArray);
    out[p] = `${l.length} items ${await h(l.map((x) => JSON.stringify(x)).sort().join('\n'))}`;
  }
  for (const p of pages) { const r = await fetch(p); out[p] = `${r.status} ${await h(await r.text())}`; }
  console.table(out);
})();
```

## Appendix B — scripts this runbook uses

| Script | What it does |
|---|---|
| `scripts/db-push.sh` | `supabase db push`, refusing production unless `CONFIRM_PRODUCTION_PUSH=<prod ref>` |
| `scripts/seed-hub-settings.ts --hub floyd` | writes Floyd's `hub_settings` rows from the environment and `config/hubs/floyd/`; refuses `[SENSITIVE]` |
| `scripts/check-tenancy.ts [--prod]` | the pre-switch check; `npm run check:tenancy` |
| `scripts/dev-refresh-from-dump.sh <dir>` | dev only: replace dev's schema, data and history with a production dump |
| `scripts/dev-refresh-reseed.ts` | dev only: after a refresh, put dev's hostnames, Athens and Utopia back |

---

## Rehearsal record (dev, 2026-09-25)

| Step | What happened | Time |
|---|---|---|
| Backup of production | `supabase db dump` ×4 through a scratch link | 26 s |
| Refresh dev | `dev-refresh-from-dump.sh`: dev = production's 195 processes, 695 events, 33 users | 5 s |
| History | Production's history empty; `main`'s 47 repaired as applied → 17 pending | 3 s |
| Schema check | `main`'s 47 built locally and diffed against production | match, except the drift below |
| Push | 17 migrations, no warnings | 7.7 s |
| Dev re-seed | Floyd hostname, Athens, Utopia, saved admin edits | 3 s |
| Floyd settings | From production's env, after fixing the `[SENSITIVE]` guard | 1 s |
| Catalog | `check-tenancy.ts` on dev | CLEAN |
| Signing key | ES256 standby; set from file; redeploy | 42 s build |
| Secret key | `sb_secret_` on Vercel and `.env`; redeploy | 45 s build |
| Retire legacy | Disable legacy API keys; revoke legacy secret | ~1 min; HS256 now 401 |
| Storage | Hosted Storage with ES256: `floyd/` and root refused, `athens/` accepted; Floyd's 7 images load | — |
| Rollback | `main` (`3283f48`) on the migrated DB: serves Floyd; settings upsert needs the index | build 40 s |
| Roll forward | Promote `multi-tenant` back | seconds |
| Smoke | Signed-out parity with production; Athens and Utopia identity; Playwright 17 passed / 6 known | 92 s (Playwright) |

**Digest recipients** (added after the management review): production today,
`--pre-cutover`: 28 subscribers, 3 on neither list. Dev's migrated copy with
the real guard gave the same 28/25/3. After adding the three to dev's allow
list: 28 of 28.

**Production drift found** (main's 47 migrations vs production's schema; none
affects the 17): production lacks the `set_vote_drafts_updated_at` trigger
(so `vote_drafts.updated_at` never updates; fixed in the watching week from
`supabase/after-cutover/`), and one column comment; it has
two functions no migration made (`set_comment_phase`, unused by the code,
and Supabase's `rls_auto_enable`); one column is in a different order.

**What went wrong in rehearsal, and is designed out above:**
- The settings seed stored `[SENSITIVE]` from a pulled env file. It now refuses (1a, 2e).
- A hand-pasted signing key, and a redeploy started before the value was
  saved, left dev `degraded` for ten minutes. Now: from file; variable, then
  redeploy, then check (1c, 2h).
- Supabase wouldn't revoke the legacy secret while legacy API keys were
  enabled, and dev's server used one. The server moves to `sb_secret_` first (1b–1d).
- `main` would not boot without `CIVIC_SPACE_DID`. Old env vars stay until cleanup (1c.7).
- `main`'s settings upsert fails on the migrated key. Rollback step 2.
- A first dump failed because `-f` paths are resolved inside `--workdir`.
  The commands above use absolute paths.
