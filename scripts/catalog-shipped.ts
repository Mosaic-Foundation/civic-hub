// npx tsx scripts/catalog-shipped.ts --ran-at <ISO time of the conformance run> --commit <sha>
//
// Writes supabase/migrations/20261025000200_shipped_plugins.sql (plugin
// session 1, ADR-014): the packages the hub ships with, as catalog entries
// already approved (Adam's decision: the shipped types are pre-approved), and
// every existing hub's install of each, so nothing changes for anyone:
//   - one plugin_catalog row per configured package, status 'approved', with
//     the content hash of its files as they are in this checkout, its grant,
//     and the conformance run that passed for it (--ran-at, --commit);
//   - every hub gets an install row per package (installed_by
//     'system:shipped'), stamped removed where the hub has the plugin switched
//     off, as the follow-the-switch trigger would have.
// Additive and idempotent: ON CONFLICT DO NOTHING throughout.
//
// Run once, when the shipped packages' files are final for the release. A
// change to a package after that is a new catalog entry (npm run catalog:add).

import { writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashPackage } from "../src/plugins/hash.js";
import type { PluginPackage } from "../src/plugins/package.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "supabase/migrations/20261025000200_shipped_plugins.sql";
const APPROVER = "Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error(`catalog-shipped: needs ${name}`);
    process.exit(2);
  }
  return v;
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const ranAt = arg("--ran-at");
  const commit = arg("--commit");
  const { loadedPackages } = await import(pathToFileURL(join(ROOT, "src/plugins/loader.ts")).href);
  const pkgs = loadedPackages() as Array<{ dir: string; pkg: PluginPackage; type: string; plugin: string }>;
  const rows = pkgs.map((p) => {
    const m = p.pkg.manifest;
    const walked = m.descriptor.creation.resident !== null || m.descriptor.creation.admin;
    const conformance = { result: "passed", ran_at: ranAt, commit, walked };
    return (
      `  (${lit(p.pkg.name)}, ${lit(p.pkg.version)}, ${lit(hashPackage(join(ROOT, p.dir)))}, ${lit(p.pkg.displayName)}, ` +
      `${lit(p.plugin)}, ${lit(p.type)},\n   ${lit(JSON.stringify(m.capabilities))}::jsonb,\n   ${lit(JSON.stringify(conformance))}::jsonb,\n` +
      `   'approved', ${lit(APPROVER)}, ${lit(ranAt)}::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).')`
    );
  });
  const sql =
    `-- The plugin packages the hub ships with, pre-approved, and installed on every
-- existing hub (plugin session 1, ADR-014). Written by scripts/catalog-shipped.ts
-- from ${commit}. Additive and idempotent.
--
-- Each row records the content hash of the package's files as shipped; the
-- loader mounts a package only when an approved row records its hash, so a
-- later change to a package is a new entry (npm run catalog:add) that the
-- operator approves in the console.

INSERT INTO plugin_catalog
  (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, approved_by, approved_at, notes)
VALUES
${rows.join(",\n")}
ON CONFLICT (package, version, hash) DO NOTHING;

-- Every existing hub has every shipped package installed, as it had every
-- process type before packages: the record of it.
DO $$
DECLARE h text;
BEGIN
  FOR h IN SELECT id FROM hubs ORDER BY id LOOP
    PERFORM public._civic_install_approved_plugins(h, 'system:shipped');
  END LOOP;
END $$;

-- Where a hub has a plugin switched off, its record says so (the switch
-- stays the gate; 20261025000100 keeps the two equal from now on).
UPDATE hub_plugins hp
   SET removed_at = now(), removed_by = 'system:shipped'
  FROM hub_settings s
 WHERE s.hub_id = hp.hub_id
   AND s.key = 'plugin.' || hp.plugin || '.enabled'
   AND lower(btrim(s.value)) IN ('false', '0', 'off', 'no')
   AND hp.removed_at IS NULL
   AND hp.installed_by = 'system:shipped';
`;
  writeFileSync(join(ROOT, FILE), sql);
  console.log(`catalog-shipped: wrote ${FILE} (${rows.length} packages)`);
}

await main();
