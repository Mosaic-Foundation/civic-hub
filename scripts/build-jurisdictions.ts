/**
 * Build the committed jurisdiction list from its raw sources. Run by hand
 * when the sources change; the output is committed and loaded on every
 * install by scripts/load-jurisdictions.ts.
 *
 *   ./scripts/fetch-jurisdiction-sources.sh        # downloads (network; by hand)
 *   npx tsx scripts/build-jurisdictions.ts [--report]
 *
 * IN (config/jurisdictions/sources/, gitignored; versions and checksums in
 * config/jurisdictions/SOURCES.md):
 *   2026_Gaz_{state,counties,place,cousubs,unsd,elsd,scsd}_national.txt
 *       Census Bureau Gazetteer, tab-delimited: names, GEOIDs, LSAD and
 *       functional status. A US government work: public domain in the US.
 *   country-us.csv
 *       opencivicdata/ocd-division-ids at a pinned commit: every OCD division
 *       id with its census_geoid. CC0 1.0.
 *
 * OUT (committed):
 *   config/jurisdictions/us-jurisdictions.csv     ocd_id,census_geoid,state,type,official_name,display_name
 *   config/jurisdictions/us-jurisdictions.sha256  its checksum, which the loader checks
 *
 * THE JOIN. A gazetteer row is kept only when the OCD list has a current
 * (no validThrough) division with the same Census GEOID and a matching kind
 * of segment (county/parish/borough for a county, place for a place,
 * school_district for a school district). Nothing gets an invented OCD id: an
 * unmatched row is left out and counted (--report lists them).
 *
 * WHAT IS IN, by the gazetteer's own words (the name's last word, and the
 * functional status: A = active government, S = statistical):
 *   state            the 50 states and DC (state file)
 *   county           "… County", "… Parish" (counties file)
 *   borough          Alaska's "… Borough", "… City and Borough",
 *                    "… Municipality" (counties file); "… borough" places
 *   city/town/village  places named "… city", "… town", "… village", status A
 *   cdp              places named "… CDP", status S
 *   town             county subdivisions named "… town", status A (New
 *                    England, New York and Wisconsin towns are governments)
 *   school_district  unified, elementary and secondary school districts
 * OUT: census areas, independent cities in the counties file (their place
 * row covers them), consolidated/metro governments' "(balance)" rows,
 * townships, territories, and anything inactive or fictitious.
 *
 * DISPLAY NAMES (Adam, 2026-09-27): "Floyd town" → "Town of Floyd, Virginia";
 * city, village and borough places the same ("City of …", "Village of …",
 * "Borough of …"); a CDP drops its suffix ("Merrifield, Virginia"); counties,
 * Alaska boroughs and school districts keep the Census name and add the
 * state ("Floyd County, Virginia"); a state is its name.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv, parseCsvObjects, toCsv } from "./lib/csv.js";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "config/jurisdictions/sources");
const OUT = resolve(ROOT, "config/jurisdictions/us-jurisdictions.csv");
const SUM = resolve(ROOT, "config/jurisdictions/us-jurisdictions.sha256");
const YEAR = "2026";
const REPORT = process.argv.includes("--report");

type Kind = "state" | "county" | "place" | "cousub" | "school_district";
type RefType = "state" | "county" | "city" | "town" | "village" | "borough" | "cdp" | "school_district";

interface Out {
  ocd_id: string;
  census_geoid: string;
  state: string;
  type: RefType;
  official_name: string;
  display_name: string;
}

function gazetteer(file: string): Array<Record<string, string>> {
  const path = resolve(SRC, `${YEAR}_Gaz_${file}_national.txt`);
  if (!existsSync(path)) throw new Error(`missing ${path}; run scripts/fetch-jurisdiction-sources.sh`);
  // Latin-1 in older years; decode as UTF-8 and check for replacement chars below.
  return parseCsvObjects(readFileSync(path, "utf8"), "\t").map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toUpperCase(), v.trim()])),
  );
}

// --- The OCD index: census GEOID (digits) + kind → current OCD id ----------------

/** The kind of the last segment of an OCD id: …/county:floyd → county. */
function ocdKind(id: string): Kind | null {
  const last = id.split("/").pop() ?? "";
  const t = last.split(":")[0];
  if (t === "state" || t === "district") return "state";
  if (t === "county" || t === "parish" || t === "borough" || t === "census_area") return "county";
  if (t === "place") return "place";
  if (t === "school_district") return "school_district";
  return null;
}

function buildOcdIndex(): { index: Map<string, string>; header: string[]; rows: number } {
  const path = resolve(SRC, "country-us.csv");
  if (!existsSync(path)) throw new Error(`missing ${path}; run scripts/fetch-jurisdiction-sources.sh`);
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  const col = (n: string) => header.indexOf(n);
  const iId = col("id");
  const iThrough = col("validThrough");
  const geoCols = header.map((h, i) => [h, i] as const).filter(([h]) => /^census_geoid/.test(h));
  if (iId < 0 || geoCols.length === 0) throw new Error(`country-us.csv header has no id / census_geoid: ${header.join(",")}`);
  const index = new Map<string, string>();
  for (const r of rows) {
    const id = r[iId];
    if (!id?.startsWith("ocd-division/country:us")) continue;
    if (iThrough >= 0 && r[iThrough]) continue; // historical
    const kind = ocdKind(id);
    if (!kind) continue;
    for (const [, i] of geoCols) {
      const digits = (r[i] ?? "").replace(/\D/g, "");
      if (!digits) continue;
      const key = `${kind}:${digits}`;
      // First wins: the plain census_geoid column comes before _12/_14.
      if (!index.has(key)) index.set(key, id);
    }
  }
  return { index, header, rows: rows.length };
}

// --- Names ----------------------------------------------------------------------

const STATE_NAMES = new Map<string, string>(); // "va" → "Virginia", from the state file

function placeType(name: string, funcstat: string): { type: RefType; base: string } | null {
  const m = /^(.*) (city|town|village|borough|CDP)$/.exec(name);
  if (!m) return null;
  const word = m[2];
  if (word === "CDP") return funcstat === "S" ? { type: "cdp", base: m[1] } : null;
  if (funcstat !== "A") return null;
  return { type: word as RefType, base: m[1] };
}

function displayName(type: RefType, official: string, base: string, stateName: string): string {
  switch (type) {
    case "state":
      return official;
    case "city":
    case "town":
    case "village":
    case "borough":
      // A place ("Floyd town"); a county-level borough keeps its Census name.
      return base !== official
        ? `${type[0].toUpperCase()}${type.slice(1)} of ${base}, ${stateName}`
        : `${official}, ${stateName}`;
    case "cdp":
      return `${base}, ${stateName}`;
    default:
      return `${official}, ${stateName}`;
  }
}

// --- Build ------------------------------------------------------------------------

function main(): void {
  const { index, header, rows: ocdRows } = buildOcdIndex();
  console.log(`OCD: ${ocdRows} rows, ${index.size} current ids with a census GEOID (columns: ${header.filter((h) => /census/.test(h)).join(", ")})`);

  const out: Out[] = [];
  const unmatched: Record<string, string[]> = {};
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  function add(kind: Kind, geoid: string, usps: string, type: RefType, official: string, base: string): void {
    const state = usps.toLowerCase();
    const stateName = STATE_NAMES.get(state);
    if (!stateName) return skip(`not a state or DC (${usps})`);
    const ocd = index.get(`${kind}:${geoid.replace(/\D/g, "")}`);
    if (!ocd) {
      (unmatched[type] ??= []).push(`${usps} ${geoid} ${official}`);
      return;
    }
    out.push({ ocd_id: ocd, census_geoid: geoid, state, type, official_name: official, display_name: displayName(type, official, base, stateName) });
  }

  // States (50 + DC).
  for (const r of gazetteer("state")) {
    if (r.USPS === "PR") continue;
    STATE_NAMES.set(r.USPS.toLowerCase(), r.NAME);
  }
  for (const r of gazetteer("state")) {
    if (r.USPS === "PR") continue;
    add("state", r.GEOID, r.USPS, "state", r.NAME, r.NAME);
  }

  // Counties and county equivalents.
  for (const r of gazetteer("counties")) {
    const n = r.NAME;
    let type: RefType | null = null;
    if (/ (County|Parish)$/.test(n)) type = "county";
    else if (/ (Borough|City and Borough|Municipality)$/.test(n) && r.USPS === "AK") type = "borough";
    if (!type) {
      skip(/ city$/.test(n) ? "independent city in the counties file (its place row covers it)" : `county equivalent "${n.split(" ").slice(-2).join(" ")}"`);
      continue;
    }
    add("county", r.GEOID, r.USPS, type, n, n);
  }

  // Places: cities, towns, villages, boroughs, CDPs.
  for (const r of gazetteer("place")) {
    const t = placeType(r.NAME, r.FUNCSTAT ?? "");
    if (!t) {
      skip(/\(balance\)/.test(r.NAME) ? "consolidated government (balance)" : "other place (inactive, fictitious, or another LSAD)");
      continue;
    }
    add("place", r.GEOID, r.USPS, t.type, r.NAME, t.base);
  }

  // County subdivisions that are town governments.
  for (const r of gazetteer("cousubs")) {
    const m = /^(.*) town$/.exec(r.NAME);
    if (!m || (r.FUNCSTAT ?? "") !== "A") {
      skip("county subdivision that is not an active town");
      continue;
    }
    add("place", r.GEOID, r.USPS, "town", r.NAME, m[1]);
  }

  // School districts.
  for (const f of ["unsd", "elsd", "scsd"]) {
    for (const r of gazetteer(f)) {
      if (/not defined/i.test(r.NAME)) {
        skip("school district not defined");
        continue;
      }
      add("school_district", r.GEOID, r.USPS, "school_district", r.NAME, r.NAME);
    }
  }

  // One row per OCD id: a town that is both a place and a county subdivision
  // (or matched twice) keeps its first row, which is the place's.
  const seen = new Map<string, Out>();
  let dupes = 0;
  for (const o of out) {
    if (seen.has(o.ocd_id)) dupes++;
    else seen.set(o.ocd_id, o);
  }
  const rows = [...seen.values()].sort((a, b) => a.ocd_id.localeCompare(b.ocd_id));
  const bad = rows.filter((r) => /�/.test(r.official_name));
  if (bad.length) throw new Error(`${bad.length} names did not decode as UTF-8, e.g. ${bad[0].official_name}`);

  const csv = toCsv(
    ["ocd_id", "census_geoid", "state", "type", "official_name", "display_name"],
    rows.map((r) => [r.ocd_id, r.census_geoid, r.state, r.type, r.official_name, r.display_name]),
  );
  writeFileSync(OUT, csv);
  const sha = createHash("sha256").update(csv).digest("hex");
  writeFileSync(SUM, `${sha}  us-jurisdictions.csv\n`);

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  console.log(`\nwrote ${rows.length} rows → config/jurisdictions/us-jurisdictions.csv (sha256 ${sha})`);
  console.log(`  ${Object.entries(byType).sort().map(([t, n]) => `${t} ${n}`).join(", ")}`);
  console.log(`  duplicates dropped: ${dupes}`);
  console.log(`\nleft out, by reason:`);
  for (const [why, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${why}`);
  console.log(`\nno current OCD id with that GEOID (left out, not invented):`);
  for (const [t, list] of Object.entries(unmatched)) {
    console.log(`  ${String(list.length).padStart(6)}  ${t}`);
    if (REPORT) for (const l of list) console.log(`            ${l}`);
    else for (const l of list.slice(0, 3)) console.log(`            e.g. ${l}`);
  }
}

main();
