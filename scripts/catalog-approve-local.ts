// npx tsx scripts/catalog-approve-local.ts
//
// The LOCAL stack's operator, for the plugin catalog (ADR-014): approves every
// pending catalog row whose package, version and content hash match a package
// of this checkout, so the loader mounts it on a local or CI server exactly as
// it would after the operator approved it in the console. The loader's rule is
// not relaxed: only the approver differs, and only on a local database.
//
// Refuses any database that is not on 127.0.0.1 or localhost
// (CIVIC_TEST_DATABASE_URL, default the Supabase CLI's local stack). Run by
// scripts/local-stack.sh (start, reset) and by CI after the migrations.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPackage } from "../src/plugins/hash.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APPROVER = "local stack (scripts/catalog-approve-local.ts)";

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!isLocal(DB_URL)) {
    console.error("catalog-approve-local: refusing a database that is not on 127.0.0.1 or localhost");
    process.exit(2);
  }
  const dirs = (JSON.parse(readFileSync(join(ROOT, "config/plugins.json"), "utf8")) as { packages: string[] }).packages;
  const here = dirs.map((dir) => {
    const pj = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { name: string; version: string };
    return { package: pj.name, version: pj.version, hash: hashPackage(join(ROOT, dir)) };
  });
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    let approved = 0;
    for (const p of here) {
      const r = await client.query(
        `UPDATE plugin_catalog SET status = 'approved', approved_by = $4, approved_at = now()
          WHERE status = 'pending' AND package = $1 AND version = $2 AND hash = $3`,
        [p.package, p.version, p.hash, APPROVER],
      );
      approved += r.rowCount ?? 0;
    }
    const missing = [];
    for (const p of here) {
      const r = await client.query(
        "SELECT 1 FROM plugin_catalog WHERE status = 'approved' AND package = $1 AND version = $2 AND hash = $3",
        [p.package, p.version, p.hash],
      );
      if (r.rowCount === 0) missing.push(`${p.package}@${p.version}`);
    }
    console.log(
      `catalog-approve-local: ${approved} approved; ${here.length - missing.length} of ${here.length} packages have an approved entry` +
        (missing.length ? `; not mounted until \`npm run catalog:add\` writes theirs: ${missing.join(", ")}` : ""),
    );
  } finally {
    await client.end();
  }
}

await main();
