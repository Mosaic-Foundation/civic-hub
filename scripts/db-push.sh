#!/usr/bin/env bash
#
# supabase db push, with a stop sign in front of production.
#
# WHY. The CLI link is a file on disk. It was found pointing at the PRODUCTION
# project on 2026-09-22, which meant `supabase db push` typed in this directory
# would have applied migrations to the live database — no prompt, no diff, no
# undo. The link has since been moved to dev, but "the link is currently
# correct" is not a safety property; it is a fact that was true once.
#
# This wrapper reads the link at the moment of the push and refuses when it
# points at production unless the operator says so in a way they cannot do by
# accident.
#
#   ./scripts/db-push.sh                  push to whatever is linked, if it is not prod
#   CONFIRM_PRODUCTION_PUSH=nfhyypwoporfggqcerli ./scripts/db-push.sh
#
# The confirmation is the project ref itself, so agreeing requires knowing
# which database you are about to change. "yes" would not.
set -euo pipefail

PRODUCTION_REF="nfhyypwoporfggqcerli"   # Civic-Hub-Floyd, paid org. Serves floyd.civic.social.
LINK_FILE="supabase/.temp/linked-project.json"

cd "$(dirname "$0")/.."

if [[ ! -f "$LINK_FILE" ]]; then
  echo "No Supabase project is linked. Run: supabase link --project-ref <ref>" >&2
  exit 1
fi

REF="$(node -e "process.stdout.write(require('./$LINK_FILE').ref)")"
NAME="$(node -e "process.stdout.write(require('./$LINK_FILE').name || '')")"

echo "Linked project: $NAME ($REF)"

if [[ "$REF" == "$PRODUCTION_REF" ]]; then
  if [[ "${CONFIRM_PRODUCTION_PUSH:-}" != "$PRODUCTION_REF" ]]; then
    cat >&2 <<MSG

REFUSED: this would apply migrations to PRODUCTION ($NAME).

Production migrations are applied in the cutover session, by Adam, from the
runbook in BUILD-PLAN-multi-tenant.md — not from a build session.

If you are the cutover session and you mean it:

  CONFIRM_PRODUCTION_PUSH=$PRODUCTION_REF ./scripts/db-push.sh

MSG
    exit 1
  fi
  echo "Production push confirmed. Proceeding."
fi

exec supabase db push "$@"
