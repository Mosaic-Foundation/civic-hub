/**
 * Create a hub: the `hubs` row plus a starter set of settings.
 *
 *   npx tsx scripts/create-hub.ts --id utopia \
 *     --hostname utopia-civic-hub-dev.vercel.app \
 *     --name "Utopia Civic Hub" --jurisdiction "Utopia, Virginia" \
 *     --mode live [--dry-run]
 *
 * WHAT THIS IS. The command-line twin of the super admin's Create hub screen
 * (Phase 5 part one, 2026-09-26). Both call createHub() in
 * src/control/hubs.ts — the same validation (slug, reserved names, hostname,
 * archived hubs' slugs and hostnames, the MEETING_* / FLOYD_NEWS_* guard) and
 * the same writes. This script only adds its own, stricter policy below.
 *
 * WHAT IT WILL NOT DO:
 *   - create a `demo` hub. Demo is the one mode that turns off email
 *     verification; a trigger on `hubs` refuses any move INTO it, and a
 *     script that could create one is the same hole with a different shape.
 *     Demo hubs come from the super admin (a platform decision) or
 *     supabase/seed.sql. See BUILD-PLAN-multi-tenant.md → Contract 1.
 *   - touch production. It refuses the production project ref outright.
 *   - overwrite an existing hub. A slug that is taken is an error, not an
 *     upsert: "create" must never silently mean "replace".
 *
 * A HUB WITHOUT AN ADMIN CANNOT BE FIXED FROM THE UI — requireAdmin fails
 * closed and every /admin route answers 503 — so the admin roster is written
 * in the same breath as the row, derived by plus-addressing this
 * deployment's own admin the way the Athens fixture does.
 */

import { createHub, planCreateHub, ControlInputError } from "../src/control/hubs.js";
import { isHubMode, type HubMode } from "../src/models/hub.js";

/** This script's policy: never demo (the console may), never production. */
const SCRIPT_MODES: readonly HubMode[] = ["beta", "live"];

const PRODUCTION_REF = "nfhyypwoporfggqcerli";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : undefined;
}

const DRY_RUN = process.argv.includes("--dry-run");
const id = flag("id");
const hostname = flag("hostname")?.toLowerCase();
const name = flag("name");
const jurisdiction = flag("jurisdiction") ?? null;
const mode = flag("mode") ?? "beta";

/** `you@example.com` -> `you+<slug>@example.com`, so the code still reaches you. */
function plusAddressed(raw: string | undefined, slug: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"))
    .map((e) => {
      const [local, domain] = e.split("@");
      return `${local.split("+")[0]}+${slug}@${domain}`;
    });
}

async function main(): Promise<void> {
  if (!id || !hostname || !name) {
    throw new Error("--id, --hostname and --name are all required.");
  }
  if (!isHubMode(mode) || mode === "demo") {
    throw new Error(
      `--mode must be beta or live (got "${mode}"). This script will not create a demo ` +
        "hub: demo turns off email verification. The super admin's Create hub can.",
    );
  }

  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.replace(/^https:\/\/([^.]+).*/, "$1");
  if (ref === PRODUCTION_REF) {
    throw new Error(
      "Refusing: SUPABASE_URL points at production. Create production hubs from the super admin.",
    );
  }

  const admins = plusAddressed(process.env.CIVIC_ADMIN_EMAILS, id);
  if (admins.length === 0) {
    throw new Error(
      "CIVIC_ADMIN_EMAILS is unset, so this hub would have no administrator " +
        "and no way to gain one through the UI. Set it and rerun.",
    );
  }

  const input = {
    slug: id,
    name,
    hostname,
    jurisdictionName: jurisdiction,
    jurisdictionCode: null,
    governingBody: null,
    admins,
    mode,
  };

  const plan = await planCreateHub(input, SCRIPT_MODES);
  console.log(`\nproject: ${ref}`);
  console.log(`hub:     ${JSON.stringify(plan.row, null, 2)}`);
  console.log(`settings:`);
  for (const [k, v] of Object.entries(plan.settings)) console.log(`  ${k.padEnd(28)} ${v}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  await createHub(input, { allowedModes: SCRIPT_MODES, updatedBy: "create-hub" });

  console.log(`\nCreated "${id}" in ${mode} mode at ${hostname}.`);
  console.log(`Admin: ${admins.join(", ")}`);
  console.log(
    `\nThe hostname still has to reach this deployment — add it as a domain ` +
      `on the Vercel project, or the resolver will never see it.\n`,
  );
}

main().catch((e) => {
  const message = e instanceof ControlInputError || e instanceof Error ? e.message : String(e);
  console.error(`\ncreate-hub failed: ${message}\n`);
  process.exit(1);
});
