/**
 * Create a hub: the `hubs` row plus a starter set of settings.
 *
 *   npx tsx scripts/create-hub.ts --id utopia \
 *     --hostname utopia-civic-hub-dev.vercel.app \
 *     --name "Utopia Civic Hub" --jurisdiction "Utopia, Virginia" \
 *     --mode live [--dry-run]
 *
 * WHAT THIS IS. The manual stand-in for the Phase 5 control plane, which will
 * do the same thing behind a platform admin's form. It exists because adding
 * a hub by hand is four inserts that must all agree, and getting one wrong
 * produces a hub that resolves but cannot be administered.
 *
 * WHAT IT WILL NOT DO:
 *   - create a `demo` hub. Demo is the one mode that turns off email
 *     verification; a trigger on `hubs` refuses any move INTO it, and a
 *     script that could create one is the same hole with a different shape.
 *     Demo hubs come from supabase/seed.sql, which never reaches a hosted
 *     project. See BUILD-PLAN-multi-tenant.md → Contract 1.
 *   - touch production. It refuses the production project ref outright.
 *   - overwrite an existing hub. A slug that is taken is an error, not an
 *     upsert: "create" must never silently mean "replace".
 *
 * A HUB WITHOUT AN ADMIN CANNOT BE FIXED FROM THE UI — requireAdmin fails
 * closed and every /admin route answers 503 — so the admin roster is written
 * in the same breath as the row, derived by plus-addressing this
 * deployment's own admin the way the Athens fixture does.
 */

import { getDb } from "../src/db/client.js";
import { KEYS, encodeList } from "../src/models/hubSettings.js";
import { hubSlugRejectionReason, isHubMode } from "../src/models/hub.js";

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

  const slugProblem = hubSlugRejectionReason(id);
  if (slugProblem) throw new Error(slugProblem);

  if (!isHubMode(mode)) {
    throw new Error(`--mode must be beta or live (got "${mode}").`);
  }
  if (mode === "demo") {
    throw new Error(
      "This script will not create a demo hub. Demo turns off email " +
        "verification and belongs in supabase/seed.sql, which never reaches a " +
        "hosted project. See BUILD-PLAN-multi-tenant.md → Contract 1.",
    );
  }

  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.replace(/^https:\/\/([^.]+).*/, "$1");
  if (ref === PRODUCTION_REF) {
    throw new Error(
      "Refusing: SUPABASE_URL points at production. Hubs are created on " +
        "production only in the cutover session, by hand, from the runbook.",
    );
  }

  const db = getDb();

  const { data: existing } = await db
    .from("hubs")
    .select("id")
    .or(`id.eq.${id},hostname.eq.${hostname}`);
  if ((existing ?? []).length > 0) {
    throw new Error(
      `A hub already claims "${id}" or "${hostname}". Create does not replace.`,
    );
  }

  // `space_did` is the protocol identity on everything this hub publishes, so
  // it is derived from the hostname and is stable for the hub's lifetime — it
  // does not follow a later hostname change.
  //
  // `protocol_hub_id` is `source.hub_id` on its events. Derived from the slug
  // HERE, once, at creation; nothing recomputes it from `id` afterwards, so a
  // later rename cannot silently change who a hub's past events say they are
  // from.
  const row = {
    id,
    protocol_hub_id: `civic-hub-${id}`,
    hostname,
    name,
    jurisdiction_code: null,
    jurisdiction_name: jurisdiction,
    space_did: `did:web:${hostname}`,
    space_type: "civic-hub",
    status: "active",
    mode,
  };

  const admins = plusAddressed(process.env.CIVIC_ADMIN_EMAILS, id);
  if (admins.length === 0) {
    throw new Error(
      "CIVIC_ADMIN_EMAILS is unset, so this hub would have no administrator " +
        "and no way to gain one through the UI. Set it and rerun.",
    );
  }

  const settings: Array<{ key: string; value: string }> = [
    { key: KEYS.IDENTITY_NAME, value: name },
    { key: KEYS.IDENTITY_LABEL, value: "Civic Hub" },
    { key: KEYS.PEOPLE_ADMIN_EMAILS, value: encodeList(admins) },
    { key: KEYS.LEGAL_OPERATOR_NAME, value: name },
    { key: KEYS.EMAIL_FROM_NAME, value: name },
  ];
  if (jurisdiction) {
    settings.push({
      key: KEYS.IDENTITY_PAGE_TITLE,
      value: `${jurisdiction} — Civic Hub`,
    });
  }

  console.log(`\nproject: ${ref}`);
  console.log(`hub:     ${JSON.stringify(row, null, 2)}`);
  console.log(`settings:`);
  for (const s of settings) console.log(`  ${s.key.padEnd(28)} ${s.value}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  const { error: hubErr } = await db.from("hubs").insert(row);
  if (hubErr) throw new Error(`hubs insert: ${hubErr.message}`);

  const { error: setErr } = await db.from("hub_settings").upsert(
    settings.map((s) => ({ ...s, hub_id: id, updated_by: "create-hub" })),
    { onConflict: "hub_id,key" },
  );
  if (setErr) throw new Error(`hub_settings upsert: ${setErr.message}`);

  console.log(`\nCreated "${id}" in ${mode} mode at ${hostname}.`);
  console.log(`Admin: ${admins.join(", ")}`);
  console.log(
    `\nThe hostname still has to reach this deployment — add it as a domain ` +
      `on the Vercel project, or the resolver will never see it.\n`,
  );
}

main().catch((e) => {
  console.error(`\ncreate-hub failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
