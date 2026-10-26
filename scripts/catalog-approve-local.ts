// npx tsx scripts/catalog-approve-local.ts
//
// The LOCAL stack's operator, for the plugin catalog (ADR-014): approves every
// pending catalog row whose package, version and content hash match a package
// of this checkout, so the loader mounts it on a local or CI server exactly as
// it would after the operator approved it in the console. The loader's rule is
// not relaxed: only the approver differs, and only on a local database.
//
// It signs as the console does (ADR-015): every approved row not signed by the
// key in CIVIC_CATALOG_SIGNING_KEY, or by the committed test key
// (tests/fixtures/catalog/test-signing-key.pem) when that is unset. A server
// started with the same key and CIVIC_CATALOG_SIGNATURES=required mounts the
// packages on these signatures, as CI's do.
//
// Refuses any database that is not on 127.0.0.1 or localhost
// (CIVIC_TEST_DATABASE_URL, default the Supabase CLI's local stack). Run by
// scripts/local-stack.sh (start, reset) and by CI after the migrations.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPackage } from "../src/plugins/hash.js";
import { parseSigningKey, signRow } from "../src/plugins/signature.js";
import type { PluginCapabilities } from "../src/shared/pluginGrant.js";

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
    const key = parseSigningKey(
      process.env.CIVIC_CATALOG_SIGNING_KEY?.trim() || readFileSync(join(ROOT, "tests/fixtures/catalog/test-signing-key.pem"), "utf8"),
      false,
    );
    const unsigned = await client.query<{ id: string; package: string; version: string; hash: string; capabilities: PluginCapabilities }>(
      "SELECT id, package, version, hash, capabilities FROM plugin_catalog WHERE status = 'approved' AND signature_key IS DISTINCT FROM $1",
      [key.id],
    );
    for (const row of unsigned.rows) {
      const sig = signRow(row, key);
      await client.query("UPDATE plugin_catalog SET signature = $2, signature_key = $3, signed_at = now() WHERE id = $1", [row.id, sig.signature, sig.signature_key]);
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
      `catalog-approve-local: ${approved} approved, ${unsigned.rowCount ?? 0} signed (${key.id}); ${here.length - missing.length} of ${here.length} packages have an approved entry` +
        (missing.length ? `; not mounted until \`npm run catalog:add\` writes theirs: ${missing.join(", ")}` : ""),
    );
  } finally {
    await client.end();
  }
}

await main();
