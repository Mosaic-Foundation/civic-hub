// The configured packages this checkout runs whose catalog entry is not
// approved on a deployment (engine 2, E15). READ-ONLY: one SELECT.
//
//   node --env-file=<file naming CIVIC_TARGET_DATABASE_URL> --import tsx scripts/catalog-unapproved.ts
//
// Prints one line per package@version that is pending, withdrawn or has no
// entry at all, as `name@version status`; nothing when every one is approved.
// scripts/release.sh asks it before pushing code to production: code whose
// package is not approved there mounts nothing for that package (on Oct 27
// production ran three minutes with no plugins because the release trusted a
// "y" at "Approved in the console, push the code?").

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Wanted {
  name: string;
  version: string;
}

/** The packages config/plugins.json lists, each with the version its package.json says. */
export function wantedPackages(root = ROOT): Wanted[] {
  const list = JSON.parse(readFileSync(join(root, "config/plugins.json"), "utf8")) as { packages: string[] };
  return list.packages.map((dir) => {
    const pj = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as { name: string; version: string };
    return { name: pj.name, version: pj.version };
  });
}

/** Each wanted package whose entry is not approved, with what it is instead ("pending", "withdrawn", "missing"). */
export function unapproved(
  wanted: readonly Wanted[],
  rows: ReadonlyArray<{ package: string; version: string; status: string }>,
): Array<Wanted & { status: string }> {
  return wanted.flatMap((w) => {
    const row = rows.find((r) => r.package === w.name && r.version === w.version);
    return row?.status === "approved" ? [] : [{ ...w, status: row?.status ?? "missing" }];
  });
}

async function main(): Promise<void> {
  const url = process.env.CIVIC_TARGET_DATABASE_URL?.trim();
  if (!url) throw new Error("catalog-unapproved: CIVIC_TARGET_DATABASE_URL is not set (pass the deployment's env file)");
  const wanted = wantedPackages();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ package: string; version: string; status: string }>(
      "select package, version, status from plugin_catalog where package = any($1::text[])",
      [wanted.map((w) => w.name)],
    );
    for (const u of unapproved(wanted, rows)) console.log(`${u.name}@${u.version} ${u.status}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
