#!/usr/bin/env bash
#
# Replace civic-hub-dev's environment with what .env holds, minus the things
# that must not travel.
#
#   ./scripts/vercel-env-sync.sh --dry-run    show what it would do
#   ./scripts/vercel-env-sync.sh              do it
#
# Requires the Vercel CLI, logged in, with this directory linked to
# civic-hub-dev. It refuses to run against the production project.
#
# WHAT IT SKIPS, AND WHY
#   CIVIC_DEMO_BYPASS_CODE   there is no bypass code any more
#   CIVIC_BETA_MODE          a hub's mode is a database column, and an env var
#                            must not decide whether a hub checks emails
#   CIVIC_HUB_ID             the protocol identity; leave it to the default
#   CIVIC_ALLOW_SEED         seeding a real deployment from a web request
#   CIVIC_SEED_FIXTURE       same
#   VERCEL_OIDC_TOKEN        a local artefact of `vercel env pull`
#   VITE_HUB_*               all settings rows now; an env var here would
#                            shadow EVERY hub's row at once with one value
#
# It never echoes a value.
set -euo pipefail

cd "$(dirname "$0")/.."

DEV_PROJECT="civic-hub-dev"
PRODUCTION_PROJECT="civic-hub"
EXPECTED_SUPABASE_REF="urfmvqhzmamigssqwsya"
TARGET_ENV="production"
DEV_URL="https://civic-hub-dev.vercel.app"
ATHENS_URL="https://athens-civic-hub-dev.vercel.app"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

command -v vercel >/dev/null || {
  echo "The Vercel CLI is not installed. Run: npm i -g vercel && vercel login" >&2
  exit 1
}

[[ -f .vercel/project.json ]] || {
  echo "Not linked. Run: vercel link   (choose $DEV_PROJECT)" >&2
  exit 1
}

LINKED="$(node -e "process.stdout.write(require('./.vercel/project.json').projectName||'')")"
echo "Linked project: $LINKED"
if [[ "$LINKED" == "$PRODUCTION_PROJECT" ]]; then
  echo "REFUSED: linked to the PRODUCTION project. Run: vercel link (choose $DEV_PROJECT)" >&2
  exit 1
fi
if [[ "$LINKED" != "$DEV_PROJECT" ]]; then
  echo "REFUSED: expected \"$DEV_PROJECT\", found \"$LINKED\"." >&2
  exit 1
fi

# The service-role key decides access, so check the KEY, not just the URL.
node --env-file=.env -e '
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const url = process.env.SUPABASE_URL || "";
const EXPECT = "'"$EXPECTED_SUPABASE_REF"'";
const PROD = "nfhyypwoporfggqcerli";
let ref = null;
try { ref = JSON.parse(Buffer.from(key.split(".")[1]||"", "base64url").toString("utf8")).ref || null; } catch {}
const urlRef = (url.match(/([a-z]{20})\.supabase\.co/)||[])[1] || null;
if (ref === PROD || urlRef === PROD) { console.error("REFUSED: .env names the PRODUCTION Supabase project."); process.exit(2); }
if (ref !== EXPECT) { console.error(`REFUSED: service key belongs to ${ref}, expected ${EXPECT}.`); process.exit(3); }
if (urlRef !== EXPECT) { console.error(`REFUSED: SUPABASE_URL names ${urlRef}, expected ${EXPECT}.`); process.exit(4); }
console.log(`Supabase credentials verified: ${EXPECT} (dev)`);
'

SKIP="CIVIC_DEMO_BYPASS_CODE CIVIC_BETA_MODE CIVIC_HUB_ID CIVIC_SEED_FIXTURE CIVIC_ALLOW_SEED VERCEL_OIDC_TOKEN"

echo
echo "--- clearing existing variables ---"
EXISTING="$(vercel env ls "$TARGET_ENV" 2>/dev/null | awk 'NR>1 && $1 ~ /^[A-Z_][A-Z0-9_]*$/ {print $1}' | sort -u || true)"
for name in $EXISTING; do
  if $DRY_RUN; then echo "  would remove $name"; else
    vercel env rm "$name" "$TARGET_ENV" -y >/dev/null 2>&1 && echo "  removed $name"
  fi
done
[[ -z "$EXISTING" ]] && echo "  (none)"

echo
echo "--- adding from .env ---"
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
  name="${line%%=*}"
  [[ " $SKIP " == *" $name "* ]] && { echo "  skip $name"; continue; }
  [[ "$name" == VITE_HUB_* ]] && { echo "  skip $name (a settings row now)"; continue; }
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  [[ -z "$value" ]] && { echo "  skip $name (empty)"; continue; }
  if $DRY_RUN; then echo "  would add $name"; else
    printf '%s' "$value" | vercel env add "$name" "$TARGET_ENV" >/dev/null 2>&1 && echo "  added $name"
  fi
done < .env

# Set for this deployment rather than copied from a local .env.
add_literal() {
  local name="$1" value="$2"
  if $DRY_RUN; then echo "  would set $name"; else
    vercel env rm "$name" "$TARGET_ENV" -y >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$TARGET_ENV" >/dev/null 2>&1 && echo "  set $name"
  fi
}
echo
echo "--- deployment-specific ---"
add_literal BASE_URL "$DEV_URL"
add_literal CIVIC_UI_BASE_URL "$DEV_URL"
# Both hubs' origins. The server refuses to start in production without this,
# and a missing origin here shows up as CORS failures on the second hub only.
add_literal CIVIC_ALLOWED_ORIGINS "$DEV_URL,$ATHENS_URL"

# Secrets this deployment needs that are not in .env, generated fresh.
#
# None of them block boot, which is why they were easy to miss: without
# CIVIC_ANON_SECRET anonymous comments degrade to a safe but less private
# derivation, and DIGEST_UNSUBSCRIBE_SECRET only throws at the moment a digest
# tries to issue an unsubscribe link. Generating them here means the dev
# deployment behaves like a real one rather than quietly differently.
#
# Fresh random values, never copied from production: a dev deployment that
# shared production's signing secrets could mint tokens production would honour.
for secret in CIVIC_ANON_SECRET CRON_SECRET DIGEST_UNSUBSCRIBE_SECRET; do
  if grep -qE "^${secret}=." .env 2>/dev/null; then
    echo "  $secret already came from .env"
  else
    add_literal "$secret" "$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
  fi
done

echo
$DRY_RUN && echo "Dry run — nothing changed." || cat <<DONE
Done. Verify before the first build:

  vercel env pull .env.dev --environment=$TARGET_ENV
  node --env-file=.env.dev --import tsx scripts/check-deploy-env.ts
  rm .env.dev

DONE
