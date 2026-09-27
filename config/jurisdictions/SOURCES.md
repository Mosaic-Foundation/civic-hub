# The jurisdiction reference list: sources

`us-jurisdictions.csv` (committed) is built by `scripts/build-jurisdictions.ts`
from the raw files below, which `scripts/fetch-jurisdiction-sources.sh`
downloads into `sources/` (gitignored). `scripts/load-jurisdictions.ts` loads
the committed CSV into any install and refuses it unless its sha256 matches
`us-jurisdictions.sha256`. Rules (what is in, display names): the header of
`scripts/build-jurisdictions.ts` and BUILD-PLAN-multi-tenant.md →
"Jurisdictions, plugins at creation, purge, platform postal address".

## Sources

| File | From | Version | License |
|---|---|---|---|
| `2026_Gaz_state_national.txt`, `2026_Gaz_counties_national.txt`, `2026_Gaz_place_national.txt`, `2026_Gaz_cousubs_national.txt`, `2026_Gaz_unsd_national.txt`, `2026_Gaz_elsd_national.txt`, `2026_Gaz_scsd_national.txt` (each unzipped from the `.zip` of the same name) | U.S. Census Bureau, Gazetteer Files: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/` (index page: `https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2026.html`) | 2026 Gazetteer | A work of the U.S. Government: not subject to copyright in the United States (17 U.S.C. § 105). |
| `country-us.csv` | Open Civic Data, `https://github.com/opencivicdata/ocd-division-ids`, `identifiers/country-us.csv` | commit `b5911539ae7f79b5edf6b301c8002bb3db3e3e87` (2025-12-08, "additions: indianapolis, ne supreme court, st. croix board of elections") | CC0 1.0 Universal (`LICENSE.md` in the repository) |

Both licenses verified 2026-09-27.

## Checksums of the files the committed list was built from

_Pending: filled in when the files are downloaded and the list is built._
