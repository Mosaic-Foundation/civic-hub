# RUNBOOK-cutover.md — Floyd from `main` to `multi-tenant`

_Being written in Phase 4 part one (2026-09-25). Sections are added as each
step is rehearsed on dev; the finished runbook is step 9._

---

## Signing key (ES256) and the new secret key

**What this does.** Moves production's hub tokens onto an ES256 signing key
and the server onto an `sb_secret_…` key, then retires the legacy JWT secret.
Rehearsed on dev 2026-09-25.

**Why the secret key moves too.** Supabase refuses to revoke the legacy JWT
secret until the project's legacy API keys (the `eyJ…` anon and service_role
keys) are disabled, because they are signed with it. Any server still using an
`eyJ…` service_role key stops working the moment they are disabled. So the
server has to be on an `sb_secret_…` key first. Dev was on an `eyJ…` key and
production's Vercel value cannot be read back, so assume production is too
and replace it regardless.

**Where it sits in the cutover.** Part A the day before (nothing changes for
residents: the `main` code ignores the signing key, and the new secret key
does the same job as the old one). Part B during the watching week, once
tokens have been on for a few days without trouble. Revoking is the last step
because it cannot be undone.

**Rules for the key material.** Keys are moved from files, never pasted by
hand into a terminal or a form field that shows them. On dev a hand-pasted
key left all three hosts `degraded` for ten minutes. Nothing here goes in a
commit, a chat, a screenshot or a log. Keep the private JWK in your password
manager; delete the file at the end.

### Part A — the day before (Adam, about 10 minutes)

Every command starts with `cd`, so each line can be pasted on its own.

1. **Make a private folder for the key.**
   ```bash
   mkdir -p ~/civic-keys && chmod 700 ~/civic-keys
   ```
2. **Generate the production key.** The file holds a private key.
   ```bash
   cd ~/civic-keys && umask 077 && supabase gen signing-key --algorithm ES256 > prod-es256.json
   ```
   Worked if: `wc -c ~/civic-keys/prod-es256.json` prints a number near 290. Do not `cat` it.
3. **Copy it to the clipboard without showing it.**
   ```bash
   pbcopy < ~/civic-keys/prod-es256.json
   ```
4. **Import it as a standby key on production.** Dashboard →
   **Civic-Hub-Floyd** (`nfhyypwoporfggqcerli`) → Settings → **JWT Keys** →
   JWT Signing Keys → **Create Standby Key** → **Import an existing private
   key** → ⌘V → save.
   Worked if: the list shows an **ES256** key marked **Standby** next to the
   current key. Do NOT rotate it to current, and do not touch "Previous key".
   If it refuses the paste: repeat step 3 and paste again; the text must start
   with `{"kty":"EC"`.
5. **Create a secret key for the server.** Same project → Settings → **API
   Keys** → "Publishable and secret API keys" tab → Secret keys → **New secret
   key**, name it `civic-hub-server`. Leave the page open; you copy it in step 8.
6. **Link a separate folder to the production Vercel project.** This keeps
   `civic-hub/` linked to dev.
   ```bash
   mkdir -p ~/civic-prod-link && cd ~/civic-prod-link && vercel link --project civic-hub --yes
   ```
   Worked if: it says `Linked to creatinglakes-projects/civic-hub`.
7. **Set the signing key on production, from the file.**
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_SIGNING_KEY production --sensitive --force < ~/civic-keys/prod-es256.json
   ```
8. **Set the server's secret key.** Copy `civic-hub-server` from the page in
   step 5 (the copy button), then run this and paste when it asks:
   ```bash
   cd ~/civic-prod-link && vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --force
   ```
9. **Set the publishable key and the token switch (off).** Copy the
   `sb_publishable_…` key from the same API Keys page, then:
   ```bash
   cd ~/civic-prod-link && vercel env add SUPABASE_PUBLISHABLE_KEY production --force
   ```
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_MINTED_TOKEN production --no-sensitive --force --value false
   ```
10. **Redeploy `main` so it picks up the new secret key.** Vercel →
    `civic-hub` → Deployments → the top **Production** deployment → ⋯ →
    **Redeploy**. Env changes only take effect in a new deployment. Always set
    the variable first, then redeploy, then check.
11. **Check.** When the deployment is Ready, open
    https://floyd.civic.social/api/health.
    Worked if: `"status":"ok"` and `"db":{"ok":true}`. `main` has no `hub_db`
    line; that is expected.
    If `db` is not ok: the secret key was mis-copied. Repeat step 8 and 10. If
    you cannot fix it quickly, run step 8 with the old `eyJ…` service_role
    key from the "Legacy anon, service_role API keys" tab and redeploy; the
    site is back as it was.

### Part B — the watching week, after tokens have run cleanly for 3+ days (Adam, 5 minutes)

1. Production → Settings → **API Keys** → "Legacy anon, service_role API
   keys" tab → **Disable JWT-based API keys**.
2. Check https://floyd.civic.social/api/health: `status ok`, `db ok`,
   `hub_db: { mode: "hub_token", ok: true }`.
   If `db` fails: something still uses a legacy key. Re-enable the legacy keys
   on the same tab (this is reversible) and stop; tell the next session.
3. Settings → **JWT Keys** → the **Legacy HS256** "Previous key" → **Revoke**.
   This one is permanent.
4. Check `/api/health` again, same result as step 2.
5. Put `~/civic-keys/prod-es256.json` in your password manager, then delete
   the file and `~/civic-prod-link`.

### Rehearsal on dev (2026-09-25)

| Step | Time |
|---|---|
| Generate key | 1 s |
| Import as standby (dashboard) | ~2 min |
| Set `CIVIC_HUB_SIGNING_KEY` from the file + redeploy | 42 s build |
| New `sb_secret_` server key on Vercel + `.env` + redeploy | 45 s build |
| Disable legacy API keys + revoke legacy secret (dashboard) | ~1 min |

Checked after the last step: `/api/health` `ok` with `hub_token, ok` on all
three dev hosts; scripts on the `sb_secret_` key (catalog clean); an ES256 hub
token straight at PostgREST → 200; any HS256 token → 401 `PGRST301 No suitable
key was found`. Floyd's `/process` unchanged (106).

What went wrong once: the key was pasted into Vercel's form by hand and the
first redeploy ran before the value was saved; every host was `degraded`
(`hub_db ok: false`) until the value was set from the file and redeployed
again. Both lessons are in Part A: file, not paste; variable, then redeploy,
then check.

---

## Pre-switch check (right before tokens go on)

**What this does.** Reads `tenancy_catalog()` on production as the service
role and holds every table to the rules the CI catalog test uses. It writes
nothing. If it names a table, turning tokens on would either leak that
table across hubs or break it outright, so tokens stay off.

1. **Run it** (Adam):
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env.prod --import tsx scripts/check-tenancy.ts --prod
   ```
   `.env.prod` must hold `PROD_SUPABASE_URL` and a working
   `PROD_SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…` one).
2. **Worked if** the last line starts with `CLEAN — 31 tables, 30
   hub-scoped`. Only then go on to turn tokens on.
3. **If it says `NOT READY`**, it lists one line per problem, e.g.
   `waitlist: row-level security is not FORCEd`. Do not turn tokens on. The
   site keeps working on the service role; stop here, copy the lines, and
   bring them to the next session. (If it says `tenancy_catalog() failed`,
   the migrations have not been applied — go back to the migration step.)

Rehearsed 2026-09-25: CLEAN on dev after the migrations; against production
before the cutover it says `tenancy_catalog() failed` (the function is one of
the 17 migrations), which is correct. Local mutation: with `waitlist` un-FORCEd
it printed `NOT READY — 1 problem(s)` naming it and exited 1.

---

## Wildcard domain `*.civic.social` (not needed for Floyd's cutover)

**When.** Floyd's cutover does not need this: `floyd.civic.social` already
points at the `civic-hub` Vercel project and keeps its own record. Do it
when the second real hub is about to go live (Phase 5), or any time after
the watching week.

**The method.** Phase 0 chose a wildcard `CNAME` at GoDaddy (the DNS host
for `civic.social`; nameservers `ns07/ns08.domaincontrol.com`) pointing at
Vercel, on the Pro plan. Vercel's documentation (checked 2026-09-25) adds one
requirement Phase 0 did not record: with outside DNS, Vercel can only issue
the wildcard certificate if `_acme-challenge.civic.social` is delegated to
Vercel with two `NS` records. The nameservers stay at GoDaddy.

**What it cannot break** (checked 2026-09-25 with `dig`):
- Every existing name keeps its own record, and a wildcard never overrides
  a name that has one: the apex and `www` (Firebase), `floyd`,
  `representative`, `citizendashboard`, `demo-hub` (Vercel).
- There is no `_acme-challenge.civic.social` record today, so nothing else
  (Firebase included) renews a certificate through it; delegating it takes
  nothing away. If a future service ever asks for an `_acme-challenge` TXT
  record on `civic.social`, it will conflict with this delegation — tell
  the session setting it up.
- Later, a name given ANY record of its own (for example `mail` when the
  platform sending domain is verified) stops matching the wildcard. That is
  what you want for mail; it is also why a hub's slug must never be a name
  already in use (the reserved-slug list covers `mail`, `www`, `app` and
  the others).

### Steps (Adam, about 15 minutes plus DNS propagation)

1. **Add the domain in Vercel.** Vercel → project **`civic-hub`** (the one
   serving `floyd.civic.social`, not `civic-hub-dev`) → Settings → Domains
   → **Add Domain** → type `*.civic.social` → Add.
   Worked if: it appears in the list as "Invalid Configuration" with
   instructions. Write down the **CNAME value** it shows (the docs give
   `cname.vercel-dns-0.com`; use exactly what your screen says).
2. **Turn on Vercel DNS for challenges only.** Vercel → team
   `creatinglakes-projects` → **Domains** → `civic.social` → DNS Records →
   **Enable Vercel DNS**. Do NOT change the nameservers at GoDaddy.
3. **Add the two NS records at GoDaddy.** GoDaddy → My Products →
   `civic.social` → DNS → **Add New Record**, twice:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | NS | `_acme-challenge` | `ns1.vercel-dns.com` | 1 hour |
   | NS | `_acme-challenge` | `ns2.vercel-dns.com` | 1 hour |

4. **Add the wildcard CNAME at GoDaddy.**

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `*` | the value from step 1 | 1 hour |

   Do not edit or delete any existing record.
5. **Wait, then check** (10–60 minutes):
   ```bash
   dig +short athens-check.civic.social
   ```
   Worked if: it prints Vercel addresses (the CNAME value, then IPs). And:
   ```bash
   dig +short _acme-challenge.civic.social NS
   ```
   prints the two `vercel-dns.com` names.
6. **Check the certificate.** Vercel → `civic-hub` → Settings → Domains:
   `*.civic.social` shows **Valid Configuration** with a certificate.
   Open `https://anything-at-all.civic.social` in a browser.
   Worked if: no certificate warning, and the page says **No hub here** (the
   resolver's answer for a hostname with no `hubs` row).
7. **Check nothing else moved:** https://civic.social (marketing site),
   https://floyd.civic.social, https://representative.civic.social,
   https://citizendashboard.civic.social each look exactly as before.

**If it goes wrong.** Delete the `*` CNAME at GoDaddy; every existing site
is unaffected either way, because none of them uses the wildcard. The NS
records can stay; they only answer certificate challenges.

**After it works**, a new hub's hostname is just its `hubs` row
(`<slug>.civic.social`): no DNS or Vercel change per hub.

---

## Rollback (back to `main`)

**When.** Any time in the watching week, if Floyd misbehaves in a way a
quick fix can't cover. Deciding is yours; the steps are two clicks, one
line of SQL and a check.

**What it does and does not do.** It points `floyd.civic.social` back at the
`main` build. Nothing is dropped: the `hubs` table, the `hub_id` columns, the
policies and Floyd's settings rows all stay. `main` ignores them: every
`hub_id` defaults to `'floyd'`, the service role bypasses the policies, and
`main` never reads `hubs`. Rows written during the week stay and remain
visible to `main`.

**The rollback target** is the `main` deployment made in "Signing key", Part
A step 10: the day before, on the new `sb_secret_` key. Not an older one:
an older `main` deployment still carries the legacy `eyJ…` key, which stops
working once Part B disables the legacy keys.

**Keep production's old env vars until the cleanup week.** `main` refuses
to start without `CIVIC_SPACE_DID` and `CIVIC_ALLOWED_ORIGINS`, and reads
Floyd's identity from `HUB_NAME`, `CIVIC_JURISDICTION` and the rest. The
rehearsal's first `main` deploy on dev crashed at boot for exactly this
reason (dev had no `CIVIC_SPACE_DID`). Do not delete any variable from the
`civic-hub` project until "Cleanup, a week later".

### Steps (Adam)

1. **Promote the `main` build.** Vercel → `civic-hub` → Deployments → find the
   deployment from the day before (commit `3283f48`, "Brief: prominent response
   button…", created in Part A step 10) → ⋯ → **Promote** (or **Instant
   Rollback**). It reuses the build, so it takes seconds.
2. **Re-add the one constraint `main` needs.** Supabase → Civic-Hub-Floyd →
   **SQL Editor** → New query → paste → Run:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS hub_settings_key_rollback ON hub_settings (key);
   ```
   Worked if: "Success. No rows returned". Why: the migration made
   `hub_settings`' key `(hub_id, key)`, and `main` saves settings with "upsert
   on `key`", which Postgres refuses without a unique index on `key` alone
   (error `42P10`). Without this line everything works except saving
   settings in the admin panel. It is only valid while Floyd is the only
   hub, which is true throughout the watching week. If it fails with "could
   not create unique index … duplicate key", a second hub has been added;
   stop and bring it to a session.
3. **Turn the token switch off**, so a later roll-forward starts on the
   service role:
   ```bash
   cd ~/civic-prod-link && vercel env add CIVIC_HUB_MINTED_TOKEN production --no-sensitive --force --value false
   ```
   (No effect on `main`, which does not read it.)
4. **Check.** https://floyd.civic.social/api/health →
   `"status":"ok"`, `"db":{"ok":true}`, `"commit":"3283f48…"`, and no
   `hub_db` line (that is `main`). Open the home page, one vote, one
   proposal. Sign in as an admin, open Settings, and save the support
   threshold unchanged. Worked if: it saves.
5. **Tell the beta testers** only if they noticed anything (use the
   beta-tester message's "back to normal" line).

### Rolling forward again

1. Supabase SQL Editor:
   ```sql
   DROP INDEX IF EXISTS hub_settings_key_rollback;
   ```
   This must happen before a second hub is created (it would block that
   hub's settings).
2. Vercel → `civic-hub` → Deployments → the last `multi-tenant` deployment
   → ⋯ → **Redeploy** (not Promote: its build has the token switch baked in,
   and step 3 above set it to `false`; a redeploy picks up `false`).
3. Check `/api/health`: `hub_db: { mode: "service_role", ok: true }`. Then
   go through "Pre-switch check" and turn tokens on as in the quiet window.

### Rehearsal on dev (2026-09-25)

- `main` (`3283f48`, production's exact commit) deployed to `civic-hub-dev`
  against the migrated dev database holding production's data: build 40 s.
  First boot crashed on a missing `CIVIC_SPACE_DID` (dev-only; production has
  it); with it set, redeploy 40 s.
- On `main`: `/api/health` ok (schema check 27 tables, no gaps); Floyd
  `/process` 106 processes (production: 106); process detail and state,
  feed, proposals, events (505 items), home page all 200. Main's waitlist
  write (upsert on `email`, no `hub_id`) succeeded and landed as `floyd`.
  `main`'s settings upsert failed with `42P10` — the reason for step 2.
- Step 2 could not run on dev (three hubs share setting keys there), so it
  was rehearsed on a local copy: production's schema and data, the 17
  migrations, then the index. The upsert failed before, succeeded after;
  `DROP INDEX` cleanly undid it.
- Back to `multi-tenant` by Promote: seconds, no build. All three hosts
  `ok` with `hub_token, ok`; Floyd 106 processes.
- `main`'s mail and crons during the test: its crons run 11:30–13:30 UTC
  and the test ran at 22:40 UTC; nobody signed in. On production the same
  applies: the rollback does not trigger mail by itself.

---

## Rehearsal: smoke test on dev (2026-09-25)

Dev holding production's data, `multi-tenant`, tokens on (ES256), all three
hosts.

**Signed out, by the session.**
- Floyd (`civic-hub-dev.vercel.app`): home with welcome dialog, banner and
  beta card; Projects, Outcomes; the tool-library proposal, the energy vote,
  the trails vote, the skate-park project, "Where We Agree", the farm-stand
  brief — all render with production's content.
- **Parity with production**, API reads hashed on both sides with hostnames
  normalised: process pages, proposals, 404s byte-identical; process list
  and search the same items; the feed identical except `anon-…` pseudonyms
  (per-deployment `CIVIC_ANON_SECRET`; production keeps its own, so its
  pseudonyms do not change at cutover — **never change `CIVIC_ANON_SECRET`**).
- Athens: own name, banner, demo welcome, its own code of conduct; terms name
  Athens and never Floyd. Utopia: own purple theme and logo; terms name only
  Utopia; `/admin/reviews` signed out → the sign-in prompt, not a blank page.
- No new console errors on any page load.

**Playwright** (local stack, tokens on): 17 passed, 6 failed — exactly the
six known failures (`ux-polish.spec.ts` ×5, `votes.spec.ts` ×1), none new.

**Not done by the session: the signed-in items** (checklist items 10–33:
sign-in, attestation, onboarding, creating each type, assistant, endorsing,
voting and changing a ballot, project updates, Polis, My Submissions,
feedback, briefs and brief email, reviews, archive, admin settings,
announcements, anonymity signed in). The session cannot sign in on a hosted
site: sign-in codes are credentials. Playwright covers the core of them
locally. On production they are Adam's "Verification" walk below.
