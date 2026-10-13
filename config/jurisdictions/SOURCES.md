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

Downloaded 2026-09-27 (Adam, `scripts/fetch-jurisdiction-sources.sh`); built
the same day. The 2026 gazetteer files are pipe-delimited.

```
6a99ca00efbc0be5112e225d4102704c51d5ce3b16e3afd6e4159460595fd12a  2026_Gaz_counties_national.zip
9d528b39b70a27075c863b1572f27eadaf24484d5435fac17fc3b4cdd36434c2  2026_Gaz_cousubs_national.zip
04f9d99cd81acbc64a038301b836cc0d0dd7e5223008bec14c9ef899a538e232  2026_Gaz_elsd_national.zip
af678e2d990827c89ee39b98c82de6e90b693c7361ff0e559ae3076670dd2863  2026_Gaz_place_national.zip
ab7661ce389993b2172b9f3ad33a6690c7cb59c46d1c895464f1565bfe82b3c8  2026_Gaz_scsd_national.zip
54352ca34f869b4deca03a65da72cccb8e9f0c2702340061949b63c76c63f852  2026_Gaz_state_national.zip
7b09ce31aa58ba882da4e05283386f242da2a39a40cc078ea530101855debd4b  2026_Gaz_unsd_national.zip
0c9bb040b1cded73b77541cab8acae7b5851ff9c257ad97a1094c0d8adfab9c1  2026_Gaz_counties_national.txt
6d19c4e9e7a8b24856528851064ccccb7b04be0404d2854d3c488a702312225c  2026_Gaz_cousubs_national.txt
34e05394cd4b8c293dd08ee575139a3b8aa76ddf1a5f27655dc55eef9cfabf62  2026_Gaz_elsd_national.txt
e10cb8004732684fa2a75b9d6030c6c9171674d6b112cff29dbc1bc31a9b82fa  2026_Gaz_place_national.txt
b4a45296715f4aad38e28eed76cdd742c556abd503219fe54c29601a76c29f35  2026_Gaz_scsd_national.txt
f2b074b5f21b76a8b26a38a9abe447b4a5c87ea255e318401938e0aaf0a770ec  2026_Gaz_state_national.txt
7d1801866af4399f1c4e32e7e02982cec460d63c161297b317219a12ccba563f  2026_Gaz_unsd_national.txt
f1297a1d2dbe1f1b691a9ebeb0cff3808228a466d95b3d13336a4e55a9f53388  country-us.csv
```

## The built list

`us-jurisdictions.csv`: **38,858 rows**, sha256
`4e607b8b1ddd559e0aef4993d76d92ba2568e0a6bb6b14c1d7647de0cb4f0fab`
(in `us-jurisdictions.sha256`; the loader refuses any other file). Rebuilt
2026-10-14 (sign-in slice) from the same source files, adding the
consolidated city-counties below; the build before that, `d9e1d109…`, is
reproduced exactly by the build without `consolidated.csv`.

| type | rows |
|---|---|
| state (50 + DC) | 51 |
| county (counties, parishes) | 3,034 |
| city_county (consolidated city-county governments, below) | 28 |
| borough (Alaska's, and PA/NJ borough places) | 1,231 |
| city | 10,158 |
| town (places, and New England / NY / WI town subdivisions) | 7,650 |
| village | 3,684 |
| cdp | 74 |
| school_district | 12,948 |

**OCD id formats, confirmed from `country-us.csv`:** a county
`ocd-division/country:us/state:va/county:floyd` (census_geoid `place-51063`);
a town `ocd-division/country:us/state:va/place:floyd` (`place-5128544`); a
school district sits under its county,
`ocd-division/country:us/state:va/county:floyd/school_district:floyd_co_pblc_schs`
(`5101350`); a New England town is a place with its county-subdivision GEOID
(`…/state:ma/place:brookline`, `place-2502109175`); a state
`ocd-division/country:us/state:va` (no GEOID; matched by postal code); DC
`ocd-division/country:us/district:dc` (`…/state:dc` is an alias, `sameAs`,
and alias rows are skipped).

**Left out, and why** (the build prints this; `--report` lists every row):
12,483 census-designated places — the OCD list has no ids for them (only 74
CDPs have one), and no id is invented; 179 towns, 71 cities, 23 villages, 3
boroughs and 331 school districts with no current OCD id for their GEOID
(some because the OCD row for them is an alias, `sameAs` another id); one
county, Oglala Lakota County, SD, whose OCD row still carries its pre-2015
GEOID (`place-46113`, the Census now says 46102) — a GEOID-change map in the
build would bring it in; Puerto Rico's municipios; Alaska's census areas,
Connecticut's planning regions and the independent cities' county-file rows
(their place rows are in); county subdivisions that are not active towns;
inactive, fictitious and "(balance)" places.

## Consolidated city-counties (2026-10-14)

`consolidated.csv` (committed, hand-checked) lists the consolidated city-county
governments the picker offers as one place: San Francisco, Philadelphia,
Denver, Honolulu, Nashville-Davidson, Louisville-Jefferson,
Indianapolis-Marion and 21 more. The build turns each county's row into a
`city_county` row named as the government names itself; the county's OCD id
and GEOID are kept, so a hub already linked to the county is unchanged and its
jurisdiction code stays the same. The picker finds these under City and under
County, and under their own type.

Each row says why it is there (the `evidence` column), from the two source
files above:
- the OCD list marks the city's id as an alias (`sameAs`) of the county's, with
  a note "coterminous and consolidated gov" (San Francisco, Denver, Broomfield,
  Honolulu, Columbus-Muscogee, Lexington-Fayette, New Orleans, Nantucket,
  Anaconda-Deer Lodge, Lynchburg-Moore);
- the Census place file lists the consolidated government itself: a
  "(balance)" row (Nashville-Davidson, Louisville-Jefferson, Indianapolis,
  Athens-Clarke, Augusta-Richmond, Butte-Silver Bow, Greeley County), a
  unified or metropolitan government LSAD (the three small Georgia unified
  governments, Macon-Bibb, Hartsville-Trousdale), or a city with no
  government of its own or one partly consolidated (Houma, Baton Rouge,
  Lafayette);
- three are **hand-added**, flagged by neither file: Philadelphia (1854),
  Jacksonville-Duval (1968) and Kansas City-Wyandotte (1997).

Left out on purpose: New York City (five counties, not one), Alaska's city-
boroughs (already single `borough` rows), Virginia's and others' independent
cities (already `city` rows), and Echols County-Statenville, GA, which neither
file confirms.

After a change to the list, the release loads it: `scripts/release.sh` sees the
checksum differ from the one live and runs the loader (RUNBOOK-release.md).

