# DEPLOY-dev.md — putting the `multi-tenant` branch on a dev deployment

Adam runs this. Written 2026-09-22, at the end of Phase 1 part two plus the
login-hardening pass. Nothing here touches production.

Target project: **`civic-hub-dev`** (team creatinglake, Pro, repo
`Mosaic-Foundation/civic-hub`, root `./`). Never `civic-hub`, which is
production.

The goal is one deployment serving two hubs at two hostnames, backed only by
the Floyd **dev** database, so both can be walked through before Phase 2.

| Hub | Hostname | Mode |
|---|---|---|
| Floyd | `civic-hub-dev.vercel.app` | `beta` |
| Athens | `athens-civic-hub-dev.vercel.app` | `demo` |

Both are already written to the dev database (section 3 is done). Athens has
its own hostname rather than a `?hub=` query override: the override is
development-only and stays that way, because a query parameter that changes
which tenant you see is a hole, and Vercel gives a project extra `.vercel.app`
names with no DNS work.

---

## 0. Read this first

The branch **is pushed** (2026-09-23, on Adam's instruction). One risk came
with it and is still open: `civic-hub` and `civic-hub-dev` are both connected
to the same GitHub repo, so pushing a branch can trigger a build on EITHER. If
`civic-hub` builds branches as Previews and its Preview environment points at
the production database, that build runs this branch's code against live Floyd
data. **Check `civic-hub` → Settings → Git → Ignored Build Step, or its
Preview environment variables, and confirm no Preview built from
`multi-tenant`.**

Two other things found while preparing this, both worth knowing:

- **`civic-hub/.vercel/project.json` still links this directory to the
  PRODUCTION project `civic-hub`.** Relink it (`vercel link`, choose
  `civic-hub-dev`) before running any Vercel command here.
  `./scripts/vercel-deploy.sh` refuses to deploy while the link names
  `civic-hub`, with no override flag: unlike a database push, which the
  cutover legitimately has to make, there is no circumstance in which a build
  session should be what deploys production.
- **The Supabase CLI link was pointing at production** and has been moved to
  dev. `./scripts/db-push.sh` now refuses a production push unless you name
  the project ref, so a mistyped command cannot reach it.

---

## 1. Set Vercel → `civic-hub-dev` → Settings → Environment Variables

Scope these to **Production**, because `multi-tenant` becomes that project's
production branch. Leaving Preview empty is deliberate: a Preview build with no
database configured fails to boot, which is the safe direction.

The project currently holds ~43 variables with EMPTY values, created by the
import form. Remove them all first — an empty value is not the same as unset,
and several would shadow a hub's settings row with a blank.

Check every row below. The same table also applies if you scope to Preview.

### 1a. The two that decide which database is written to

| Variable | What it must be | What would be wrong |
|---|---|---|
| `SUPABASE_URL` | `https://urfmvqhzmamigssqwsya.supabase.co` | **`nfhyypwoporfggqcerli`** anywhere in the value. That is production. |
| `SUPABASE_SERVICE_ROLE_KEY` | The **dev** project's service role key, from Supabase → civic_hub_floyd_Dev → Settings → API | A key whose payload names `nfhyypwoporfggqcerli`. The key decides access, not the URL — a production key with a dev URL still opens production. |

Both must be the dev project. If either is unset for Preview, Vercel may be
inheriting a Production-scoped value; check what "All Environments" contains.

### 1b. The ones that must NOT exist any more

Delete these if present. They no longer do anything, and their
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

### 1d. The ones that should be set

| Variable | Value | Note |
|---|---|---|
| `CIVIC_ALLOWED_ORIGINS` | `https://civic-hub-dev.vercel.app,https://athens-civic-hub-dev.vercel.app` | The server refuses to start in production without it. |
| `CIVIC_ADMIN_EMAILS` | your address | Seeds Floyd's admin roster. Athens's is derived from it as `you+athens@…`. |
| `CIVIC_ANON_SECRET` | any long random string, **different from production's** | Used to derive anonymous comment identities. |
| `CRON_SECRET` | any long random string | Gates `/internal/*`. |
| `DIGEST_UNSUBSCRIBE_SECRET` | any long random string | |
| `RESEND_API_KEY` | a working key | **Required for the walkthrough.** Admins always need a real emailed code, so without this you cannot sign in as an admin on either hub. |
| `RESEND_FROM` | `noreply@civic.social` | **Set 2026-09-23.** A bare address: the display name beside it comes from each hub's `email.from_name`. It was missing entirely before that, so both hubs sent as the Resend sandbox, which delivers only to the Resend account owner — see below. |
| `HUB_CRON_ENABLED` | `false` | **Set 2026-09-23.** This deployment does not run scheduled work. |
| `ANTHROPIC_API_KEY` | optional | Only the drafting assistant needs it. |

#### Why those last two were added, and why together

`vercel.json` travels with the repo, so this project inherited production's
four crons the day it was created. In its first fourteen hours it fetched a
county government's news feed and created five announcement processes from it,
and attempted to email **fifty-seven** people their daily digest. Fifty-six of
those failed only because `RESEND_FROM` was unset and the fallback sender is
Resend's sandbox, which refuses every address but the account owner's.

So setting a real sender without also stopping the crons would have mailed
fifty-six real people from a development deployment on the next run. The two
changes belong in the same breath, and `HUB_CRON_ENABLED=false` is the first
thing to check if this project is ever recreated.

The second guard is in the code rather than the configuration: a hub whose
`mode` is not `live` delivers only to addresses on its own admin roster or
beta allow list, and logs everything else as `[email] SUPPRESSED`. Grep for
that string after a walkthrough to see what the deployment decided not to
send.

Do **not** set `CIVIC_DEV_HUB`. The `<slug>.localhost` and `?hub=` overrides
are switched off when `NODE_ENV=production`, which is what Vercel sets, so on a
real deployment the hostname is the only thing that selects a hub. That is the
property being tested.

### 1e. Prove it mechanically, not by eye

```bash
cd ~/Developer/Civic-Social-Mono/civic-hub
vercel link                                          # choose civic-hub-dev
vercel env pull .env.dev --environment=production
node --env-file=.env.dev --import tsx scripts/check-deploy-env.ts
rm .env.dev
```

It decodes the service-role key and names the project it actually belongs to,
catches a URL and key that disagree, and fails on any variable from 1b. It must
print `PASS` before the first real build. Delete the pulled file afterwards —
it holds a service role key.

---

## 2-5. Database: DONE (2026-09-23)

Already applied to `civic_hub_floyd_Dev` (`urfmvqhzmamigssqwsya`). Recorded
here so the cutover knows what dev looks like.

- The dev database had the old schema but **no migration history**, so
  `db push` tried to replay from the first migration and failed on
  `CREATE TABLE users`. The 47 pre-branch migrations were recorded as applied
  with `supabase migration repair --status applied <version>`, which writes
  history only and changes no schema; the 6 new ones then applied cleanly.
  **Production will have the same problem** if its history is also empty —
  check before the cutover.
- `hubs` now holds both rows with the hostnames above. Floyd's `space_did` was
  repointed to the dev host so activities emitted from dev do not claim
  production's identity.
- Athens was created with `mode = 'demo'` **in the INSERT**, because the
  trigger refuses any later move into demo.
- Settings seeded for both. Floyd's identity rows were written from the values
  its UI has as defaults, so the deployment shows Floyd's identity coming from
  the database rather than from a code fallback.

Verify any time:

```sql
select id, hostname, mode, status from hubs order by id;
select hub_id, count(*) from hub_settings group by hub_id;
```

## 6. Deploy

The branch is pushed. Set `multi-tenant` as the production branch on
**`civic-hub-dev`** (Settings → Git → Production Branch), then redeploy.

Environment variables on `civic-hub-dev` are set for the **Production**
environment, so the build must be a production one for that project — a
Preview build there would have no database configured and would fail to boot,
which is the safe direction.

---

## 7. What to check, in order

1. `https://civic-hub-dev.vercel.app` shows **Floyd Civic Hub**, and
   `https://athens-civic-hub-dev.vercel.app` shows **Athens Civic Hub** —
   different names, banners and taglines, one build.
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
