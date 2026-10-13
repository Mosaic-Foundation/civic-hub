# RUNBOOK-release.md: releasing a change

A release is one command per environment (since 2026-10-13, the release tooling slice). The command keeps the order this
runbook has always asked for: **migrations first, then code, on dev as well as production.** New code may call a
function, column or table only its migration creates, and old code keeps working on a migrated database (migrations
are additive unless Adam approved otherwise and the release notes say so).

The step-by-step the command replaced is the **Appendix** at the end, for when the script can't run.

## Before either command

Read what the release needs, in its HANDOFF entry and session report:
- the migrations, and which of them are non-additive;
- the read-only pre-checks to run first;
- whether anyone is signed out.

If any of these is missing, ask before releasing. **Run the pre-checks by hand**, read-only, in the target project's
SQL editor (for example, the duplicate queries a new unique index needs). A pre-check that returns rows stops the
release until those rows are dealt with. The script does not run pre-checks.

## Dev

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && ./scripts/release.sh dev --dry-run
```
```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && ./scripts/release.sh dev
```

The dry run checks everything except the migration and the push, and checks the code that is live now. The real run:
1. links the Supabase CLI to dev if it isn't;
2. checks the tree is clean, on `multi-tenant`, and not behind origin;
3. shows the migrations `db-push.sh --dry-run` would apply;
4. asks once: "Apply N migrations and push? y/N";
5. applies them;
6. checks `/api/health` on the old code;
7. pushes `multi-tenant`;
8. waits up to 10 minutes for Vercel to serve the new commit;
9. checks `/api/health` and the JSON 404 again;
10. prints a summary.

Then the **Smoke** workflow runs on its own (GitHub → Actions → Smoke, and as a check on the commit). It does
everything in the old dev checklist that a browser can, on the smoke hub, in under three minutes. A red Smoke check
means look before releasing to production. What it covers is in TESTING.md → Smoke suite.

Still by hand after a dev release: anything on a real phone (the keyboard, pinch zoom), and anything the release's
own report asks for.

### When the dev release stops

It stops at the first mismatch, says which step, and changes nothing after that point.

| Stops at | What it means | What to do |
|---|---|---|
| The CLI link | `supabase link` to dev failed | `supabase login`, then run it again |
| The working tree | You're on another branch, have uncommitted changes, an uncommitted migration, or are behind origin | Do what the message says (`git checkout multi-tenant`, commit, `git pull --ff-only`), then run it again |
| Migrations, dry run | The CLI couldn't reach the database, or its output was unreadable | Run `./scripts/db-push.sh --dry-run` yourself and read the output |
| "You said no" | Nothing was applied or pushed | Nothing to undo |
| Migrations, apply | A migration failed. The code was **not** pushed | Run `./scripts/db-push.sh --dry-run` to see what went in. Fix the migration or the database before pushing code that needs it |
| Health on the old code | A migration broke the live code, or a schema gap remains | The message names the gap. If it names something the migration adds, run `NOTIFY pgrst, 'reload schema';` in the SQL editor and run the command again. Otherwise fix the database or roll the change back; don't deploy on top of it |
| The push | `git push` failed | The migrations are in, the code is not. Fix the push (network, auth) and run the command again: it finds no migrations and pushes |
| Waiting for Vercel | After 10 minutes dev still serves the old commit | Look at civic-hub-dev's Deployments page first: a failed build is not a missed push. If no build started, run the empty-commit command it prints, then run the command again |
| Health on the new code | The new code needs something the database doesn't have | As for "Health on the old code". The new code is live, so this is urgent |
| The JSON 404 | An unknown API route didn't answer `{"code":"not_found"}` as JSON | Something in front of the API changed (`vercel.json` rewrites, the error handler). Look before releasing further |

Running the command again is always safe: applied migrations are skipped, and a pushed branch has nothing to push.

## Production

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/release.sh prod --dry-run
```
```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/release.sh prod
```

Adam runs this; a Claude Code session never does (`.claude/settings.json` denies it). It is the dev sequence with
these differences:
- it refuses to run without `CONFIRM_PRODUCTION_PUSH` set to the production ref;
- it releases exactly `origin/multi-tenant`, so release dev first;
- `origin/main` must be an ancestor of `origin/multi-tenant`, and it prints the commits that will go live;
- it links the CLI to production for the migrations only, and links back to dev straight after. A trap does the same
  on any exit, so the CLI is never left on production;
- the push is `git push origin origin/multi-tenant:main`;
- at the end it reminds you to search the production Vercel logs for `[civic-error:descriptor.`. Any hit means a
  process descriptor failed to build on the new code.

The Smoke workflow's **production** job then checks, read-only, that `/api/health` is ok on the deployed commit and the
JSON 404 answers. It does not sign in or write anything.

### When the production release stops

Everything in the dev table applies, plus:

| Stops at | What it means | What to do |
|---|---|---|
| REFUSED | `CONFIRM_PRODUCTION_PUSH` is missing or wrong | Use the command above |
| Commits not on origin | Local `multi-tenant` is ahead of origin | Release dev first (`./scripts/release.sh dev`) |
| Not an ancestor | Someone committed to `main` directly, so the push wouldn't be a fast-forward | Bring that commit into `multi-tenant`, release dev, then come back |
| Link to production | `supabase link` failed | `supabase login`, then run it again. The CLI is still on dev |
| "may still be linked to PRODUCTION" | Linking back to dev failed after the migrations | Run the `supabase link --project-ref urfmvqhzmamigssqwsya` line it prints **before anything else** |
| Waiting for Vercel | Production still serves the old commit after 10 minutes | Look at civic-hub's Deployments page. If no build started, use Redeploy on the latest Production deployment there; then run the command again (it finds nothing to apply or push, and checks) |

## One-time setup

**The smoke hub on dev.** One beta hub that only the smoke suite uses, so nothing it makes lands on a hub people use.
Its slug must start with `smoke`. Adam runs, once, with the dev project in `.env`:

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env --import tsx scripts/create-hub.ts --id smoke --hostname smoke.dev.civic.social --name "Smoke Test Hub" --kind other --mode beta
```

It prints the hub's admin address (this deployment's admin, plus-addressed `+smoke`). Then:
- if `*.dev.civic.social` is not a wildcard domain on civic-hub-dev, add `smoke.dev.civic.social` there;
- the smoke admin gets about four review emails per dev deploy (residents' mail is held back on a beta hub). A Gmail
  filter on that `+smoke` address that skips the inbox keeps them out of the way.

**GitHub** (Mosaic-Foundation/civic-hub → Settings → Secrets and variables → Actions). Until these are set, each Smoke
job skips with a notice naming what is missing.

| Name | Kind | Value |
|---|---|---|
| `CIVIC_SMOKE_BASE_URL` | Variable | `https://smoke.dev.civic.social` |
| `CIVIC_SMOKE_HUB` | Variable | `smoke` |
| `CIVIC_SMOKE_SUPABASE_URL` | Variable | the dev project's URL, `https://urfmvqhzmamigssqwsya.supabase.co` |
| `CIVIC_SMOKE_SERVICE_ROLE_KEY` | Secret | the **dev** project's service-role key (Supabase → dev project → Settings → API). Never production's |
| `CIVIC_SMOKE_ADMIN_EMAIL` | Secret | the admin address `create-hub.ts` printed |
| `CIVIC_PROD_HUB_URL` | Variable | a production hub's address, for the read-only production check |

**Where the hubs are, for the script:** `scripts/release.config` (the dev and production hub URLs and project refs).
Any value can be overridden by an environment variable of the same name.

## Rules that have bitten before

- **Never raise SQLSTATE `40001` from a migration's functions.** PostgREST retries it by itself,
  forever, and exhausts the connection pool. Refuse with `P0001` and a message
  (`transition_process` does: `process_changed`).
- **A unique index can't be built over duplicates.** That's why the pre-checks exist.

## The guard

**Built (a): the code can't name a function no migration defines.**
`tests/unit/functionContract.test.ts` runs in CI on every push. It fails when:
- an `.rpc()` call names a function not in `src/db/functionContract.ts`, or a listed function
  is no longer called;
- the newest definition of a listed function in `supabase/migrations/` has other arguments
  than the list says.

So the code, the list and the migrations folder agree before anything is deployed. It can't
know whether a given database has had those migrations applied; step 7 is what catches that.

**Proposed, not built (b): a deploy that refuses to run ahead of its database.** A step in
Vercel's build would call the target database's `function_catalog()` and the table probes.
It would fail the build when the database is behind the code. This would have stopped the
2026-10-11 dev incident at build time.

Costs:
- the build needs database credentials;
- an unreachable database fails a deploy;
- a Preview build for a branch with a new migration fails until dev has that migration.

Adam's decision (2026-10-12): decide this together with moving the console to its own Vercel
project; until then, the health check after every release (release.sh does it; Appendix step 7 by hand).

## Appendix: the step-by-step, if the script can't run

What a release was before `release.sh` (Audit 4, 2026-10-12), and what the script does. Use it when the script
can't run (no bash, no Supabase CLI login, a step that needs doing differently). Production migrations from a checkout
of the commit being released, and the CLI linked back to dev straight after.

1. **Read what the release needs.** Its HANDOFF entry and session report list:
   - the migrations;
   - which of them are non-additive;
   - the read-only pre-checks to run first;
   - whether anyone is signed out.

   If any of these is missing, ask before releasing.
2. **Run the pre-checks**, read-only, in the target project's SQL editor. Examples:
   - the duplicate queries a new unique index needs (Audit 3: duplicate briefs per source, and
     duplicate reviews per draft);
   - a roster or catalog check (Audit 1: every active hub has an admin).

   A pre-check that returns rows stops the release until those rows are dealt with.
3. **Apply the migrations.** Dry run first. Dev:
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && ./scripts/db-push.sh --dry-run
   ```
   ```bash
   cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && ./scripts/db-push.sh
   ```
   Production: the same two commands with `CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli` in
   front, from a checkout of the commit being released.
4. **Reload PostgREST's schema if it needs it.** Every migration that adds or replaces a function
   or table ends with `NOTIFY pgrst, 'reload schema';`. If one does not, run that line in the SQL
   editor.

   You need it when a call answers `PGRST202` (no such function) or `PGRST204` (no such column)
   right after a migration.
5. **Check the database before the code:** `/health` (below) is still green on the old code.
   - Red now means a migration broke the code that is live. Stop, and fix the database or roll
     the migration's change back. Don't deploy on top of it.
6. **Deploy the code.**
   - Dev: push `multi-tenant`; Vercel builds `civic-hub-dev`.
   - Production: fast-forward `main` to the released commit and push.
7. **Check `/health` on the new code**, on one hub and on the console host:
   ```bash
   curl -s https://floyd.civic.social/health | jq '{status, commit, schema}'
   ```
   It must say `"status": "ok"`, `schema.gaps: []` and the released commit.
   - The health check names every table, column and database function the code calls, and
     their arguments (`src/db/schemaContract.ts`, `src/db/functionContract.ts`). A missing or
     mismatched function shows as a gap, for example `transition_process(): function
     transition_process has (…); the code calls (…)`, and the answer is 503.
   - A red result is re-checked every 30 seconds, so once the migration is in and the schema
     reloaded, it turns green on its own.

