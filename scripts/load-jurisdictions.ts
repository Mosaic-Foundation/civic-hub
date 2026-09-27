/**
 * Load the jurisdiction reference list into a database. Idempotent; any
 * install, plain Postgres included.
 *
 *   node --env-file=<file with CIVIC_TARGET_DATABASE_URL> --import tsx \
 *     scripts/load-jurisdictions.ts [--dry-run] [--force]
 *
 * Reads the committed config/jurisdictions/us-jurisdictions.csv (built from
 * the Census gazetteer and the OCD division ids by
 * scripts/build-jurisdictions.ts; sources in config/jurisdictions/SOURCES.md)
 * and refuses it unless its sha256 matches us-jurisdictions.sha256 beside it.
 *
 * Then, in one transaction, as the table's owner (the app's roles cannot
 * write it; 20260927000000):
 *   - every row is upserted by OCD id (changed rows updated, others untouched);
 *   - a row no longer in the file is deleted, unless a hub points at it — that
 *     one is kept and named, for the operator to relink;
 *   - the table's comment records the file's checksum and row count.
 * A second run with the same file finds the checksum in the comment and does
 * nothing (--force loads anyway).
 *
 * The URL comes from the env file, never the command line (ADR-005).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectFromEnv, ImportRefused } from "./lib/hubImport.js";
import { parseCsvObjects } from "./lib/csv.js";

const ROOT = resolve(import.meta.dirname, "..");
const FILE = resolve(ROOT, "config/jurisdictions/us-jurisdictions.csv");
const SUM = resolve(ROOT, "config/jurisdictions/us-jurisdictions.sha256");
const COLUMNS = ["ocd_id", "census_geoid", "state", "type", "official_name", "display_name"] as const;
const TYPES = new Set(["state", "county", "city", "town", "village", "borough", "cdp", "school_district"]);

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");

type Row = Record<(typeof COLUMNS)[number], string>;

/** Every row well-formed, ids unique. Throws listing the first problems. */
function validateRows(rows: Array<Record<string, string>>): Row[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = `line ${i + 2}`;
    for (const c of COLUMNS) if (!r[c]) problems.push(`${at}: ${c} is empty`);
    if (r.ocd_id && !r.ocd_id.startsWith("ocd-division/country:us")) problems.push(`${at}: ${r.ocd_id} is not a US OCD id`);
    if (r.state && !/^[a-z]{2}$/.test(r.state)) problems.push(`${at}: state "${r.state}"`);
    if (r.type && !TYPES.has(r.type)) problems.push(`${at}: type "${r.type}"`);
    if (seen.has(r.ocd_id)) problems.push(`${at}: ${r.ocd_id} appears twice`);
    seen.add(r.ocd_id);
  });
  if (problems.length) throw new ImportRefused(`${FILE} has ${problems.length} problem(s).`, problems.slice(0, 20));
  return rows as Row[];
}

async function main(): Promise<void> {
  const bytes = await readFile(FILE);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const expected = (await readFile(SUM, "utf8")).trim().split(/\s+/)[0];
  if (sha !== expected) {
    throw new ImportRefused(`Checksum mismatch: ${FILE} is ${sha}, us-jurisdictions.sha256 says ${expected}. Rebuild, or restore the file from git.`);
  }
  const rows = validateRows(parseCsvObjects(bytes.toString("utf8")));
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  console.log(`load-jurisdictions: ${rows.length} rows, sha256 ${sha}`);
  console.log(`  ${Object.entries(byType).sort().map(([t, n]) => `${t} ${n}`).join(", ")}`);

  const client = await connectFromEnv("CIVIC_TARGET_DATABASE_URL");
  try {
    const exists = await client.query("select to_regclass('public.jurisdictions') as t");
    if (!exists.rows[0].t) throw new ImportRefused("The target has no jurisdictions table. Apply migration 20260927000000 first.");
    const comment = await client.query("select obj_description('public.jurisdictions'::regclass, 'pg_class') as c");
    const count = await client.query<{ n: number }>("select count(*)::int as n from jurisdictions");
    const marker = `sha256=${sha}`;
    if (!FORCE && String(comment.rows[0].c ?? "").includes(marker) && count.rows[0].n === rows.length) {
      console.log(`  already loaded (${count.rows[0].n} rows, same checksum). Nothing to do.`);
      return;
    }

    await client.query("begin");
    await client.query("create temp table incoming (like jurisdictions) on commit drop");
    for (let i = 0; i < rows.length; i += 5000) {
      await client.query("insert into incoming select * from jsonb_populate_recordset(null::jurisdictions, $1::jsonb)", [
        JSON.stringify(rows.slice(i, i + 5000)),
      ]);
    }
    const ins = await client.query(`
      insert into jurisdictions select * from incoming
      on conflict (ocd_id) do update set
        census_geoid = excluded.census_geoid, state = excluded.state, type = excluded.type,
        official_name = excluded.official_name, display_name = excluded.display_name
      where (jurisdictions.census_geoid, jurisdictions.state, jurisdictions.type, jurisdictions.official_name, jurisdictions.display_name)
        is distinct from (excluded.census_geoid, excluded.state, excluded.type, excluded.official_name, excluded.display_name)`);
    const kept = await client.query<{ ocd_id: string; hubs: string }>(`
      select j.ocd_id, string_agg(h.id, ', ' order by h.id) as hubs
        from jurisdictions j join hubs h on h.jurisdiction_ocd_id = j.ocd_id
       where not exists (select 1 from incoming i where i.ocd_id = j.ocd_id)
       group by j.ocd_id`);
    const del = await client.query(`
      delete from jurisdictions j
       where not exists (select 1 from incoming i where i.ocd_id = j.ocd_id)
         and not exists (select 1 from hubs h where h.jurisdiction_ocd_id = j.ocd_id)`);
    const note =
      `Reference list: US jurisdictions by OCD division id. Loaded by scripts/load-jurisdictions.ts; read-only to the app. Not hub data. ` +
      `${marker}; rows=${rows.length}; loaded ${new Date().toISOString()}`;
    await client.query(`comment on table jurisdictions is ${client.escapeLiteral(note)}`);

    console.log(`  upserted ${ins.rowCount} new or changed, deleted ${del.rowCount} no longer listed`);
    for (const k of kept.rows) console.log(`  KEPT ${k.ocd_id}: no longer listed, but hub(s) ${k.hubs} point at it. Relink them.`);
    if (DRY) {
      await client.query("rollback");
      console.log("  --dry-run: rolled back, nothing written.");
    } else {
      await client.query("commit");
      const after = await client.query<{ n: number }>("select count(*)::int as n from jurisdictions");
      console.log(`  jurisdictions now holds ${after.rows[0].n} rows.`);
    }
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`load-jurisdictions: ${err instanceof Error ? err.message : String(err)}`);
  for (const p of (err as { problems?: string[] }).problems ?? []) console.error(`  - ${p}`);
  process.exit(err instanceof ImportRefused ? 2 : 1);
});
