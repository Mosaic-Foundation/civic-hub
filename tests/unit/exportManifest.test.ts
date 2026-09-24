// The export manifest must name exactly the tables that carry hub_id.
//
// The unit layer has no database, so the schema is read from the migrations:
// every CREATE TABLE (less any DROP or RENAME), and every way hub_id has been
// added — a column in CREATE TABLE, `ALTER TABLE … ADD COLUMN hub_id`, or a
// DO block that loops an ARRAY of table names through an `ADD COLUMN … hub_id`
// (20260924010000). A migration that adds a hub-scoped table without adding
// it to EXPORT_MANIFEST fails here; so does a manifest entry for a table that
// does not exist.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPORT_MANIFEST } from "../../src/db/schemaContract.js";
import { HUB_TABLES } from "../../src/db/forHub.js";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Tables and hub_id columns as the migrations leave them, in file order. */
function schemaFromMigrations(): { tables: Set<string>; withHubId: Set<string> } {
  const tables = new Set<string>();
  const withHubId = new Set<string>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));

    // DO blocks first, then remove them so their dynamic SQL is not read twice.
    const body = sql.replace(/DO\s+\$\$([\s\S]*?)\$\$\s*;/gi, (_m, block: string) => {
      if (/ADD COLUMN[^;]*hub_id/i.test(block)) {
        for (const arr of block.matchAll(/ARRAY\s*\[([\s\S]*?)\]/gi)) {
          for (const name of arr[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)) {
            withHubId.add(name[1].toLowerCase());
          }
        }
      }
      return "";
    });

    for (const m of body.matchAll(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/gi,
    )) {
      const table = m[1].toLowerCase();
      tables.add(table);
      if (/(^|[\s,(])hub_id\s+text/i.test(m[2])) withHubId.add(table);
    }
    for (const m of body.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      tables.delete(m[1].toLowerCase());
      withHubId.delete(m[1].toLowerCase());
    }
    for (const m of body.matchAll(/ALTER TABLE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+RENAME TO\s+([a-z_][a-z0-9_]*)/gi)) {
      const [from, to] = [m[1].toLowerCase(), m[2].toLowerCase()];
      if (tables.delete(from)) tables.add(to);
      if (withHubId.delete(from)) withHubId.add(to);
    }
    for (const m of body.matchAll(
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?hub_id\b/gi,
    )) {
      withHubId.add(m[1].toLowerCase());
    }
  }
  return { tables, withHubId };
}

const schema = schemaFromMigrations();
const manifest = EXPORT_MANIFEST.map((e) => e.table);

describe("export manifest", () => {
  it("reads the schema it is checked against (31 tables, 30 with hub_id)", () => {
    // If this moves, a table was added or dropped: expected, but look at the
    // manifest in the same change.
    expect(schema.tables.size).toBe(31);
    expect(schema.withHubId.size).toBe(30);
    expect(schema.tables.has("hubs")).toBe(true);
    expect(schema.withHubId.has("hubs")).toBe(false);
  });

  it("names every table that carries hub_id", () => {
    const missing = [...schema.withHubId].filter((t) => !manifest.includes(t)).sort();
    expect(missing, "tables with hub_id missing from EXPORT_MANIFEST").toEqual([]);
  });

  it("names no table that does not exist, or has no hub_id", () => {
    const unknown = manifest.filter((t) => !schema.tables.has(t));
    const unscoped = manifest.filter((t) => schema.tables.has(t) && !schema.withHubId.has(t));
    expect(unknown, "manifest tables that do not exist").toEqual([]);
    expect(unscoped, "manifest tables without hub_id").toEqual([]);
  });

  it("lists each table once, and every omission says why", () => {
    expect(new Set(manifest).size).toBe(manifest.length);
    for (const e of EXPORT_MANIFEST) {
      if (e.rows === "omit") expect(e.reason, e.table).toBeTruthy();
    }
  });

  it("covers exactly the tables forHub() can reach", () => {
    expect([...manifest].sort()).toEqual([...HUB_TABLES].sort());
  });
});
