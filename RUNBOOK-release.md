# RUNBOOK-release.md: releasing a change that carries migrations

Short and general. A one-off sitting with its own steps (like `RUNBOOK-release-1.md`) still
follows this order. Written in Audit 4 (2026-10-12), after dev ran Audit 3's code against a
database without its migration: `/health` said "ok" while every vote approval failed.

## The order: migrations first, then code. On dev as well as production.

New code may call a function, column or table only its migration creates. Old code keeps
working on a migrated database, because migrations are additive unless Adam approved otherwise
and the release notes say so. So the database always goes first.

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

### Rules that have bitten before

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
project; until then, step 7 after every release.
