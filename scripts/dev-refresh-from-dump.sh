#!/usr/bin/env bash
#
# Replace the DEV database's `public` schema, its data and its migration
# history with a production dump. The first step of the cutover rehearsal
# (RUNBOOK-cutover.md → "Rehearsal: refresh dev from production").
#
#   ./scripts/dev-refresh-from-dump.sh <dump-dir>            build + apply
#   ./scripts/dev-refresh-from-dump.sh <dump-dir> --build    build restore.sql only
#
# <dump-dir> holds what `supabase db dump` wrote from production:
#   schema.sql      (supabase db dump --linked)
#   data.sql        (supabase db dump --linked --data-only)
#   migrations.sql  (supabase db dump --linked --data-only -s supabase_migrations)
#
# WHAT IT DOES. Builds one file, <dump-dir>/restore.sql, and runs it against the
# project civic-hub/ is linked to, through `supabase db query --linked` (the
# Management API; no database password needed). The file is one implicit
# transaction: if any statement fails, nothing changes.
#
#   1. DROP SCHEMA public CASCADE, recreate it empty.
#   2. Production's schema (tables, functions, grants, default privileges).
#   3. Production's migration history, replacing dev's.
#   4. Production's `public` rows only. The dump also carries `auth` and
#      `storage` rows; those are skipped: the hub does not use Supabase Auth,
#      and storage rows describe files that live in production's storage, not
#      dev's. Dev keeps its own bucket, files and storage policies.
#
# WHAT IT REFUSES. Anything but the dev project. The ref is checked against
# the dev ref itself, not merely "not production": this drops a schema.
set -euo pipefail

DEV_REF="urfmvqhzmamigssqwsya"          # civic_hub_floyd_Dev, free org
PRODUCTION_REF="nfhyypwoporfggqcerli"   # Civic-Hub-Floyd. Never.
LINK_FILE="supabase/.temp/project-ref"

cd "$(dirname "$0")/.."

DIR="${1:?usage: dev-refresh-from-dump.sh <dump-dir> [--build]}"
MODE="${2:-apply}"
for f in schema.sql data.sql migrations.sql; do
  [[ -s "$DIR/$f" ]] || { echo "Missing $DIR/$f" >&2; exit 1; }
done

REF="$(cat "$LINK_FILE" 2>/dev/null || true)"
if [[ "$REF" == "$PRODUCTION_REF" ]]; then
  echo "REFUSED: civic-hub/ is linked to PRODUCTION. This script drops a schema." >&2
  exit 1
fi
if [[ "$REF" != "$DEV_REF" ]]; then
  echo "REFUSED: civic-hub/ is linked to '$REF', not dev ($DEV_REF)." >&2
  exit 1
fi

OUT="$DIR/restore.sql"
node - "$DIR" "$OUT" <<'NODE'
const fs = require("fs");
const [dir, out] = process.argv.slice(2);
const read = (f) => fs.readFileSync(`${dir}/${f}`, "utf8");

// Keep only the sections of a data dump whose header names `schema`, plus the
// preamble (SET lines). pg_dump heads every section with
// "--\n-- Data for Name: <t>; Type: TABLE DATA; Schema: <s>; Owner: ...".
function onlySchema(sql, schema) {
  const parts = sql.split(/\n(?=--\n-- (?:Data for Name|Name): )/);
  const keep = [parts[0].replace(/^SET session_replication_role = replica;\s*/m, "")];
  for (const p of parts.slice(1)) {
    if (p.includes(`; Schema: ${schema};`)) keep.push(p);
  }
  return keep.join("\n").replace(/^RESET ALL;\s*$/m, "");
}
const strip = (sql) => sql.split("\n").filter((l) => !l.startsWith("\\")).join("\n");

const sql = [
  "-- Built by scripts/dev-refresh-from-dump.sh. DEV ONLY.",
  "SET session_replication_role = replica;",
  "DROP SCHEMA public CASCADE;",
  "CREATE SCHEMA public;",
  "ALTER SCHEMA public OWNER TO pg_database_owner;",
  strip(read("schema.sql")),
  "SET search_path = '';",
  "TRUNCATE supabase_migrations.schema_migrations;",
  strip(onlySchema(read("migrations.sql"), "supabase_migrations")),
  strip(onlySchema(read("data.sql"), "public")),
  "SET session_replication_role = DEFAULT;",
  "",
].join("\n");
fs.writeFileSync(out, sql);
console.log(`built ${out} (${(sql.length / 1024).toFixed(0)} KB)`);
NODE

if [[ "$MODE" == "--build" ]]; then
  echo "--build: not applied."
  exit 0
fi

echo "Applying to dev ($REF)…"
START=$(date +%s)
supabase db query --linked -f "$OUT" > "$DIR/restore.out" 2>&1 || {
  echo "FAILED after $(( $(date +%s) - START ))s — nothing was changed (one transaction). See $DIR/restore.out" >&2
  tail -20 "$DIR/restore.out" >&2
  exit 1
}
echo "Restored in $(( $(date +%s) - START ))s."
echo "Next: ./scripts/db-push.sh --dry-run, then ./scripts/db-push.sh"
