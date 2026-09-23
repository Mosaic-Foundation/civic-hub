# DEPLOY-dev.md — putting the `multi-tenant` branch on a dev deployment

Adam runs this. Written 2026-09-22, at the end of Phase 1 part two plus the
login-hardening pass. Nothing here touches production.

The goal is one deployment serving two hubs at two hostnames, backed only by
the Floyd **dev** database, so both can be walked through before Phase 2.

---

## 0. Read this first: do not push the branch yet

**`git push` of `multi-tenant` may trigger a Vercel Preview build on its own.**
If Preview inherits environment variables that point at the production
database, that build would run migrations-aware code against live Floyd data.

So the order is: **check the Preview environment variables first, push
second.** Section 1 is that check. Nothing has been pushed; the branch exists
only on this machine.

Two other things found while preparing this, both worth knowing:

- **`civic-hub/.vercel/project.json` links this directory to Vercel project
  `civic-hub`** (`prj_je4tO378drjg6RNYELk2qYvwuhdG`, team
  `team_NqVqLwk9waLQbiDxH5hajSOK`). If that is the production Floyd project,
  then `vercel deploy --prod` typed in this directory goes straight to
  production. Confirm which project it is before running any Vercel command
  here.
- **The Supabase CLI link was pointing at production** and has been moved to
  dev. `./scripts/db-push.sh` now refuses a production push unless you name
  the project ref, so a mistyped command cannot reach it.

---

## 1. Check Vercel → Settings → Environment Variables → **Preview**

For the project that will build this branch. Filter the list to the **Preview**
environment and check every row below. A variable set for "All Environments"
counts as set for Preview.

### 1a. The two that decide which database is written to

| Variable | What it must be | What would be wrong |
|---|---|---|
| `SUPABASE_URL` | `https://urfmvqhzmamigssqwsya.supabase.co` | **`nfhyypwoporfggqcerli`** anywhere in the value. That is production. |
| `SUPABASE_SERVICE_ROLE_KEY` | The **dev** project's service role key, from Supabase → civic_hub_floyd_Dev → Settings → API | A key whose payload names `nfhyypwoporfggqcerli`. The key decides access, not the URL — a production key with a dev URL still opens production. |

Both must be the dev project. If either is unset for Preview, Vercel may be
inheriting a Production-scoped value; check what "All Environments" contains.

### 1b. The ones that must NOT exist any more

Delete these from Preview if present. They no longer do anything, and their
presence means the environment predates the hardening pass.

| Variable | Why it is gone |
|---|---|
| `CIVIC_DEMO_BYPASS_CODE` | There is no bypass code. A demo hub accepts any six digits from an ordinary visitor and always emails a real code to an admin or official. |
| `CIVIC_BETA_MODE` | A hub's mode is the `mode` column on its `hubs` row. An environment variable must not be able to decide whether a hub checks email addresses. |
| `VITE_DEMO_MODE`, `VITE_DEMO_BYPASS_CODE` | Same, on the client side. |

### 1c. The ones that should be absent so the database is exercised

These are all `hub_settings` rows now. An environment variable still holding
one silently overrides **every** hub's row at once, which would hide exactly
what this deployment exists to show. Remove them from Preview, or confirm they
are unset:

`VITE_HUB_NAME`, `VITE_HUB_JURISDICTION`, `VITE_HUB_LABEL`, `VITE_HUB_TAGLINE`,
`VITE_HUB_BANNER_URL`, `VITE_HUB_BANNER_ALT`, `VITE_HUB_INTRO_BODY`,
`VITE_HUB_RESIDENCY_INTRO`, `VITE_HUB_GOVERNING_BODY_NAME`,
`VITE_HUB_GOVERNING_BODY_SHORT`, `VITE_HUB_PAGE_TITLE`, `VITE_HUB_DESCRIPTION`,
`VITE_HUB_POLIS_URL`, `VITE_HUB_ONBOARDING_WORDCLOUD_ID`, `HUB_NAME`,
`CIVIC_JURISDICTION`, `CIVIC_JURISDICTION_NAME`, `CIVIC_SPACE_DID`,
`BOARD_RECIPIENT_EMAIL`, `HUB_POSTAL_ADDRESS`, `FEEDBACK_RECIPIENT_EMAIL`,
and every `MEETING_*` and `FLOYD_NEWS_*`.

Leaving any of them set is not dangerous — it is just misleading, because both
hubs would then show the same value for it.

### 1d. The ones that should be set for Preview

| Variable | Value | Note |
|---|---|---|
| `CIVIC_ALLOWED_ORIGINS` | both dev hostnames, comma separated | The server refuses to start in production without it. |
| `CIVIC_ADMIN_EMAILS` | your address | Seeds Floyd's admin roster. Athens's is derived from it as `you+athens@…`. |
| `CIVIC_ANON_SECRET` | any long random string, **different from production's** | Used to derive anonymous comment identities. |
| `CRON_SECRET` | any long random string | Gates `/internal/*`. |
| `DIGEST_UNSUBSCRIBE_SECRET` | any long random string | |
| `RESEND_API_KEY` | a working key | **Required for the walkthrough.** Admins always need a real emailed code, so without this you cannot sign in as an admin on either hub. |
| `RESEND_FROM` | a verified sender on a domain you control | Real mail goes out from this deployment. |
| `ANTHROPIC_API_KEY` | optional | Only the drafting assistant needs it. |

Do **not** set `CIVIC_DEV_HUB`. The `<slug>.localhost` and `?hub=` overrides
are switched off when `NODE_ENV=production`, which is what Vercel sets, so on a
real deployment the hostname is the only thing that selects a hub. That is the
property being tested.

### 1e. Prove it mechanically, not by eye

```bash
cd ~/Developer/Civic-Social-Mono/civic-hub
vercel env pull .env.preview --environment=preview
node --env-file=.env.preview --import tsx scripts/check-deploy-env.ts
rm .env.preview
```

It decodes the service-role key and names the project it actually belongs to,
catches a URL and key that disagree, and fails on any variable from 1b. It
must print `PASS` before you push. Delete `.env.preview` afterwards — it holds
a service role key.

---

## 2. Apply the migrations to the dev database

```bash
cd ~/Developer/Civic-Social-Mono/civic-hub
cat supabase/.temp/linked-project.json    # must read urfmvqhzmamigssqwsya
./scripts/db-push.sh
```

The wrapper prints which project it is about to change and refuses production.
Eleven migrations are new on this branch; the ones that matter:

- `hubs` table, with Floyd seeded
- `hub_settings` re-keyed to `(hub_id, key)`
- `hubs.mode`, backfilled — **Floyd becomes `beta`**
- `sessions.hub_id`
- the trigger that refuses any move into `demo`

Afterwards, confirm Floyd came out in beta:

```bash
# in the Supabase SQL editor for civic_hub_floyd_Dev
select id, hostname, mode, status from hubs order by id;
```

---

## 3. Create the Athens hub on the dev database

Athens is created by `supabase/seed.sql` locally, which `db push` does not
apply. On dev, insert it by hand. **`mode` must be set in this INSERT** — a
trigger refuses any later move into demo, which is the rule working.

Replace the two hostnames with the ones you are going to use.

```sql
insert into hubs (id, hostname, name, jurisdiction_code, jurisdiction_name, space_did, mode)
values (
  'athens',
  'athens-dev.civic.social',          -- the Athens hostname
  'Athens Civic Hub',
  'us-va-athens',
  'Athens, Virginia',
  'did:web:athens-dev.civic.social',
  'demo'
)
on conflict (id) do nothing;

-- Floyd's row was seeded with its production hostname. On dev it has to match
-- the hostname this deployment is actually served at, or the resolver will
-- never find it.
update hubs set hostname = 'floyd-dev.civic.social' where id = 'floyd';

select id, hostname, mode from hubs order by id;
```

---

## 4. Seed both hubs' settings

```bash
cd ~/Developer/Civic-Social-Mono/civic-hub
vercel env pull .env.preview --environment=preview
node --env-file=.env.preview --import tsx scripts/check-deploy-env.ts   # PASS first
node --env-file=.env.preview --import tsx scripts/seed-hub-settings.ts --dry-run
node --env-file=.env.preview --import tsx scripts/seed-hub-settings.ts
node --env-file=.env.preview --import tsx scripts/seed-hub-settings.ts --hub athens
rm .env.preview
```

Idempotent, so rerunning is safe. Floyd's rows come from the environment;
Athens's are the demo fixture. Neither sets a mode.

---

## 5. Hostnames

Two hostnames pointing at the same Vercel project. Either works:

- **Vercel subdomains**, nothing to configure in DNS: add
  `floyd-dev-<project>.vercel.app` and `athens-dev-<project>.vercel.app` as
  domains on the project, then put those exact strings in `hubs.hostname`.
- **Custom subdomains** on `civic.social`, DNS at GoDaddy: `floyd-dev` and
  `athens-dev` as CNAMEs to `cname.vercel-dns.com`, added as domains on the
  Vercel project.

Whichever you choose, `hubs.hostname` must hold the hostname **exactly**,
lowercase and without a port. A mismatch shows the "No hub here" page, which
is the resolver working correctly on a hostname no hub claims.

---

## 6. Deploy

```bash
cd ~/Developer/Civic-Social-Mono/civic-hub
git push -u origin multi-tenant     # only after section 1 passed
```

A Preview build should appear. Confirm the deployment's environment is the
Preview one you checked.

---

## 7. What to check, in order

1. Both hostnames load and show **different** names, banners and taglines.
2. `/code-of-conduct` differs: Athens has its own short demo version.
3. `/terms` is the same document on both, carrying each hub's own name and no
   mention of the other place.
4. The proposal guide differs: Floyd's names the farmers market and the town
   park, Athens's names nowhere.
5. A hostname that belongs to no hub shows a plain "No hub here" page.
6. Sign in on Athens as an ordinary visitor with any six digits.
7. Sign in as **your Athens admin address** and confirm a real code arrives —
   a demo hub does not shortcut privileged accounts.
8. Sign in on Floyd and confirm the beta gate: an address that is not on the
   allowlist and is not an admin is offered the waitlist.
9. Take a session token from Athens and call Floyd's API with it. It must be
   refused.

---

## 8. Rollback

Nothing here is destructive, but if the dev database needs to go back:

- The migrations are additive. To undo `hubs.mode` becoming authoritative,
  `alter table hubs alter column mode drop not null` — but the code now reads
  only that column, so prefer fixing the row.
- To remove Athens: `delete from hubs where id = 'athens';` — its settings and
  sessions cascade.
- The branch is not merged and production is untouched, so reverting means
  redeploying `main`.
