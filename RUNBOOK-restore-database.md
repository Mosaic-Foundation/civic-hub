# RUNBOOK-restore-database.md — restore from the encrypted backups

For: the database is lost or corrupted, or you need the data as it was at an
earlier time. For one hub's mistake, see `RUNBOOK-restore-hub.md` instead:
it restores a single hub in place and leaves every other hub alone, and its
bundles come from the same backups (§3 below).

The backups are made by the private repo `Mosaic-Foundation/civic-hub-backups`
(its `README.md` has the schedule, identities and settings). Decisions:
`BUILD-PLAN-multi-tenant.md` → "Backups".

---

## 1. What exists, and what doesn't

Bucket `gs://civic-social-backups` (Google Cloud project `mosaic-backups`,
organization mosaic.social, us-east1). `<target>` is `prod` or `dev`.

| Prefix | What | Made | Kept |
|---|---|---|---|
| `hourly/<target>/civic-db-<target>-<stamp>.dump.age` | full dump | every 6 h (00:17, 06:17, 12:17, 18:17 UTC) | 7 days |
| `daily/<target>/…` | the same file | the 00:17 run | 90 days |
| `monthly/<target>/…` | the same file | 00:17 on the 1st | 400 days |
| `hubs/<target>/<slug>/civic-hub-export-<slug>-<stamp>.tar.gz.age` | one hub's export bundle | 07:37 UTC, every `active` hub | 7 days |

**A dump holds:** schemas `public` and `supabase_migrations`: every table,
row, function, trigger, policy and grant there, and the migration history.
Format: `pg_dump -Fc` (restore with `pg_restore`), encrypted with age.

**A dump does not hold:**
- **Uploaded images** (Supabase Storage). Known gap; see BUILD-PLAN "Backups".
  Rows that point at images survive and show broken images if the bucket is
  gone.
- Supabase's own schemas (`auth`, `storage`, `extensions`, …): a new project
  has its own. The two storage buckets are recreated by their migrations (§4).
- Roles and passwords (`backup_reader`, the hub-token signing key, API keys):
  recreated by hand (§4).

**Hub bundles** are made with `--no-images`, so the same image gap applies.

---

## 2. Get a backup and open it

**Who can:** reading the bucket needs your own Google account (project owner);
the backup jobs' accounts can't read. Opening a file needs one of the two age
private keys, in password-manager items **"Civic Hub backups: age private key
(primary)"** and **"(recovery)"**. Either opens every backup. Never paste
either key into chat, a file or a terminal command line.

Tools, once per Mac:

```bash
brew install age libpq
```

**2.1 Pick the file.** console.cloud.google.com/storage/browser/civic-social-backups
→ the prefix → newest file before the damage. Click it → **Download**. The
browser names it with the folders joined by `_`, e.g.
`hourly_prod_civic-db-prod-20261006T001712Z.dump.age`.

**2.2 Decrypt.** The command reads the key from the clipboard, so the order
matters:

1. Clear the clipboard: `pbcopy < /dev/null`
2. Paste the command below into Terminal, with the real file name, and do
   **not** press Enter yet:

   ```bash
   cd ~/Downloads && age -d -i <(pbpaste) -o restore.dump <downloaded file>.dump.age && pbcopy < /dev/null
   ```

3. In the password manager, copy the **whole** line that starts
   `AGE-SECRET-KEY-1` (including those characters, nothing before or after).
4. Press Enter. Nothing printed = it worked; the clipboard is cleared.

`unknown identity type` = the clipboard held something other than that one
line (often the command itself). Clear it and repeat from step 2.
`no identity matched` = the wrong key or the wrong file.

**Worked if:** `head -c 5 restore.dump` prints `PGDMP`. For a hub bundle,
use `-o <slug>.tar.gz` instead; it is a `.tar.gz` you can hand to the hub
tools as it is.

The decrypted file is every hub's personal data. Delete it, and the `.age`
download, when you are done (§6).

---

## 3. Restore into a scratch database (look, compare, take a hub out)

The safe first move in every case: a throwaway copy on your Mac, through the
local Supabase stack (`supabase start` in civic-hub; Postgres 17,
port 54322). Nothing live is touched.

```bash
docker cp ~/Downloads/restore.dump supabase_db_civic-hub:/tmp/restore.dump
```

```bash
docker exec supabase_db_civic-hub psql -U postgres -c "create database restore_scratch"
```

```bash
docker exec supabase_db_civic-hub pg_restore -U postgres -d restore_scratch --no-owner /tmp/restore.dump
```

**Expected:** one error, `schema "public" already exists`, and
`errors ignored on restore: 1`. Anything else, stop and read it.

Then:
- **Look:** `docker exec -it supabase_db_civic-hub psql -U postgres -d restore_scratch`.
- **One hub from it:** `RUNBOOK-restore-hub.md` path B, from step B1's
  `export-hub.ts --from-postgres` onward (the scratch database is already
  loaded). Or skip all this and use that hub's nightly bundle from
  `hubs/<target>/<slug>/` directly with path A.
- **Some rows or a table:** copy them out of `restore_scratch` by hand, with
  care: `hub_id` scoping and the append-only triggers on `events` and
  `review_turns` still apply on the live side.

Drop it when done:

```bash
docker exec supabase_db_civic-hub psql -U postgres -c "drop database restore_scratch"
```

---

## 4. Restore the whole database (the project is gone or unusable)

**Not rehearsed end to end.** §2–§3 are (see Rehearsals); this section's
steps into a fresh Supabase project are not. Read it through first, and run
it on a new dev project before production if there is any time at all.

1. **New Supabase project**, Postgres 17, region us-east-1, in the right
   organization. Save its database password in the password manager.
2. **Restore the dump into it**, as `postgres`, over the Session pooler (copy
   the host from the dashboard's **Connect** → Session pooler; the direct host
   is IPv6-only):

   ```bash
   /opt/homebrew/opt/libpq/bin/pg_restore --no-owner --dbname "host=<pooler host> port=5432 dbname=postgres user=postgres.<new ref> sslmode=require" ~/Downloads/restore.dump
   ```

   It asks for the password. Expect `schema "public" already exists` and a few
   `permission denied to change default privileges` lines (defaults owned by
   `supabase_admin`); read anything else.
3. **Storage buckets and their policies:** run the two bucket migrations in
   psql on the new project: `supabase/migrations/20260924070000_post_images_bucket.sql`
   and `20260926020000_hub_exports_bucket.sql` (`\i <path>`). Both are safe to
   run twice. The migration history already lists them (it came with the
   dump), so `supabase db push` will not.
4. **Check:** `scripts/check-tenancy.ts --prod` against the new project
   (`RUNBOOK-cutover.md` §2g shows how and the env file it reads), and compare row counts with the dump
   (`pg_restore --list restore.dump | grep -c "TABLE DATA"` for the table
   count; counts per table from `restore_scratch` in §3).
5. **Keys and the app:** the hub-token signing key (ES256) and API keys, as
   in `RUNBOOK-cutover.md` §5 (signing key) and the Vercel env
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the signing key); redeploy;
   `/api/health` on every hub.
6. **Backups again:** `sql/backup_reader.sql` from civic-hub-backups on the
   new project, `\password backup_reader`, then update `DATABASE_URL_PROD` (a
   variable) and `DB_PASSWORD_PROD` (a secret) there.
7. **Images:** gone unless the old project's Storage is still readable. Tell
   hub admins which images to re-upload.

Everything residents did after the dump's timestamp is lost.

---

## 5. Key recovery

Every backup is encrypted to **two** age keys (`age-recipients.txt` in
civic-hub-backups): **primary**, in Adam's password manager, and
**recovery**, kept separately so a second person can decrypt without Adam.
Today Adam holds the recovery key too, in its own item, until it is handed to
a second key holder (a community admin). Either key alone opens every backup.

- **Hand the recovery key over:** share that one password-manager item (or a
  printed copy, sealed) with the second key holder, and give them this
  runbook. They need nothing else to decrypt; to download they also need read
  access to the bucket (Storage Object Viewer on `civic-social-backups`,
  granted to their Google account).
- **A key is lost or exposed:** make a new key pair (`age-keygen | pbcopy`,
  save it, clear the clipboard), replace the old public key in
  `age-recipients.txt`, commit and push. New backups use the new key at once.
  Backups already made stay openable only with the keys they were made for:
  if a key was **exposed**, the backups made for it are readable by whoever
  has it until they age out (7 days hourly, 90 daily, 400 monthly).
- **Both keys lost:** every existing backup is unreadable. Make a new pair
  now, as above; nothing older can be recovered.

---

## 6. Afterwards

- Delete the downloads and the decrypted files (`.age`, `.dump`, `.tar.gz`)
  and any `restore_scratch` database: they hold residents' personal data.
- Clear the clipboard if a step failed before doing it: `pbcopy < /dev/null`.
- Write what happened at the top of HANDOFF.md.

---

## Rehearsals

**2026-10-05, dev, both paths, from the bucket** (the backup session).

| Step | Result |
|---|---|
| Backup jobs, first runs on dev | dump 1,753,857 bytes, 38 tables with data, to `hourly/dev/` and `daily/dev/` (41 s); hub exports for all 7 active dev hubs (46 s); watchdog `ok` ×3 (14 s) |
| Alert | watchdog pointed at `prod` (no backups yet): `MISSING` ×3, run failed → GitHub failure email |
| Download + decrypt the dump with the **primary** key | `civic-db-dev-20261005T175554Z.dump`, same size as the job logged, `PGDMP` |
| Restore into `restore_scratch` (local stack, §3) | 1 expected error (`schema "public" already exists`), < 1 s |
| Compare with live dev | **38/38 tables, 41,188 rows, every count identical**; migration history to `20260929000000` |
| Download + decrypt utopia's nightly bundle with the **recovery** key | `civic-hub-export-utopia-20261005T175702Z` |
| `restore-hub.ts --dry-run` on dev | every check passed: clear 12, load 12 rows |
| `restore-hub.ts` on dev (Adam) | `fingerprint b04e7da5… (matches the bundle)` — the same fingerprint the nightly job logged — and the `hub.restore` audit row by adam@mosaic.social |

Gotchas found: the browser prefixes downloads with the folder names; age
reads the key from the clipboard, so paste the command first and copy the key
last; the key line must be copied whole, `AGE-SECRET-KEY-1` included.
