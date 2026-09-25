// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hubs itself.
/**
 * Put the dev project's own hubs back after it has been refreshed from a
 * production dump (RUNBOOK-cutover.md → "Rehearsal: refresh dev").
 *
 *   npx tsx scripts/dev-refresh-reseed.ts [--snapshot <file.json>] [--dry-run]
 *
 * WHY. A refresh replaces dev's `public` schema with production's, so after
 * the migrations run dev holds exactly one hub, Floyd, with production's
 * hostname and identity. Three things are then wrong for dev, and this puts
 * each one right:
 *
 *   1. Floyd's row names `floyd.civic.social`. On dev it must name dev's own
 *      host, or the resolver never picks it and — worse — activities emitted
 *      from dev would claim production's `did:web`. Mode stays `beta`: a hub
 *      that is not `live` mails only its admin roster and allow list, which is
 *      what keeps real beta testers (now present on dev) from getting mail
 *      from the dev deployment.
 *   2. Athens is gone. It is a `demo` hub, and demo can only be set in the
 *      INSERT (a trigger refuses any later move into it), which is why
 *      `create-hub.ts` will not make one; it is inserted here the way
 *      supabase/seed.sql inserts it locally, then its settings come from
 *      `seed-hub-settings.ts --hub athens`.
 *   3. Utopia is gone. It is re-created with `create-hub.ts`, unchanged.
 *
 * With `--snapshot`, hub_settings rows saved before the refresh (JSON:
 * `{ "hub_settings": [{ hub_id, key, value }] }`) are upserted afterwards, so
 * whatever an admin had edited on Athens or Utopia through the UI comes back.
 * Floyd rows in a snapshot are ignored: Floyd's settings are production's now,
 * seeded by the cutover step, and a dev snapshot must not overwrite them.
 *
 * Dev accounts (the Utopia admin, `+athens` sign-ins) are NOT re-seeded: a
 * user row is created on first sign-in, and nothing else refers to them.
 *
 * IDEMPOTENT: a hub that already exists is left alone. REFUSES production.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getDb } from "../src/db/client.js";

const PRODUCTION_REF = "nfhyypwoporfggqcerli";

/** Dev's three hosts on the `civic-hub-dev` Vercel project (DEPLOY-dev.md). */
const DEV = {
  floyd: "civic-hub-dev.vercel.app",
  athens: "athens-civic-hub-dev.vercel.app",
  utopia: "utopia-civic-hub-dev.vercel.app",
} as const;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const snapshotPath = (() => {
  const i = args.indexOf("--snapshot");
  return i >= 0 ? args[i + 1] : undefined;
})();

function run(script: string, scriptArgs: string[]): void {
  const full = ["tsx", `scripts/${script}`, ...scriptArgs, ...(DRY_RUN ? ["--dry-run"] : [])];
  console.log(`\n$ npx ${full.join(" ")}`);
  const r = spawnSync("npx", full, { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

async function main(): Promise<void> {
  const ref = (process.env.SUPABASE_URL ?? "").replace(/^https:\/\/([^.]+).*/, "$1");
  if (!ref) throw new Error("SUPABASE_URL is unset.");
  if (ref === PRODUCTION_REF) {
    throw new Error("Refusing: SUPABASE_URL points at production. This script is for dev only.");
  }
  console.log(`project: ${ref}${DRY_RUN ? "  (dry run: nothing written)" : ""}`);

  const db = getDb();
  const { data: hubs, error } = await db.from("hubs").select("id, hostname, mode");
  if (error) throw new Error(`hubs: ${error.message}`);
  const have = new Map((hubs ?? []).map((h) => [h.id as string, h]));

  // 1. Floyd: dev's hostname and identity, beta.
  const floyd = have.get("floyd");
  if (!floyd) throw new Error("No floyd row — have the migrations run on this copy?");
  const floydPatch = { hostname: DEV.floyd, space_did: `did:web:${DEV.floyd}`, mode: "beta" };
  console.log(`\nfloyd: ${floyd.hostname} (${floyd.mode}) -> ${floydPatch.hostname} (beta)`);
  if (!DRY_RUN) {
    const { error: e } = await db.from("hubs").update(floydPatch).eq("id", "floyd");
    if (e) throw new Error(`floyd update: ${e.message}`);
  }

  // 2. Athens: demo, set in the INSERT because it cannot be set later.
  if (have.has("athens")) {
    console.log("\nathens: exists, left alone");
  } else {
    const row = {
      id: "athens",
      protocol_hub_id: "civic-hub-athens",
      hostname: DEV.athens,
      name: "Athens Civic Hub",
      jurisdiction_code: "us-va-athens",
      jurisdiction_name: "Athens, Virginia",
      space_did: `did:web:${DEV.athens}`,
      mode: "demo",
    };
    console.log(`\nathens: insert ${JSON.stringify(row)}`);
    if (!DRY_RUN) {
      const { error: e } = await db.from("hubs").insert(row);
      if (e) throw new Error(`athens insert: ${e.message}`);
    }
    run("seed-hub-settings.ts", ["--hub", "athens"]);
  }

  // 3. Utopia: exactly as it was first made.
  if (have.has("utopia")) {
    console.log("\nutopia: exists, left alone");
  } else {
    run("create-hub.ts", [
      "--id", "utopia",
      "--hostname", DEV.utopia,
      "--name", "Utopia Civic Hub",
      "--jurisdiction", "Utopia, California",
      "--mode", "beta",
    ]);
  }

  // 4. Admin edits saved before the refresh, for the non-Floyd hubs.
  if (snapshotPath) {
    const snap = JSON.parse(readFileSync(snapshotPath, "utf-8")) as {
      hub_settings?: Array<{ hub_id: string; key: string; value: string }>;
    };
    const rows = (snap.hub_settings ?? [])
      .filter((r) => r.hub_id !== "floyd")
      .map((r) => ({ hub_id: r.hub_id, key: r.key, value: r.value, updated_by: "dev-refresh-reseed" }));
    console.log(`\nsnapshot: ${rows.length} settings rows for ${[...new Set(rows.map((r) => r.hub_id))].join(", ") || "no hubs"}`);
    if (!DRY_RUN && rows.length > 0) {
      const { error: e } = await db.from("hub_settings").upsert(rows, { onConflict: "hub_id,key" });
      if (e) throw new Error(`snapshot upsert: ${e.message}`);
    }
  }

  console.log("\nDone. Check: select id, hostname, mode from hubs order by id;\n");
}

main().catch((e) => {
  console.error(`\ndev-refresh-reseed failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
