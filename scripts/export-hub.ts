/**
 * Export one hub as a bundle: every row the export manifest names, the hub's
 * `hubs` row and settings, and every stored image it owns, with a README that
 * explains each file. Format: src/control/hubBundle/format.ts.
 *
 *   node --env-file=.env --import tsx scripts/export-hub.ts --hub athens \
 *     [--out exports] [--archive] [--no-images]
 *
 * Reads the deployment's database through SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY, as the console's "Export this hub" does. Writes
 * `<out>/civic-hub-export-<hub>-<stamp>/` (or `.tar.gz` with --archive).
 *
 * From a scratch database — a full dump restored somewhere, for the restore
 * runbook — read the rows over Postgres instead:
 *
 *   node --env-file=<file with CIVIC_SOURCE_DATABASE_URL> --import tsx \
 *     scripts/export-hub.ts --hub floyd --from-postgres
 *
 * Images then come from SUPABASE_URL's storage if the same file sets it
 * (with SUPABASE_SERVICE_ROLE_KEY); otherwise pass --no-images and the
 * manifest records that they were not included.
 *
 * Read-only: it writes nothing to any database or bucket. The output holds
 * residents' personal data; `exports/` is gitignored.
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { userInfo } from "node:os";
import { hubArg } from "./lib/hubScope.js";
import { bundleName, exportHub, memorySink, type BundleSink, type HubRowReader, type ObjectReader } from "../src/control/hubBundle/export.js";
import { supabaseObjectReader, supabaseRowReader } from "../src/control/hubBundle/supabaseReader.js";
import { packTarGz } from "../src/control/hubBundle/tar.js";
import { postImageBucket } from "../src/services/postImageStorage.js";
import { connectFromEnv, pgRowReader } from "./lib/hubImport.js";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
function value(f: string): string | undefined {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const hubId = hubArg(argv);
  const outDir = resolve(value("--out") ?? "exports");
  const archive = has("--archive");
  const noImages = has("--no-images");
  const fromPostgres = has("--from-postgres");
  const now = new Date();
  const name = bundleName(hubId, now);

  let rows: HubRowReader;
  let close = async () => {};
  if (fromPostgres) {
    const client = await connectFromEnv("CIVIC_SOURCE_DATABASE_URL");
    rows = pgRowReader(client);
    close = () => client.end();
  } else {
    rows = supabaseRowReader();
  }

  let objects: ObjectReader | null = null;
  let objectsMissingReason: string | undefined;
  if (noImages) {
    objectsMissingReason = "the export was run with --no-images";
  } else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    objects = supabaseObjectReader(postImageBucket());
  } else {
    console.error("export-hub: no storage to read images from (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Set them, or pass --no-images.");
    process.exit(2);
  }

  const mem = memorySink();
  const dirSink: BundleSink = {
    async write(path, data) {
      const full = join(outDir, name, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data);
    },
  };

  try {
    const manifest = await exportHub({
      hubId,
      rows,
      objects,
      objectsMissingReason,
      bucket: postImageBucket(),
      sink: archive ? mem : dirSink,
      exportedBy: `script:export-hub (${userInfo().username})`,
      commit: commit(),
      now,
    });

    let where = join(outDir, name);
    if (archive) {
      where = `${where}.tar.gz`;
      await mkdir(outDir, { recursive: true });
      await writeFile(where, packTarGz([...mem.files].map(([p, data]) => ({ path: `${name}/${p}`, data }))));
    }

    const total = manifest.tables.reduce((n, t) => n + t.rows, 0);
    console.log(`[export-hub] ${hubId}: ${total} rows in ${manifest.tables.length} tables, ${manifest.images.count} images (${manifest.images.bytes} bytes)`);
    for (const t of manifest.tables) if (t.rows) console.log(`  ${t.table.padEnd(26)} ${t.rows}`);
    if (manifest.excluded_settings.length) {
      console.log(`  settings left out: ${manifest.excluded_settings.map((s) => s.key).join(", ")}`);
    }
    if (manifest.images.not_included_reason) console.log(`  images NOT included: ${manifest.images.not_included_reason}`);
    console.log(`  fingerprint ${manifest.fingerprint}`);
    console.log(`  → ${where}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`export-hub: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
