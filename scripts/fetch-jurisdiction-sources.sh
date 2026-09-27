#!/usr/bin/env bash
# Download the raw sources for the jurisdiction reference list into
# config/jurisdictions/sources/ (gitignored). Run by hand; sessions cannot
# reach the network. Then: npx tsx scripts/build-jurisdictions.ts
#
# Pinned versions (recorded in BUILD-PLAN-multi-tenant.md → "Jurisdictions"):
#   Census Gazetteer 2026 national files (US government work, public domain in the US)
#   opencivicdata/ocd-division-ids identifiers/country-us.csv at commit
#   b5911539ae7f79b5edf6b301c8002bb3db3e3e87 (2025-12-08; CC0 1.0)
#
# Prints each file's sha256 at the end; build-jurisdictions.ts checks them.

set -euo pipefail
cd "$(dirname "$0")/.."
DIR=config/jurisdictions/sources
mkdir -p "$DIR"

GAZ=https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer
OCD_SHA=b5911539ae7f79b5edf6b301c8002bb3db3e3e87

for f in counties place cousubs unsd elsd scsd state; do
  curl -fsSL -o "$DIR/2026_Gaz_${f}_national.zip" "$GAZ/2026_Gaz_${f}_national.zip"
  (cd "$DIR" && unzip -o -q "2026_Gaz_${f}_national.zip")
done
curl -fsSL -o "$DIR/country-us.csv" \
  "https://raw.githubusercontent.com/opencivicdata/ocd-division-ids/$OCD_SHA/identifiers/country-us.csv"

ls -la "$DIR"
shasum -a 256 "$DIR"/*.txt "$DIR"/country-us.csv
