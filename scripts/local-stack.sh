#!/bin/bash
# The local Supabase stack, kept small and put away (local stack hygiene,
# 2026-10-24). One editing session at a time on this machine; see TESTING.md →
# "The local stack".
#
#   ./scripts/local-stack.sh start    Docker up if it isn't, the stack up if it isn't, pending
#                                     migrations applied, the fixture set loaded (idempotent)
#   ./scripts/local-stack.sh reset    every local row and stored file dropped, then the fixture set only
#   ./scripts/local-stack.sh stop     the hub's dev servers stopped (named), the stack stopped (data kept),
#                                     Docker Desktop quit on macOS when nothing else is running in it
#   ./scripts/local-stack.sh status   what is running, hubs, events, disk
#
# The fixture set (what CI loads, plus the smoke hub):
#   floyd   from the migrations (beta), its settings seeded
#   athens  from supabase/seed.sql (demo), its settings seeded
#   smoke   a beta hub of kind "other" at smoke.localhost, set up as dev's smoke hub, for a local smoke run
#   the jurisdiction list (config/jurisdictions/)
# Test runs delete the hubs they create (tests/setup/dropTestHubs.ts), so the
# set stays this size between resets.
#
# The stack starts without Supabase's log analytics and log collector
# (logflare, vector): nothing here reads them, and their log table grew to
# 5.7 GB. A plain `supabase start` still brings them up.
#
# Refuses anything but a stack on this machine: every URL it uses comes from
# `supabase status` and must be 127.0.0.1 or localhost, and the fixture
# scripts run with an empty environment plus those values, never .env.
set -euo pipefail

cd "$(dirname "$0")/.."
HUB_DIR=$(pwd -P)
MONO_DIR=$(cd .. && pwd -P)
PROJECT=$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' supabase/config.toml)
DB_CONTAINER="supabase_db_${PROJECT}"
EXCLUDE="logflare,vector"
FIXTURE_HUBS="athens floyd smoke"
ADMIN_EMAILS="admin@example.test"

say() { printf '%s\n' "$*"; }
die() { printf 'local-stack: %s\n' "$*" >&2; exit 1; }

docker_up() { docker info >/dev/null 2>&1; }
stack_up() { docker_up && [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" = "true" ]; }

local_only() {
  case "$1" in
    http://127.0.0.1:*|http://localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
    *) die "refusing: '$1' is not the local stack" ;;
  esac
}

# The stack's URLs and keys, read from the CLI and checked. Sets API_URL, DB_URL, SERVICE_KEY.
read_stack() {
  local st
  st=$(supabase status -o json 2>/dev/null) || die "the stack is not running (./scripts/local-stack.sh start)"
  API_URL=$(jq -r .API_URL <<<"$st")
  DB_URL=$(jq -r .DB_URL <<<"$st")
  SERVICE_KEY=$(jq -r .SERVICE_ROLE_KEY <<<"$st")
  local_only "$API_URL"
  local_only "$DB_URL"
  [ -n "$SERVICE_KEY" ] && [ "$SERVICE_KEY" != "null" ] || die "no service-role key from supabase status"
}

# A supabase CLI command, quiet unless it fails (then its whole output, e.g. the migration that broke).
quiet() {
  local log; log=$(mktemp)
  if "$@" >"$log" 2>&1; then rm -f "$log"; else cat "$log" >&2; rm -f "$log"; die "failed: $*"; fi
}

sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

# A fixture script with nothing from the shell or .env but the local stack.
fixture() {
  env -i PATH="$PATH" HOME="$HOME" \
    SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
    CIVIC_TARGET_DATABASE_URL="$DB_URL" CIVIC_ADMIN_EMAILS="$ADMIN_EMAILS" \
    node --import tsx "$@"
}

start_docker() {
  docker_up && return 0
  [ "$(uname)" = "Darwin" ] || die "Docker is not running; start it and run this again"
  say "Starting Docker Desktop…"
  docker desktop start --detach >/dev/null 2>&1 || open -a Docker
  for _ in $(seq 1 90); do docker_up && return 0; sleep 2; done
  die "Docker did not come up within 3 minutes"
}

load_fixtures() {
  read_stack
  # athens is seed.sql's; a stack whose volume predates it gets it here (ON CONFLICT DO NOTHING).
  sql < supabase/seed.sql
  fixture scripts/seed-hub-settings.ts --hub floyd >/dev/null
  fixture scripts/seed-hub-settings.ts --hub athens >/dev/null
  fixture scripts/load-jurisdictions.ts | tail -1
  if [ -z "$(sql -c "select 1 from hubs where id = 'smoke'")" ]; then
    fixture scripts/create-hub.ts --id smoke --hostname smoke.localhost --name "Smoke Test Hub" \
      --kind other --mode beta >/dev/null
    # As dev's smoke hub, made before the navigation and Members slices: top tabs, the member count always shown.
    sql -c "delete from hub_settings where hub_id = 'smoke' and key in ('nav.layout', 'plugin.members.min_count')"
    say "Created the smoke hub."
  fi
  # The plugin catalog's pending entries for this checkout's packages, approved
  # as the local operator would in the console (ADR-014).
  env -i PATH="$PATH" HOME="$HOME" CIVIC_TEST_DATABASE_URL="$DB_URL" node --import tsx scripts/catalog-approve-local.ts
}

cmd_start() {
  start_docker
  if stack_up; then
    say "The stack is up."
  else
    say "Starting the stack (without $EXCLUDE)…"
    quiet supabase start -x "$EXCLUDE"
  fi
  read_stack
  quiet supabase migration up --local
  load_fixtures
  cmd_status
}

cmd_reset() {
  start_docker
  # Every volume goes, the analytics log included; the stack comes back from the migrations and seed.sql.
  if docker ps -a --format '{{.Names}}' | grep -q "^supabase_.*_${PROJECT}$"; then
    say "Dropping the local stack and its data…"
    quiet supabase stop --no-backup
  fi
  say "Starting a fresh stack (without $EXCLUDE)…"
  quiet supabase start -x "$EXCLUDE"
  load_fixtures
  cmd_status
}

# Node processes listening on a port, started from this repo (civic-hub or a worktree of the mono-repo).
hub_listeners() {
  local pid cwd
  for pid in $(lsof -nP -iTCP -sTCP:LISTEN -a -c node -t 2>/dev/null | sort -u); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in
      "$HUB_DIR"|"$HUB_DIR"/*|"$MONO_DIR/.claude/worktrees"/*) printf '%s\t%s\n' "$pid" "$cwd" ;;
    esac
  done
}

# Its listening ports, without the ephemeral ones node opens for itself (49152 and up).
ports_of() { lsof -nP -a -p "$1" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {sub(/.*:/, "", $9); if ($9 < 49152) print $9}' | sort -un | paste -sd, -; }

cmd_stop() {
  local pid cwd ports stopped=0
  while IFS=$'\t' read -r pid cwd; do
    [ -n "$pid" ] || continue
    ports=$(ports_of "$pid")
    kill "$pid" 2>/dev/null && { say "Stopped node $pid on :$ports (${cwd#"$MONO_DIR"/})"; stopped=$((stopped + 1)); }
  done < <(hub_listeners)
  [ "$stopped" -gt 0 ] || say "No hub dev servers were running."
  sleep 1
  while IFS=$'\t' read -r pid cwd; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null && say "Killed node $pid (did not exit)"
  done < <(hub_listeners)

  if docker_up; then
    if stack_up || docker ps --format '{{.Names}}' | grep -q "_${PROJECT}$"; then
      supabase stop >/dev/null 2>&1 && say "Stopped the stack (data kept)."
    else
      say "The stack was not running."
    fi
    if docker ps -a --format '{{.Names}}' | grep -qE '^civic-ra-(pg|rest)$'; then
      docker rm -f civic-ra-pg civic-ra-rest >/dev/null 2>&1 || true
      say "Removed the run-anywhere containers."
    fi
    local others
    others=$(docker ps --format '{{.Names}}')
    if [ -n "$others" ]; then
      say "Docker left running; other containers are up: $(paste -sd' ' - <<<"$others")"
    elif [ "$(uname)" = "Darwin" ]; then
      # Docker's own stop quits the app; AppleScript's quit can leave it open with the engine stopped.
      docker desktop stop >/dev/null 2>&1 || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do pgrep -qf "Docker.app/Contents/MacOS" || break; sleep 1; done
      if pgrep -qf "Docker.app/Contents/MacOS"; then say "Docker Desktop is still quitting."; else say "Quit Docker Desktop."; fi
    fi
  else
    say "Docker is not running."
  fi
}

cmd_status() {
  local listeners
  listeners=$(hub_listeners)
  if [ -n "$listeners" ]; then
    say "Hub dev servers:"
    while IFS=$'\t' read -r pid cwd; do say "  node $pid on :$(ports_of "$pid") (${cwd#"$MONO_DIR"/})"; done <<<"$listeners"
  else
    say "Hub dev servers: none"
  fi
  if ! docker_up; then say "Docker: not running"; return 0; fi
  if ! stack_up; then
    say "Docker: running; the stack: stopped"
    local others; others=$(docker ps --format '{{.Names}}' | paste -sd' ' -)
    [ -z "$others" ] || say "Other containers: $others"
    return 0
  fi
  read_stack
  say "The stack: up at $API_URL ($(docker ps --format '{{.Names}}' | grep -c "_${PROJECT}$") containers)"
  local hubs others
  local in_set="'$(sed "s/ /','/g" <<<"$FIXTURE_HUBS")'"
  hubs=$(sql -c "select count(*) from hubs")
  say "Hubs: $hubs — $(sql -c "select coalesce(string_agg(id || ' (' || mode || ')', ', ' order by id), 'none of the fixture set') from hubs where id in ($in_set)")"
  others=$(sql -c "select count(*) from hubs where id not in ($in_set)")
  [ "$others" = "0" ] || say "  and $others beyond the fixture set: $(sql -c "select string_agg(id, ', ' order by created_at desc) from (select id, created_at from hubs where id not in ($in_set) order by created_at desc limit 5) h")$([ "$others" -gt 5 ] && echo ", …") (reset drops them)"
  say "Events: $(sql -c "select count(*) from events"); users: $(sql -c "select count(*) from users"); processes: $(sql -c "select count(*) from processes")"
  say "Disk: database $(sql -c "select pg_size_pretty(pg_database_size('postgres'))"), all databases $(sql -c "select pg_size_pretty(sum(pg_database_size(datname))) from pg_database")"
  others=$(docker ps --format '{{.Names}}' | grep -v "_${PROJECT}$" | paste -sd' ' - || true)
  [ -z "$others" ] || say "Other containers: $others"
}

case "${1:-}" in
  start) cmd_start ;;
  reset) cmd_reset ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) say "usage: $0 start|reset|stop|status"; exit 2 ;;
esac
