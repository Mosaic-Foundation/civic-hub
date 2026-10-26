#!/usr/bin/env bash
#
# One-command release: migrations first, then code, checked at every step.
#
#   ./scripts/release.sh dev [--dry-run] [--yes]
#   CONFIRM_PRODUCTION_PUSH=<production ref> ./scripts/release.sh prod [--dry-run]
#
# DEV, in order, stopping at the first mismatch:
#   1. the Supabase CLI is linked to the dev project (relinks if not);
#   2. the working tree is clean, on the dev branch, not behind origin;
#   3. db-push.sh --dry-run, and the migrations it would apply;
#   4. one question: apply them and push?
#   5. db-push.sh;
#   6. /api/health on the old code: status ok, no schema gaps;
#      then, when us-jurisdictions.sha256 differs from the live commit's, the
#      jurisdiction list is loaded (RELEASE_*_DB_ENV in release.config);
#   7. git push;
#   8. wait for Vercel to serve the new commit (up to RELEASE_DEPLOY_TIMEOUT);
#   9. /api/health on the new code, and an unknown POST answers JSON 404;
#  10. a summary.
# --dry-run does all of it except the migration and the push, and checks the
# code that is live now.
# --yes answers step 4's question for you. Dev only: prod refuses it, so a
# production release always has a person saying yes (2026-10-13, sign-in slice).
#
# PROD is the same, except:
#   - it refuses unless CONFIRM_PRODUCTION_PUSH is the production ref;
#   - it releases exactly origin/<dev branch>, which must already contain
#     origin/main, and prints the commits that will go live;
#   - it links the CLI to production only for the migrations and links back
#     to dev straight after, and on any exit (a trap), so the CLI is never
#     left pointing at production;
#   - the push is `git push origin origin/<dev branch>:main`.
#
# Written 2026-10-13 (release tooling slice). The step-by-step it replaces is
# RUNBOOK-release.md → Appendix. Where the hubs are lives in
# scripts/release.config, never here.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=release.config
source scripts/release.config

LINK_FILE="supabase/.temp/linked-project.json"
STARTED_AT=$(date +%s)

# --- output ---------------------------------------------------------------

STEP=0
step() { STEP=$((STEP + 1)); printf '\n\033[1m%d. %s\033[0m\n' "$STEP" "$1"; }
ok()   { printf '   \033[32mok\033[0m  %s\n' "$1"; }
note() { printf '   %s\n' "$1"; }
stop() {
  # stop "what happened" ["what to do", ...]
  printf '\n\033[1;31mSTOPPED at step %d:\033[0m %s\n' "$STEP" "$1" >&2
  shift
  for line in "$@"; do printf '   %s\n' "$line" >&2; done
  exit 1
}
usage() {
  cat >&2 <<'USAGE'
Usage:
  ./scripts/release.sh dev [--dry-run] [--yes]
  CONFIRM_PRODUCTION_PUSH=<production ref> ./scripts/release.sh prod [--dry-run]
USAGE
  exit 2
}

# --- arguments --------------------------------------------------------------

TARGET="${1:-}"
[[ "$TARGET" == "dev" || "$TARGET" == "prod" ]] || usage
shift
DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    *) usage ;;
  esac
done
if [[ "$TARGET" == "prod" && "$ASSUME_YES" == 1 ]]; then
  echo "REFUSED: --yes is for dev only. A production release is always answered by a person." >&2
  exit 2
fi

for tool in git node curl supabase; do
  command -v "$tool" >/dev/null || { echo "This needs '$tool' on the PATH." >&2; exit 1; }
done

if [[ "$TARGET" == "prod" ]]; then
  if [[ "${CONFIRM_PRODUCTION_PUSH:-}" != "$RELEASE_PROD_REF" ]]; then
    cat >&2 <<MSG
REFUSED: this releases to PRODUCTION.

Run it with the production project ref in front, so agreeing requires knowing
which database you are about to change:

  CONFIRM_PRODUCTION_PUSH=$RELEASE_PROD_REF ./scripts/release.sh prod
MSG
    exit 1
  fi
  HUB_URL="$RELEASE_PROD_URL"
  LABEL="PRODUCTION"
else
  HUB_URL="$RELEASE_DEV_URL"
  LABEL="dev"
fi
BRANCH="$RELEASE_DEV_BRANCH"

# --- helpers ----------------------------------------------------------------

linked_ref() {
  [[ -f "$LINK_FILE" ]] || { echo ""; return; }
  node -e "process.stdout.write(String(require('./$LINK_FILE').ref || ''))"
}

link_to() {
  local ref="$1"
  note "Linking the Supabase CLI to $ref …"
  supabase link --project-ref "$ref" >/dev/null || return 1
  [[ "$(linked_ref)" == "$ref" ]]
}

# Back to dev, whatever happened. Installed for prod only.
relink_dev() {
  local status=$?
  if [[ "$(linked_ref)" != "$RELEASE_DEV_REF" ]]; then
    printf '\nLinking the Supabase CLI back to dev (%s) …\n' "$RELEASE_DEV_REF" >&2
    if ! supabase link --project-ref "$RELEASE_DEV_REF" >/dev/null || [[ "$(linked_ref)" != "$RELEASE_DEV_REF" ]]; then
      cat >&2 <<MSG

!!! The Supabase CLI may still be linked to PRODUCTION. Relink it now:

  cd $(pwd) && supabase link --project-ref $RELEASE_DEV_REF

MSG
    fi
  fi
  exit "$status"
}

ask() {
  local answer=""
  if [[ "$ASSUME_YES" == 1 && "$TARGET" == "dev" ]]; then
    printf '   %s [y/N] y (--yes)\n' "$1"
    return 0
  fi
  read -r -p "   $1 [y/N] " answer </dev/tty || true
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" ]]
}

# GET /api/health → "<http code>|<status>|<commit>|<gap count>|<gaps joined by ; >"
health() {
  local raw
  raw=$(curl -s -m 20 -w '\n%{http_code}' "$HUB_URL/api/health" || true)
  printf '%s' "$raw" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const lines = s.split("\n"); const code = lines.pop(); let j = {};
      try { j = JSON.parse(lines.join("\n")); } catch {}
      const gaps = (j.schema && Array.isArray(j.schema.gaps)) ? j.schema.gaps : ["(no schema report)"];
      process.stdout.write([code, j.status || "unreadable", j.commit || "unknown", gaps.length, gaps.join(" ; ")].join("|"));
    });'
}

# GET /api/health → "<mode>|<key id or empty>|<mounted packages on an approval not signed with it>" (ADR-015)
signatures() {
  curl -s -m 20 "$HUB_URL/api/health" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      let j = {}; try { j = JSON.parse(s); } catch {}
      const g = (j.plugins && j.plugins.signatures) || {};
      process.stdout.write([g.mode || "unknown", g.key || "", g.unsigned ?? "?"].join("|"));
    });'
}

# Wait up to $1 seconds for status ok with no gaps (and, given $2, that commit).
# The schema report is re-checked every 30 seconds, so a migration applied a
# moment ago can take that long to show.
require_healthy() {
  local wait_s="$1" want_commit="${2:-}" deadline=$(( $(date +%s) + $1 )) h code status commit ngaps gaps
  while :; do
    h=$(health); IFS='|' read -r code status commit ngaps gaps <<<"$h"
    if [[ "$status" == "ok" && "$ngaps" == "0" && ( -z "$want_commit" || "$commit" == "$want_commit" ) ]]; then
      ok "/api/health: status ok, no schema gaps, commit ${commit:0:7}"
      LIVE_COMMIT="$commit"
      return 0
    fi
    (( $(date +%s) >= deadline )) && break
    sleep 10
  done
  stop "$HUB_URL/api/health is not healthy (HTTP $code, status \"$status\", commit ${commit:0:7})." \
    "Schema gaps: ${gaps:-none}" \
    "If a gap names something a migration adds, reload PostgREST's schema in the SQL editor:" \
    "  NOTIFY pgrst, 'reload schema';" \
    "Then run this command again. Don't deploy code on top of a red health check."
}

check_404() {
  local tmp code ctype body
  tmp=$(mktemp)
  code=$(curl -s -m 20 -X POST -o "$tmp" -D "$tmp.h" -w '%{http_code}' "$HUB_URL/api/release-check-no-such-route" || true)
  ctype=$(grep -i '^content-type:' "$tmp.h" | tr -d '\r' | head -1 || true)
  body=$(head -c 300 "$tmp")
  rm -f "$tmp" "$tmp.h"
  if [[ "$code" == "404" && "$ctype" == *application/json* && "$body" == *'"not_found"'* ]]; then
    ok "unknown POST answers JSON 404"
  else
    stop "An unknown POST did not answer the JSON 404 (HTTP $code, ${ctype:-no content-type})." \
      "Body: $body" \
      "Something in front of the API (vercel.json rewrites, the error handler) changed. Look before going on."
  fi
}

# --- 1. the CLI link --------------------------------------------------------

step "The Supabase CLI is linked to dev"
if [[ "$(linked_ref)" != "$RELEASE_DEV_REF" ]]; then
  note "Linked to \"$(linked_ref)\", not dev."
  link_to "$RELEASE_DEV_REF" || stop "Could not link the CLI to dev ($RELEASE_DEV_REF)." \
    "Run: supabase link --project-ref $RELEASE_DEV_REF   (and 'supabase login' first if it asks)"
fi
ok "linked to dev ($RELEASE_DEV_REF)"

# --- 2. the working tree ----------------------------------------------------

step "The working tree is clean and $BRANCH is up to date"
CURRENT=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT" == "$BRANCH" ]] || stop "You are on '$CURRENT', not '$BRANCH'." "Run: git checkout $BRANCH"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  stop "There are uncommitted changes." "Commit or stash them (git status shows which), then run this again."
fi
if [[ -n "$(git status --porcelain -- supabase/migrations)" ]]; then
  stop "There are uncommitted files in supabase/migrations." \
    "A migration must be committed before it is applied: the database must never hold one the code does not."
fi
git fetch --quiet origin || stop "git fetch failed." "Check the network and your GitHub access."
BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH")
AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD")
(( BEHIND == 0 )) || stop "$BRANCH is $BEHIND commit(s) behind origin/$BRANCH." "Run: git pull --ff-only, then run this again."
HEAD_SHA=$(git rev-parse HEAD)
ok "clean, on $BRANCH at ${HEAD_SHA:0:7}, $AHEAD commit(s) not yet on origin"

if [[ "$TARGET" == "prod" ]]; then
  (( AHEAD == 0 )) || stop "$BRANCH has $AHEAD commit(s) that are not on origin." \
    "Production releases what dev already runs. Release dev first: ./scripts/release.sh dev"
  git merge-base --is-ancestor "origin/$RELEASE_PROD_BRANCH" "origin/$BRANCH" ||
    stop "origin/$RELEASE_PROD_BRANCH is not an ancestor of origin/$BRANCH, so the push would not be a fast-forward." \
      "Someone committed to $RELEASE_PROD_BRANCH directly. Bring that commit into $BRANCH, release dev, then come back."
  GOING_LIVE=$(git log --oneline "origin/$RELEASE_PROD_BRANCH..origin/$BRANCH")
  LIVE_COUNT=$(git rev-list --count "origin/$RELEASE_PROD_BRANCH..origin/$BRANCH")
  ok "origin/$RELEASE_PROD_BRANCH is an ancestor of origin/$BRANCH; $LIVE_COUNT commit(s) will go live:"
  if (( LIVE_COUNT > 0 )); then printf '%s\n' "$GOING_LIVE" | sed 's/^/        /'; fi
fi

# --- 3–5. migrations --------------------------------------------------------

MIGRATIONS=""
COUNT=0
dry_run_migrations() {
  local out
  out=$(./scripts/db-push.sh --dry-run 2>&1) || { printf '%s\n' "$out" | sed 's/^/      /' >&2; return 1; }
  printf '%s\n' "$out" | sed 's/^/      /'
  # The CLI (2.x) ends its dry run with a JSON line:
  #   {"upToDate":false,"dryRun":true,"migrations":[…],…}
  # Older versions printed a bulleted list of files instead; both are read.
  MIGRATIONS=$(printf '%s\n' "$out" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const line = s.split("\n").reverse().find(l => l.trim().startsWith("{") && l.includes("dryRun"));
      if (line) {
        const j = JSON.parse(line);
        const names = (j.migrations || []).map(m => typeof m === "string" ? m : (m.name || m.path || m.version || JSON.stringify(m)));
        if (!j.upToDate && names.length === 0) { console.log("UNREADABLE"); return; }
        console.log(names.join("\n")); return;
      }
      const found = [...new Set(s.match(/[0-9]{14}_[A-Za-z0-9_.-]+/g) || [])];
      if (found.length === 0 && !/up to date/i.test(s)) { console.log("UNREADABLE"); return; }
      console.log(found.join("\n"));
    });')
  [[ "$MIGRATIONS" != "UNREADABLE" ]] || { echo "   Could not tell from the output which migrations are pending." >&2; return 1; }
  COUNT=$(printf '%s' "$MIGRATIONS" | grep -c . || true)
}

if [[ "$TARGET" == "prod" ]]; then
  trap relink_dev EXIT
  trap 'exit 130' INT TERM
  step "Migrations on PRODUCTION (the CLI is linked back to dev straight after)"
  link_to "$RELEASE_PROD_REF" || stop "Could not link the CLI to production ($RELEASE_PROD_REF)."
  ok "linked to production for the migrations"
else
  step "Migrations on dev"
fi

dry_run_migrations || stop "db-push.sh --dry-run failed (output above)."
if (( COUNT > 0 )); then
  ok "$COUNT migration(s) to apply:"
  printf '%s\n' "$MIGRATIONS" | sed 's/^/        /'
else
  ok "no migrations to apply"
fi

if (( DRY_RUN )); then
  note "Dry run: nothing applied."
else
  if [[ "$TARGET" == "prod" ]]; then
    QUESTION="Apply $COUNT migration(s) to PRODUCTION and push $LIVE_COUNT commit(s) to $RELEASE_PROD_BRANCH?"
  else
    QUESTION="Apply $COUNT migration(s) and push?"
  fi
  ask "$QUESTION" || stop "You said no. Nothing was applied or pushed."
  if (( COUNT > 0 )); then
    ./scripts/db-push.sh --yes || stop "db-push.sh failed (output above). The code was not pushed." \
      "Check which migrations went in: ./scripts/db-push.sh --dry-run" \
      "Fix the database or the migration; don't push code that needs it."
    ok "migrations applied"
  fi
  # A plugin package's new catalog entry (npm run catalog:add, ADR-014) has
  # just arrived, pending. Until the operator approves it in this
  # deployment's console the new code would not mount that package, so it is
  # approved now, between the migrations and the code.
  CATALOG_ENTRIES=$(printf '%s\n' "$MIGRATIONS" | grep -c '_catalog_' || true)
  if (( CATALOG_ENTRIES > 0 )); then
    note "$CATALOG_ENTRIES plugin catalog entr$( (( CATALOG_ENTRIES == 1 )) && echo y || echo ies) arrived, waiting for approval."
    note "Approve each in the console (Plugins) before the code goes out; a package without an approved entry is not mounted."
    ask "Approved in the console, push the code?" || stop "You said no. The migrations are in; the code is not pushed." \
      "Approve the entries in the console (Plugins), then run this again: it finds no migrations and pushes."
  fi
fi

if [[ "$TARGET" == "prod" ]]; then
  link_to "$RELEASE_DEV_REF" || stop "Could not link the CLI back to dev." \
    "Run now: supabase link --project-ref $RELEASE_DEV_REF"
  ok "linked back to dev"
fi

# --- 6. health before the code -----------------------------------------------

step "$LABEL /api/health on the code that is live now"
LIVE_COMMIT=""
require_healthy 90
BEFORE_COMMIT="$LIVE_COMMIT"

# --- 6b. the jurisdiction list ---------------------------------------------------
#
# config/jurisdictions/us-jurisdictions.csv is data the database must hold, not
# code: a release that changes it loads it (sign-in slice, 2026-10-14), after
# the migrations (a new type needs its constraint) and before the code. The
# loader is idempotent: it skips a list whose checksum is already loaded.

step "The jurisdiction list"
SUMFILE="config/jurisdictions/us-jurisdictions.sha256"
if [[ "$TARGET" == "prod" ]]; then DB_ENV="$RELEASE_PROD_DB_ENV"; else DB_ENV="$RELEASE_DEV_DB_ENV"; fi
LOAD_CMD="cd $(pwd) && node --env-file=$DB_ENV --import tsx scripts/load-jurisdictions.ts"
LIST_CHANGED=1
if [[ "$BEFORE_COMMIT" != "unknown" ]] && git cat-file -e "${BEFORE_COMMIT}^{commit}" 2>/dev/null; then
  git diff --quiet "$BEFORE_COMMIT" "$HEAD_SHA" -- "$SUMFILE" && LIST_CHANGED=0
else
  note "Can't tell which list the live code shipped (live commit ${BEFORE_COMMIT:0:7} isn't in this clone): loading checks."
fi
if (( LIST_CHANGED == 0 )); then
  ok "unchanged since ${BEFORE_COMMIT:0:7}; nothing to load"
  LIST_RESULT="unchanged"
elif [[ ! -f "$DB_ENV" ]]; then
  note "The list changed, and there is no env file at $DB_ENV to load it with."
  note "Load it before relying on the new places (the code works either way):"
  note "  $LOAD_CMD"
  LIST_RESULT="CHANGED, NOT LOADED: run  $LOAD_CMD"
elif (( DRY_RUN && COUNT > 0 )); then
  # The loader's dry run writes in a transaction it rolls back, so it would
  # meet the database as it is now, before the pending migrations.
  ok "the list changed; the real run loads it after the $COUNT pending migration(s)"
  LIST_RESULT="changed, not loaded (dry run; loads after the migrations)"
elif (( DRY_RUN )); then
  node --env-file="$DB_ENV" --import tsx scripts/load-jurisdictions.ts --dry-run 2>&1 | sed 's/^/      /' ||
    stop "The jurisdiction loader's dry run failed (output above)."
  ok "the list changed; the dry run above shows what loading it would do"
  LIST_RESULT="changed, not loaded (dry run)"
else
  node --env-file="$DB_ENV" --import tsx scripts/load-jurisdictions.ts 2>&1 | sed 's/^/      /' ||
    stop "Loading the jurisdiction list failed (output above). The code was not pushed." \
      "Run it by hand, then this command again:" "  $LOAD_CMD"
  ok "the list changed, and is loaded"
  LIST_RESULT="loaded ($(cut -c1-8 "$SUMFILE")…)"
fi

# --- 7–9. push, wait, check ----------------------------------------------------

if (( DRY_RUN )); then
  step "Dry run: nothing pushed; checking the live deployment"
  if [[ "$BEFORE_COMMIT" == "$HEAD_SHA" ]]; then note "It already runs HEAD (${HEAD_SHA:0:7})."
  else note "It runs ${BEFORE_COMMIT:0:7}; HEAD is ${HEAD_SHA:0:7}."; fi
  check_404
  PUSHED="nothing (dry run)"
else
  if [[ "$TARGET" == "prod" ]]; then
    step "Push origin/$BRANCH to $RELEASE_PROD_BRANCH"
    if (( LIVE_COUNT == 0 )); then
      ok "$RELEASE_PROD_BRANCH already is origin/$BRANCH; nothing to push"
    else
      git push origin "origin/$BRANCH:$RELEASE_PROD_BRANCH" || stop "git push failed." "Nothing was deployed; the migrations (if any) are in."
      ok "pushed"
    fi
    PUSHED="$LIVE_COUNT commit(s) to $RELEASE_PROD_BRANCH"
  else
    step "Push $BRANCH"
    if (( AHEAD == 0 )); then
      ok "origin/$BRANCH already has HEAD; nothing to push"
    else
      git push origin "$BRANCH" || stop "git push failed." "The migrations (if any) are in; the code is not. Fix and run this again."
      ok "pushed"
    fi
    PUSHED="$AHEAD commit(s) to $BRANCH"
  fi

  step "Wait for Vercel to serve ${HEAD_SHA:0:7}"
  DEADLINE=$(( $(date +%s) + RELEASE_DEPLOY_TIMEOUT ))
  while :; do
    IFS='|' read -r _ _ commit _ _ <<<"$(health)"
    [[ "$commit" == "$HEAD_SHA" ]] && break
    if (( $(date +%s) >= DEADLINE )); then
      stop "After $((RELEASE_DEPLOY_TIMEOUT / 60)) minutes $HUB_URL still runs ${commit:0:7}, not ${HEAD_SHA:0:7}." \
        "Vercel probably missed the push. Look at the project's Deployments page first: a failed build is not a missed push." \
        "If no build started, push an empty commit to wake it, then run this command again:" \
        "  cd $(pwd) && git commit --allow-empty -m \"Redeploy\" && git push origin $BRANCH"
    fi
    printf '   … live: %s, waiting\r' "${commit:0:7}"
    sleep 15
  done
  printf '\n'
  ok "Vercel serves ${HEAD_SHA:0:7}"

  step "$LABEL /api/health and the JSON 404 on the new code"
  require_healthy 90 "$HEAD_SHA"
  check_404

  # Signed approvals (ADR-015): with a catalog key on this deployment, every
  # mounted package must run on an approval signed with it. The rows approved
  # before signatures are signed in the console; nothing here holds the key.
  step "Signed approvals"
  IFS='|' read -r SIG_MODE SIG_KEY SIG_UNSIGNED <<<"$(signatures)"
  if [[ -z "$SIG_KEY" ]]; then
    note "No catalog key on this deployment (CIVIC_CATALOG_SIGNING_KEY): approvals are checked by fingerprint only ($SIG_MODE)."
    SIG_RESULT="no key ($SIG_MODE)"
  else
    if [[ "$SIG_UNSIGNED" != "0" ]]; then
      note "$SIG_UNSIGNED mounted package(s) run on an approval not signed with $SIG_KEY."
      note "Open the console → Plugins → Sign approved entries (a fresh code). Waiting up to 20 minutes…"
      DEADLINE=$(( $(date +%s) + 1200 ))
      while [[ "$SIG_UNSIGNED" != "0" ]]; do
        (( $(date +%s) >= DEADLINE )) && stop "$SIG_UNSIGNED mounted package(s) still run on unsigned approvals." \
          "Sign them in the console (Plugins → Sign approved entries), then run this command again:" \
          "it finds nothing to apply or push and checks the signatures again."
        printf '   … %s unsigned, waiting\r' "$SIG_UNSIGNED"
        sleep 15
        IFS='|' read -r SIG_MODE SIG_KEY SIG_UNSIGNED <<<"$(signatures)"
      done
      printf '\n'
    fi
    ok "every mounted package runs on an approval signed with $SIG_KEY ($SIG_MODE)"
    SIG_RESULT="all signed, $SIG_KEY ($SIG_MODE)"
  fi
fi

# --- 10. summary ----------------------------------------------------------------

ELAPSED=$(( $(date +%s) - STARTED_AT ))
printf '\n\033[1m%s release %s\033[0m  (%dm%02ds)\n' "$LABEL" "$( (( DRY_RUN )) && echo 'dry run: all checks passed' || echo 'done')" $((ELAPSED / 60)) $((ELAPSED % 60))
printf '  Hub:         %s\n' "$HUB_URL"
printf '  Release:     %s  %s\n' "${HEAD_SHA:0:7}" "$(git log -1 --format=%s "$HEAD_SHA")"
printf '  Migrations:  %s\n' "$( (( COUNT == 0 )) && echo none || { (( DRY_RUN )) && echo "$COUNT pending, not applied" || echo "$COUNT applied"; })"
printf '  Places list: %s\n' "$LIST_RESULT"
printf '  Pushed:      %s\n' "$PUSHED"
printf '  Live commit: %s (was %s)\n' "${LIVE_COMMIT:0:7}" "${BEFORE_COMMIT:0:7}"
printf '  Health:      ok, no schema gaps\n'
printf '  Unknown API: JSON 404\n'
printf '  Signatures:  %s\n' "${SIG_RESULT:-not checked}"
printf '  CLI link:    dev (%s)\n' "$(linked_ref)"
if [[ "$TARGET" == "prod" && $DRY_RUN -eq 0 ]]; then
  printf '\n\033[1mNow:\033[0m search the production Vercel logs for  [civic-error:descriptor.\n'
  printf '     Any hit means a process descriptor failed to build on the new code.\n'
elif [[ "$TARGET" == "dev" && $DRY_RUN -eq 0 ]]; then
  printf '\nThe dev smoke suite runs by itself on this deployment (GitHub → Actions → Smoke).\n'
fi
