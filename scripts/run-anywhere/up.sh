#!/bin/bash
# The engine's database on plain Postgres + PostgREST, no Supabase
# (docs/RUN-ANYWHERE.md, ADR-012). Starts two containers on a private network,
# creates the roles, applies every migration and the local seed, and puts the
# /rest/v1 path in front of PostgREST. What the `run-anywhere` CI job does,
# for a laptop.
#
#   ./scripts/run-anywhere/up.sh            start (idempotent: removes old containers first)
#   ./scripts/run-anywhere/up.sh down       stop and remove
#
# Ports (chosen not to collide with the Supabase CLI's 54321/54322):
#   PG_PORT    Postgres                 default 55432
#   REST_PORT  PostgREST, bare          default 3010
#   API_PORT   /rest/v1 proxy (SUPABASE_URL)  default 54331
# It prints the settings to start the hub with. Development values only.
set -euo pipefail

PG_PORT=${PG_PORT:-55432}
REST_PORT=${REST_PORT:-3010}
API_PORT=${API_PORT:-54331}
NET=civic-run-anywhere
JWT_SECRET=${JWT_SECRET:-run-anywhere-local-jwt-secret-0123456789abcdef}
PG_IMAGE=${PG_IMAGE:-postgres:17}
REST_IMAGE=${REST_IMAGE:-postgrest/postgrest:v14.5}
cd "$(dirname "$0")/../.."

docker rm -f civic-ra-pg civic-ra-rest >/dev/null 2>&1 || true
pkill -f "rest-proxy.mjs $API_PORT" >/dev/null 2>&1 || true
if [[ "${1:-}" == "down" ]]; then docker network rm "$NET" >/dev/null 2>&1 || true; echo "stopped"; exit 0; fi

docker network create "$NET" >/dev/null 2>&1 || true
# ICU en-US, as on Supabase: text sorts the same (glibc's en_US ignores punctuation).
docker run -d --name civic-ra-pg --network "$NET" -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_INITDB_ARGS="--locale-provider=icu --icu-locale=en-US" -p "$PG_PORT:5432" "$PG_IMAGE" >/dev/null
for i in $(seq 1 60); do docker exec civic-ra-pg pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done

psql_in() { docker exec -i civic-ra-pg psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_in -v authenticator_password=postgres < scripts/run-anywhere/roles.sql
for f in supabase/migrations/*.sql; do psql_in < "$f" || { echo "migration failed: $f"; exit 1; }; done
psql_in < supabase/seed.sql
# The catalog's pending entries for this checkout's plugin packages, approved as
# the local operator (ADR-014): the loader mounts only approved hashes.
CIVIC_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$PG_PORT/postgres" npx tsx scripts/catalog-approve-local.ts
echo "[run-anywhere] $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations and the seed applied"

docker run -d --name civic-ra-rest --network "$NET" -p "$REST_PORT:3000" \
  -e PGRST_DB_URI="postgres://authenticator:postgres@civic-ra-pg:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" "$REST_IMAGE" >/dev/null
node scripts/run-anywhere/rest-proxy.mjs "$API_PORT" "http://127.0.0.1:$REST_PORT" > "${TMPDIR:-/tmp}/civic-ra-proxy.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$API_PORT/rest/v1/" >/dev/null 2>&1 && break; sleep 1; done

echo "SUPABASE_URL=http://127.0.0.1:$API_PORT"
echo "SUPABASE_SERVICE_ROLE_KEY=$(node scripts/run-anywhere/service-key.mjs "$JWT_SECRET")"
echo "CIVIC_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:$PG_PORT/postgres"
