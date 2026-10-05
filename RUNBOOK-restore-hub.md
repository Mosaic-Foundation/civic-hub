# RUNBOOK-restore-hub.md — restore ONE hub, leave every other hub alone

For: a mistake inside one hub (rows deleted, content overwritten, a bad
import) on the shared database. Not for: a whole-database disaster (restore
the database from the encrypted backups: `RUNBOOK-restore-database.md`; the
nightly bundles there are also path A's bundles), or moving a hub to another
install (`scripts/import-hub.ts`; see "Moving a hub out" at the end).

Tools: `scripts/export-hub.ts`, `scripts/restore-hub.ts` (and
`scripts/lib/hubImport.ts` behind them). Bundle format: the `README.md` inside
any export, and `src/control/hubBundle/format.ts`. Decisions:
`BUILD-PLAN-multi-tenant.md` → Phase 5 → "Part two"; ADR-005.

---

## What a restore does, and does not

**Does, in one transaction** (any failure rolls all of it back, nothing
half-done):

1. Deletes the hub's rows from every table the export carries
   (`EXPORT_MANIFEST`), filtered by `hub_id` — no other hub's row is read for
   writing, let alone changed.
2. Loads the bundle's rows in foreign-key order.
3. Re-reads what it wrote: per-table row counts and the content fingerprint
   must equal the bundle's, or it rolls back.
4. Writes one `hub.restore` row to `control_audit_log`: who, which bundle,
   the row counts before (`before.rows`) and after, and whether the
   append-only tables were cleared.

Images in the bundle are uploaded first, under the hub's own prefix
(overwriting the same keys), and stored URLs are rewritten to them.

**Does not:**

| Not restored | Why | What to do |
|---|---|---|
| The `hubs` row (name, hostname, mode, status) | the console owns it | Compare the bundle's `hub.json` with the console by hand; change in the console. |
| Sessions | never exported (bearer credentials) | Restoring deletes the hub's users, which deletes their sessions: **residents sign in again.** Say so if you notify them. |
| Pending sign-in codes, link previews | never exported | Nothing: codes expire in minutes, previews refetch. |
| Settings whose name looks like a secret | never exported (listed in `manifest.json → excluded_settings`) | Re-enter them in the hub's admin. Normally none. |
| Images deleted from Storage | a database dump does not contain Storage objects | Only an export bundle carries image bytes. See path B. |
| Anything outside the bundle's tables | by design | — |

`events` and `review_turns` are append-only: their triggers refuse DELETE for
every role. A restore that has to clear rows there is **refused unless you
pass `--clear-append-only`**; with it, the triggers are suspended for those two
DELETE statements only, inside the transaction. Nothing else in the codebase
does this. A restore always needs it when the hub has any events, which every
real hub does; the flag is there so it is never done by accident.

**Other hubs are safe because:** every DELETE and every read-back is
`where hub_id = <hub>`; the conflict check refuses a row whose key belongs to
**another** hub (a user id, an email, a waitlist address) rather than
overwriting it; and the transaction is all-or-nothing. Rehearsal proof below:
Floyd's fingerprint was identical before and after Athens was restored.

---

## Before you start

1. **Which hub, and which state to go back to.** A restore replaces the hub's
   current rows entirely with the bundle's. Everything residents did since the
   bundle was taken is lost for that hub. Decide consciously.
2. **An env file for the target database**, never the command line (the
   scripts refuse a URL in their arguments). Create it once per environment:

   ```bash
   mkdir -p ~/civic-keys && chmod 700 ~/civic-keys
   ```

   Then create `~/civic-keys/<env>-db.env` (e.g. `dev-db.env`) with these
   three lines, and `chmod 600` it:

   ```
   CIVIC_TARGET_DATABASE_URL=postgresql://postgres:<db password>@db.<ref>.supabase.co:5432/postgres
   CIVIC_TARGET_SUPABASE_URL=https://<ref>.supabase.co
   CIVIC_TARGET_SERVICE_ROLE_KEY=<the project's service-role / sb_secret_ key>
   ```

   The database URL is Supabase → Project Settings → Database → Connection
   string → **Direct connection** (or the **Session pooler**, port 5432, if your
   network has no IPv6). Not the transaction pooler (6543): the restore holds
   one transaction and sets session state. The last two lines are only needed
   when the bundle has images.
3. **The repo on `multi-tenant` with dependencies installed** (`npm install`
   brings `pg`).

---

## Path A — restore from an export bundle

You have a bundle (a directory or `.tar.gz`) from `scripts/export-hub.ts` or
the console's "Export this hub".

**A1. Take a safety export of the hub as it is now**, so the restore itself can
be undone. From the deployment's env (read-only):

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=.env --import tsx scripts/export-hub.ts --hub <slug> --out exports/before-restore
```

Worked if: it prints the row counts, a fingerprint and the path. (`.env` here
must point at the same project you are restoring; for production use the
pulled production env as in `RUNBOOK-cutover.md`.)

**A2. Dry run.** Every check, no writes:

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/<env>-db.env --import tsx scripts/restore-hub.ts <bundle> --hub <slug> --clear-append-only --dry-run
```

Worked if: `will clear …` lists the hub's current counts, `and load N rows`
matches the bundle, and it ends `dry run: every check passed, nothing
written.` If it lists problems, nothing was changed; read them (a key that
belongs to another hub, a column the database lacks, a bundle that fails its
checksums) and stop.

**A3. Restore:**

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/<env>-db.env --import tsx scripts/restore-hub.ts <bundle> --hub <slug> --clear-append-only --actor <your email>
```

Worked if: `done. fingerprint … (matches the bundle), audit row written.`

**A4. Check.**
- The hub's `/api/health` → `status ok`.
- In the SQL editor: `select action, actor_email, at, after->>'bundle' from control_audit_log where target_hub_id = '<slug>' order by id desc limit 1;` → your `hub.restore`.
- Open the hub. The app caches settings per server instance for 60 s; wait a
  minute before judging identity or plugin settings.
- Compare `hub.json` in the bundle with the console's view of the hub.

**A5. To undo the restore**, run A2–A3 with the safety export from A1.

---

## Path B — restore from a full-database dump

You have no export of the hub from before the mistake, but you do have a
backup of the whole database. **Never load a full dump into the live
database** — that would roll back every hub. Load it somewhere else, export
the one hub from there, then do path A.

**B1. Get the rows back somewhere harmless.** Either:

- **Supabase:** Dashboard → Database → Backups → restore the backup (or a
  point in time) **to a new project**, if your plan offers it. Then export the
  hub from that project exactly as in A1, with an env file naming the new
  project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Storage objects are
  not part of a database backup: pass `--no-images`, and the live project's
  images (unless the mistake deleted them) stay where they are.
- **A dump file** (`pg_dump` / a downloaded backup): load it into a scratch
  database in the local stack's Postgres and export over a direct connection.
  Only the `public` schema is needed:

  ```bash
  docker exec supabase_db_civic-hub psql -U postgres -c "create database restore_scratch"
  ```
  ```bash
  docker exec -i supabase_db_civic-hub psql -U postgres -d restore_scratch -q < <dump.sql>
  ```

  (`ERROR: schema "public" already exists` is expected and harmless.) Then an
  env file, e.g. `~/civic-keys/scratch-source.env`, with
  `CIVIC_SOURCE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/restore_scratch`,
  and:

  ```bash
  cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && node --env-file=$HOME/civic-keys/scratch-source.env --import tsx scripts/export-hub.ts --hub <slug> --from-postgres --no-images --out exports/from-dump
  ```

  To also bundle the images the live project still holds, add a second
  `--env-file` naming the live project's `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` and drop `--no-images`.

**B2.** Path A, steps A1–A5, with that bundle.

**B3.** Drop the scratch copy (it holds every hub's personal data):

```bash
docker exec supabase_db_civic-hub psql -U postgres -c "drop database restore_scratch"
```

and delete the dump and the `exports/` directories when you are done.

---

## Rehearsals

**2026-09-26, local stack, path B end to end** (Phase 5 part two). The stack
stood in for production, with Floyd (939 rows) and Athens (75 rows: 7
processes, 16 events, 11 users, 36 settings).

| Step | Result | Time |
|---|---|---|
| Baseline exports | Floyd `71c58890…`, Athens `596f3594…` | 3 s |
| Full dump (`pg_dump --schema=public`) | 775 KB | < 1 s |
| The mistake | Athens: 3 comments deleted, 7 titles changed, 9 identity settings deleted | — |
| Load dump into `restore_scratch` | one expected error (`schema "public" already exists`) | 1 s |
| Export Athens `--from-postgres` | fingerprint `596f3594…` — identical to the baseline read through Supabase | 1 s |
| Restore without `--clear-append-only` | refused, `events: 16 rows`, nothing changed | < 1 s |
| Dry run, then restore with it | fingerprint matches; `hub.restore` audit row with before counts | < 1 s |
| After | Athens `596f3594…` (comments back, no `OOPS` titles); **Floyd `71c58890…`, unchanged** | — |

**2026-09-26, dev (`civic_hub_floyd_Dev`), path A on `p5-test`.** Adam ran
the two writes; the session ran the checks read-only.

| Step | Result |
|---|---|
| Export `p5-test` from dev | 6 rows (settings), fingerprint `97e39ef9…` |
| Env file | `~/civic-keys/dev-db.env`: the **Session pooler** URI (`postgres.<ref>@aws-1-us-east-1.pooler.supabase.com:5432`). The Direct connection host did not resolve (IPv6 only); the database password had to be reset in the dashboard first. |
| Fingerprints of every dev hub, before | floyd 1621 rows `485991b4…`, athens 23 `103062a6…`, utopia 10 `e7cd35e6…`, p5-test 6 `97e39ef9…` |
| Dry run | `will clear hub_settings 6`, load 6, every check passed |
| The mistake (SQL editor) | `delete from hub_settings where hub_id = 'p5-test'` → 0 rows left |
| Restore | `will clear nothing`, load 6; `fingerprint 97e39ef9… (matches the bundle), audit row written` |
| After | p5-test 6 rows `97e39ef9…`; **floyd, athens, utopia identical to before**; `hub.restore` audit row, actor adam@civic.social, `before.rows.hub_settings = 0`, bundle named |

The SQL editor answers a DELETE with "Success. No rows returned"; that is
not a row count. Confirm with a `select count(*)`.

---

## Moving a hub out (not a restore)

To load a hub into another install — its own Supabase project, or a plain
Postgres single-hub install — export it (A1) and run `scripts/import-hub.ts`
against the new install's env file. It refuses, changing nothing, if the hub,
its hostname or any of its keys already exist there. `--hostname` gives it its
new host; `--no-images` loads rows into a database with no Storage. Then set
`redirect_to` and archive it on the old platform (the slug and hostname stay
taken there).
