/**
 * Restore ONE hub from its export bundle, in place, without touching any
 * other hub. RUNBOOK-restore-hub.md is the procedure; this is its tool.
 *
 *   node --env-file=<target env> --import tsx scripts/restore-hub.ts <bundle> --hub <slug> \
 *     [--clear-append-only] [--no-images] [--actor <email>] [--dry-run]
 *
 * Env file: the same CIVIC_TARGET_* names as scripts/import-hub.ts.
 *
 * In one transaction: every row of the hub's exported tables is deleted, the
 * bundle's rows are loaded, counts and the content fingerprint are re-read
 * and compared with the bundle's, and a `hub.restore` row (rows before,
 * bundle and rows after) is written to control_audit_log. Any failure rolls
 * all of it back. The `hubs` row is kept as it is on the target (the console
 * owns it); `sessions` go with the hub's users, so its residents sign in
 * again. Images are uploaded under the hub's prefix, overwriting same keys.
 *
 * `events` and `review_turns` are append-only: their triggers refuse DELETE.
 * Clearing them is refused unless --clear-append-only is given, and then the
 * triggers are suspended for those two DELETE statements only. This script
 * is the only place that bypass exists.
 *
 * Stops, changing nothing, if the hub does not exist, the bundle is for
 * another hub, a row the bundle brings collides with ANOTHER hub's key, or
 * the bundle fails its own checks.
 */

import { userInfo } from "node:os";
import { hubArg } from "./lib/hubScope.js";
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
  const hubId = hubArg(argv);
  const path = argv.find((a, i) => !a.startsWith("--") && !["--hub", "--actor"].includes(argv[i - 1] ?? ""));
  if (!path) {
    console.error("usage: restore-hub.ts <bundle> --hub <slug> [--clear-append-only] [--no-images] [--actor <email>] [--dry-run]");
    process.exit(2);
  }
  const { name, files } = await readBundleFiles(path);
  const bundle = checkBundle(name, files);
  if (bundle.manifest.hub_id !== hubId) {
    console.error(`restore-hub: the bundle is hub "${bundle.manifest.hub_id}", not "${hubId}". Nothing changed.`);
    process.exit(2);
  }
  const noImages = has("--no-images");
  const opts = {
    mode: "restore" as const,
    storage: noImages ? null : targetStorageFromEnv(),
    noImages,
    clearAppendOnly: has("--clear-append-only"),
    actor: value("--actor") ?? `script:restore-hub (${userInfo().username})`,
  };

  const client = await connectFromEnv("CIVIC_TARGET_DATABASE_URL");
  try {
    const plan = await planImport(client, bundle, opts);
    const now = Object.entries(plan.existing).filter(([, n]) => n > 0);
    console.log(`[restore-hub] ${hubId}: will clear ${now.map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}`);
    console.log(`[restore-hub] and load ${[...plan.rows.values()].reduce((n, r) => n + r.length, 0)} rows, ${plan.imageUploads.length} images from ${name}`);
    if (has("--dry-run")) {
      console.log("[restore-hub] dry run: every check passed, nothing written.");
      return;
    }
    const result = await applyImport(client, bundle, plan, opts);
    console.log(`[restore-hub] done. fingerprint ${result.fingerprint} (matches the bundle), audit row written.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`restore-hub: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof ImportRefused) for (const p of err.problems) console.error(`  - ${p}`);
  process.exit(1);
});
