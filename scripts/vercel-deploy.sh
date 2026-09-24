#!/usr/bin/env bash
#
# vercel deploy, with a stop sign in front of the production project.
#
# WHY. `.vercel/project.json` is a file on disk that decides which project a
# deploy lands on. It was found naming the PRODUCTION project (`civic-hub`) on
# 2026-09-22, which meant `vercel deploy --prod` typed in this directory would
# have shipped to floyd.civic.social. A `vercel link` fixes it today; it does
# not stop it being wrong again tomorrow.
#
# This reads the link at the moment of the deploy and refuses when it names
# production, whatever the flags say.
#
#   ./scripts/vercel-deploy.sh                 deploy a preview
#   ./scripts/vercel-deploy.sh --prod          deploy to the linked project's production
set -euo pipefail

PRODUCTION_PROJECT="civic-hub"        # serves floyd.civic.social
DEV_PROJECT="civic-hub-dev"
LINK_FILE=".vercel/project.json"

cd "$(dirname "$0")/.."

if [[ ! -f "$LINK_FILE" ]]; then
  echo "No Vercel project is linked. Run: vercel link  (choose $DEV_PROJECT)" >&2
  exit 1
fi

NAME="$(node -e "process.stdout.write(require('./$LINK_FILE').projectName || '')")"
ID="$(node -e "process.stdout.write(require('./$LINK_FILE').projectId || '')")"

echo "Linked Vercel project: $NAME ($ID)"

if [[ "$NAME" == "$PRODUCTION_PROJECT" ]]; then
  cat >&2 <<MSG

REFUSED: this directory is linked to the PRODUCTION project ($NAME).

Deploying from here would ship to production. Production deploys are
not made from a build session.

Relink first:

  vercel link          # choose $DEV_PROJECT

There is deliberately no override flag. Unlike a database push, which the
cutover session legitimately has to make, there is no circumstance in which
this script should be the thing that deploys production.

MSG
  exit 1
fi

if [[ "$NAME" != "$DEV_PROJECT" ]]; then
  echo "WARNING: linked project is \"$NAME\", not \"$DEV_PROJECT\". Continuing." >&2
fi

exec vercel deploy "$@"
