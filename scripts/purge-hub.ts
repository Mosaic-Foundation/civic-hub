// @civic-raw-client-importer: operator script, run by hand; it reads storage as the service role to export and then remove the purged hub's images.
/**
 * Permanently delete a never-used hub and everything it owns, which frees
 * its slug and hostname. Operator-only; no console button (Adam, 2026-09-27).
 *
 *   node --env-file=<file> --import tsx scripts/purge-hub.ts --hub <slug>
 *       [--confirm <slug>] [--out exports] [--actor <email>] [--no-storage]
 *
 * The env file names the database and its storage:
 *   CIVIC_TARGET_DATABASE_URL        direct Postgres (the owner), as restore uses
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *                                    the same project's storage, to export and
 *                                    then remove the hub's images
 * --no-storage: a plain Postgres install with no storage (nothing to remove).
 *
 * REFUSED unless the hub is archived, has no users besides its admins and the
 * sample authors, no process or event that is not sample content, and no
 * other hub's redirect_to points at it (scripts/lib/hubPurge.ts).
 *
 * Without --confirm it only prints what it would delete. With
 * `--confirm <slug>` (the same slug, typed again) it:
 *   1. exports the hub to <out>/civic-hub-export-<slug>-<stamp>.tar.gz — kept
 *      locally, the hub's one remaining copy; exports/ is gitignored;
 *   2. in one transaction: writes the hub.purge control_audit_log row, deletes
 *      every row with its hub_id (child-first; the append-only tables with
 *      triggers suspended, as restore does), and deletes its hubs row;
 *   3. removes its stored images.
 *
 * A hostname the hub had BEFORE a hostname change stays taken (the audit
 * log remembers it); its current slug and hostname are free at once in the
 * database, and within 60 s on a running deployment (the registry cache).
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { userInfo } from "node:os";
import { hubArg } from "./lib/hubScope.js";
import { bundleName, exportHub, memorySink, ownedObjectKeys, type ObjectReader } from "../src/control/hubBundle/export.js";
import { supabaseObjectReader } from "../src/control/hubBundle/supabaseReader.js";
import { packTarGz } from "../src/control/hubBundle/tar.js";
import { postImageBucket } from "../src/services/postImageStorage.js";
import { connectFromEnv, ImportRefused, pgRowReader } from "./lib/hubImport.js";
import { applyPurge, checkPurge, planPurge, PurgeRefused } from "./lib/hubPurge.js";

const argv = process.argv.slice(2);
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
  const confirm = value("--confirm");
  const outDir = resolve(value("--out") ?? "exports");
  const noStorage = argv.includes("--no-storage");
  const actor = value("--actor") ?? `script:purge-hub (${userInfo().username})`;

  let objects: ObjectReader | null = null;
  if (!noStorage) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new PurgeRefused(
        "No storage named (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Set them for this database's project, or pass --no-storage on a plain Postgres install.",
      );
    }
    objects = supabaseObjectReader(postImageBucket());
  }

  const client = await connectFromEnv("CIVIC_TARGET_DATABASE_URL");
  try {
    if (objects) {
      // The two connections must be one database: the hub's row, read both ways.
      const { getDb } = await import("../src/db/client.js");
      const { data } = await getDb().from("hubs").select("id, created_at").eq("id", hubId).maybeSingle();
      const viaPg = await client.query("select created_at from hubs where id = $1", [hubId]);
      const a = data ? new Date(String((data as { created_at: string }).created_at)).getTime() : null;
      const b = viaPg.rows[0] ? new Date(viaPg.rows[0].created_at).getTime() : null;
      if (a !== b) {
        throw new PurgeRefused("SUPABASE_URL and CIVIC_TARGET_DATABASE_URL do not name the same database (the hub's row differs). Check the env file.");
      }
    }

    const check = await checkPurge(client, hubId);
    const hub = check.hub;
    console.log(`\npurge-hub: ${hubId} — "${String(hub.name)}" at ${String(hub.hostname)}`);
    console.log(`  created ${String(hub.created_at)}, archived ${String(hub.archived_at ?? "(not archived)")}`);
    console.log(`  users: ${check.users.admins} admin(s), ${check.users.sample} sample author(s), ${check.users.others.length} other(s)`);
    if (check.problems.length) {
      throw new PurgeRefused(`Refused: ${hubId} is not a never-used hub.`, check.problems);
    }

    const plan = await planPurge(client, hubId);
    const keys = objects ? await ownedObjectKeys(objects, hubId) : [];
    console.log("\n  Would delete, child-first:");
    for (const t of plan.order) if (plan.counts[t]) console.log(`    ${t.padEnd(26)} ${plan.counts[t]}`);
    console.log(`    ${"hubs".padEnd(26)} 1 (this hub's row: its slug and hostname become free)`);
    console.log(`    ${"stored images".padEnd(26)} ${objects ? keys.length : "(--no-storage)"}`);
    const auditRows = plan.counts.hub_admin_audit_log ?? 0;
    console.log(
      `\n  hub_admin_audit_log: ${auditRows} row(s). Append-only, so they are deleted with triggers suspended ` +
        `(the service-role path restore uses) — AFTER the export bundle has captured them; the bundle is their record.`,
    );
    console.log("  Sample content is not exported (as with every export); everything else the hub owns is.");

    if (confirm === undefined) {
      console.log(`\n  Nothing done. To purge, run again with --confirm ${hubId}`);
      return;
    }
    if (confirm !== hubId) throw new PurgeRefused(`--confirm "${confirm}" does not match --hub "${hubId}". Nothing done.`);

    // 1. The export, kept locally.
    const now = new Date();
    const name = bundleName(hubId, now);
    const mem = memorySink();
    const manifest = await exportHub({
      hubId,
      rows: pgRowReader(client),
      objects,
      objectsMissingReason: objects ? undefined : "purged with --no-storage (a plain Postgres install)",
      bucket: postImageBucket(),
      sink: mem,
      exportedBy: `${actor} (before purge)`,
      commit: commit(),
      now,
    });
    const exported = manifest.tables.find((t) => t.table === "hub_admin_audit_log")?.rows ?? 0;
    if (exported !== auditRows) {
      throw new PurgeRefused(`The export holds ${exported} hub_admin_audit_log row(s), the hub has ${auditRows}. Nothing deleted.`);
    }
    await mkdir(outDir, { recursive: true });
    const bundlePath = join(outDir, `${name}.tar.gz`);
    await writeFile(bundlePath, packTarGz([...mem.files].map(([p, data]) => ({ path: `${name}/${p}`, data }))));
    console.log(`\n  1. exported → ${bundlePath} (fingerprint ${manifest.fingerprint})`);

    // 2. The rows and the registry entry, with the audit row, in one transaction.
    const result = await applyPurge(client, hubId, plan, {
      actor,
      after: {
        bundle: bundlePath,
        fingerprint: manifest.fingerprint,
        format_version: manifest.format_version,
        rows: plan.counts,
        images: keys.length,
      },
    });
    const total = Object.values(result.deleted).reduce((n, x) => n + x, 0);
    console.log(`  2. deleted ${total} row(s) and the hub; audit row ${result.audit_id} (hub.purge)`);

    // 3. The stored images.
    if (objects && keys.length) {
      const { getDb } = await import("../src/db/client.js");
      const left: string[] = [];
      for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        const { error } = await getDb().storage.from(postImageBucket()).remove(batch);
        if (error) left.push(...batch);
      }
      if (left.length) {
        console.error(`  3. ${left.length} stored image(s) could not be removed; remove them by hand:`);
        for (const k of left) console.error(`       ${k}`);
        process.exitCode = 1;
      } else {
        console.log(`  3. removed ${keys.length} stored image(s)`);
      }
    }
    console.log(`\n  ${hubId} is purged. Its slug and hostname (${String(hub.hostname)}) are free.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  if (err instanceof PurgeRefused || err instanceof ImportRefused) {
    console.error(`\npurge-hub: ${err.message}`);
    for (const p of err.problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  console.error(`purge-hub: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
