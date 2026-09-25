// The one way an operator script says which hub it is working on.
//
//   npx tsx scripts/<script>.ts --hub <slug> [...]
//
// Every script that reads or writes a hub's data takes `--hub` through this
// helper and refuses to run without it. A script is run by hand, with no
// hostname, so before Phase 2c it either ran against whatever the env named
// or — once the code it calls went through forHub() — threw "No hub in
// scope" halfway through. Naming the hub is now the first thing it does, and
// it is checked before anything touches the database.
//
// withScriptHub() also enters the hub's scope exactly as a request for it
// would (withHubScope + its settings), so every reader the script calls —
// forHub(currentHubId()), getSettingSync, baseUrl — answers for that hub.

// @civic-raw-client-importer: pins operator scripts to the service role.
import type { Hub } from "../../src/models/hub.js";
import { isWellFormedHubSlug } from "../../src/models/hub.js";
import { pinServiceRole } from "../../src/db/client.js";

// Scripts are control plane: they keep the service role even when the env
// file they share with the app has CIVIC_HUB_MINTED_TOKEN on (Phase 3).
pinServiceRole();

export const HUB_FLAG = "--hub";

function scriptName(): string {
  return (process.argv[1] ?? "script").split("/").pop() ?? "script";
}

/**
 * The slug after `--hub` (or `--hub=<slug>`). Exits with a usage message when
 * it is missing or malformed: a script that does not know its hub must not
 * guess one.
 */
export function hubArg(argv: readonly string[] = process.argv.slice(2)): string {
  let raw: string | undefined;
  const i = argv.indexOf(HUB_FLAG);
  if (i >= 0) raw = argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${HUB_FLAG}=`));
  if (eq) raw = eq.slice(HUB_FLAG.length + 1);

  const slug = raw?.trim().toLowerCase();
  if (!slug || slug.startsWith("-") || !isWellFormedHubSlug(slug)) {
    console.error(
      `${scriptName()}: refusing to run without a hub. Name one: ${HUB_FLAG} <slug>` +
        (raw ? ` ("${raw}" is not a hub slug)` : ""),
    );
    process.exit(2);
  }
  return slug;
}

/** The hub row for `slug`, or exit: an unknown hub is an operator mistake. */
export async function resolveScriptHub(slug: string): Promise<Hub> {
  const { getHubBySlug } = await import("../../src/db/hubs.js");
  const hub = await getHubBySlug(slug);
  if (!hub) {
    console.error(`${scriptName()}: no hub "${slug}" in this database.`);
    process.exit(2);
  }
  return hub;
}

/**
 * Parse `--hub`, look the hub up, and run `fn` inside its scope with its
 * settings loaded. Returns what `fn` returns.
 */
export async function withScriptHub<T>(
  fn: (hub: Hub) => Promise<T>,
  argv: readonly string[] = process.argv.slice(2),
): Promise<T> {
  const slug = hubArg(argv);
  const hub = await resolveScriptHub(slug);
  const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
  const { withHubScope } = await import("../../src/config/hubContext.js");
  const settings = await fetchHubSettings(hub.id);
  console.log(`[${scriptName()}] hub=${hub.id} (${hub.hostname})`);
  return withHubScope(hub, settings, () => fn(hub));
}
