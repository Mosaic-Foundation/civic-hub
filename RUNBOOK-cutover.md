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
