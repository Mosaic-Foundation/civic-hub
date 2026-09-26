/**
 * Load a hub bundle (scripts/export-hub.ts) into another install — the
 * inverse of the export. Works on a Supabase project and on plain Postgres.
 *
 *   node --env-file=<target env> --import tsx scripts/import-hub.ts <bundle dir or .tar.gz> \
 *     [--hostname <host>] [--no-images] [--actor <email>] [--dry-run]
 *
 * The target env file (never the command line) sets:
 *   CIVIC_TARGET_DATABASE_URL        postgres://… of the target database
 *   CIVIC_TARGET_SUPABASE_URL        the target project's URL      } for images;
 *   CIVIC_TARGET_SERVICE_ROLE_KEY    its service-role key          } omit on plain
 *   CIVIC_TARGET_STORAGE_BUCKET      optional, default post-images } Postgres
 *
 * STOPS, CHANGING NOTHING, on any conflict: a hub with that id, a hostname or
 * protocol id in use (or once used by another hub), any row whose primary key
 * or unique key already exists on the target, any object key already in the
 * bucket, a target schema missing a table or column the bundle brings, or a
 * bundle that fails its own checksums. Every problem found is listed.
 *
 * Otherwise, in one transaction: the `hubs` row, every table in foreign-key
 * order, image URLs rewritten to the target's storage, the counts and the
 * content fingerprint re-read and compared with the bundle's, and a
 * `hub.import` row in control_audit_log. Images are uploaded first, under the
 * hub's prefix, and removed again if the transaction fails.
 *
 * --hostname moves the hub to a new host (e.g. athens.localhost locally).
 * --dry-run runs every check and writes nothing.
 * The running app caches the hub registry for 60 s; a new hub serves within
 * a minute (or restart the server).
 */

import { userInfo } from "node:os";
import {
  ImportRefused,
  applyImport,
  checkBundle,
  connectFromEnv,
  planImport,
  readBundleFiles,
  targetStorageFromEnv,
} from "./lib/hubImport.js";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
function value(f: string): string | undefined {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const path = argv.find((a, i) => !a.startsWith("--") && !["--hostname", "--actor"].includes(argv[i - 1] ?? ""));
  if (!path) {
    console.error("usage: import-hub.ts <bundle dir or .tar.gz> [--hostname <host>] [--no-images] [--actor <email>] [--dry-run]");
    process.exit(2);
  }
  const { name, files } = await readBundleFiles(path);
  const bundle = checkBundle(name, files);
  const noImages = has("--no-images");
  const storage = noImages ? null : targetStorageFromEnv();
  const opts = {
    mode: "import" as const,
    hostname: value("--hostname"),
    storage,
    noImages,
    actor: value("--actor") ?? `script:import-hub (${userInfo().username})`,
  };

  const client = await connectFromEnv("CIVIC_TARGET_DATABASE_URL");
  try {
    const plan = await planImport(client, bundle, opts);
    const total = [...plan.rows.values()].reduce((n, r) => n + r.length, 0);
    console.log(
      `[import-hub] ${bundle.manifest.hub_id} → ${String(plan.hubRow.hostname)}: ${total} rows, ` +
        `${plan.imageUploads.length} images; order ${plan.order.join(" → ")}` +
        (plan.deferred.length ? `; set after: ${plan.deferred.map((d) => `${d.table}.${d.columns.join(",")}`).join(" ")}` : ""),
    );
    if (has("--dry-run")) {
      console.log("[import-hub] dry run: every check passed, nothing written.");
      return;
    }
    const result = await applyImport(client, bundle, plan, opts);
    console.log(`[import-hub] done. fingerprint ${result.fingerprint} (matches the bundle), ${result.images} images, audit row written.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`import-hub: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof ImportRefused) for (const p of err.problems) console.error(`  - ${p}`);
  process.exit(1);
});
