// Snapshot what a database's hubs serve on the wire, for a before/after diff.
//
//   node --env-file=<file naming CIVIC_TARGET_DATABASE_URL> --import tsx \
//     scripts/wire-snapshot.ts --out <dir> [--hub <slug>]...
//
// Every event of every named hub (all hubs when none is named), serialized
// the three ways the hub serves it: admin (toActivity), member and public
// (toRedactedActivity). One JSON file per hub, `<dir>/<slug>.json`, events
// in log order. READ-ONLY: it runs SELECTs and nothing else.
//
// Why: the Architecture-1 slice (ADR-008) freezes activity, process and
// actor identifiers at emission. Its invariant is that no identifier a hub
// serves today changes. Run this with the old code before migrating, again
// with the new code after, and diff the directories: they must be identical.
// Run both with the same environment (CIVIC_ANON_SECRET keys the public
// wire's tokens; BASE_URL / CIVIC_UI_BASE_URL give local hostnames a port).
//
// Uses pg rather than PostgREST (ADR-005): it reads another environment's
// database by URL, the way scripts/import-hub.ts does.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { Hub } from "../src/models/hub.js";
import { withHubScope } from "../src/config/hubContext.js";
import { rowToEvent, type EventRow } from "../src/events/eventStore.js";
import { toActivity } from "../src/events/activitySerializer.js";
import { toRedactedActivity } from "../src/events/publicRedaction.js";

function args(name: string): string[] {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  argv.forEach((a, i) => {
    if (a === name && argv[i + 1]) out.push(argv[i + 1]);
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  });
  return out;
}

async function main(): Promise<void> {
  const url = process.env.CIVIC_TARGET_DATABASE_URL;
  const outDir = args("--out")[0];
  if (!url || !outDir) {
    console.error("wire-snapshot: needs CIVIC_TARGET_DATABASE_URL and --out <dir>");
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("SET TIME ZONE 'UTC'");
    const wanted = args("--hub");
    const hubs = (
      await client.query<Hub>(
        wanted.length > 0
          ? "SELECT * FROM hubs WHERE id = ANY($1) ORDER BY id"
          : "SELECT * FROM hubs ORDER BY id",
        wanted.length > 0 ? [wanted] : [],
      )
    ).rows;

    for (const hub of hubs) {
      const rows = (
        await client.query<EventRow & { created_at: Date | string }>(
          "SELECT *, to_json(created_at) #>> '{}' AS created_at_text " +
            "FROM events WHERE hub_id = $1 ORDER BY created_at, id",
          [hub.id],
        )
      ).rows;
      const officials = new Set(
        (
          await client.query<{ id: string }>(
            "SELECT id FROM users WHERE hub_id = $1 AND coalesce(trim(official_title), '') <> ''",
            [hub.id],
          )
        ).rows.map((r) => r.id),
      );
      const documents = await withHubScope(hub, {}, async () =>
        rows.map((raw) => {
          // PostgREST returns created_at as text; match its spelling so the
          // snapshot's `published` is what the hub serves.
          const row = { ...raw, created_at: (raw as unknown as { created_at_text: string }).created_at_text };
          const event = rowToEvent(row as EventRow);
          return {
            event_id: event.id,
            admin: toActivity(event),
            member: toRedactedActivity(event, officials, "member"),
            public: toRedactedActivity(event, officials, "public"),
          };
        }),
      );
      writeFileSync(
        join(outDir, `${hub.id}.json`),
        JSON.stringify({ hub: hub.id, hostname: hub.hostname, documents }, null, 2) + "\n",
      );
      console.log(`[wire-snapshot] ${hub.id} (${hub.hostname}): ${documents.length} events`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
