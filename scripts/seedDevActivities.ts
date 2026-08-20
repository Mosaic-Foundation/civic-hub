/**
 * Seed one complete vote lifecycle into the DEV database — a non-destructive
 * alternative to GET /debug/seed.
 *
 * Why this exists: /debug/seed wipes first, and the wipe cannot run in a dev
 * project whose append-only `review_turns` table holds rows (PostgREST cannot
 * TRUNCATE). When that happens the events table ends up empty while the
 * processes remain, and nothing — auto-seed included — refills it. This script
 * adds a fresh process with a generated id, so it never collides with the
 * fixed-id fixtures, and drives it through the real action dispatcher so every
 * event is emitted the normal way.
 *
 * It writes to whatever SUPABASE_URL points at, and the seed guards do not
 * apply here — check your .env before running.
 *
 * Run from civic-hub/:
 *   node --env-file=.env --import tsx scripts/seedDevActivities.ts
 */

import { createProcess, executeAction } from "../src/services/processService.js";
import { submitInput } from "../src/modules/civic.input/index.js";
import { emitEvent } from "../src/events/eventEmitter.js";
import { getEventCount } from "../src/events/eventStore.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../src/config/hub.js";

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

async function main(): Promise<void> {
  const before = await getEventCount();

  const process_ = await createProcess({
    definition: { type: "civic.vote", version: "0.1" },
    title: `Dev fixture vote — ${stamp}`,
    description:
      "A dev-only vote used to populate the activity log with a full lifecycle.",
    createdBy: "user:civic-admin",
    jurisdiction: DEFAULT_JURISDICTION,
    hubId: HUB_ID,
    state: {
      options: ["Yes", "No", "Unsure"],
      support_threshold: 1,
      voting_duration_ms: 7 * 24 * 60 * 60 * 1000,
      activation_mode: "direct",
    },
  } as Parameters<typeof createProcess>[0]);

  await executeAction(process_.id, {
    type: "process.activate",
    actor: "user:civic-admin",
    payload: {},
  });

  for (const [actor, option] of [
    ["user:dev-resident-1", "Yes"],
    ["user:dev-resident-2", "No"],
    ["user:dev-resident-3", "Yes"],
  ] as const) {
    await executeAction(process_.id, {
      type: "process.vote",
      actor,
      payload: { option },
    });
  }

  await submitInput(
    process_.id,
    "user:dev-resident-1",
    "Dev fixture comment — this exercises the comment_added activity.",
    { hub_id: HUB_ID, jurisdiction: DEFAULT_JURISDICTION, emit: emitEvent },
  );

  await executeAction(process_.id, {
    type: "process.close",
    actor: "system:auto-close",
    payload: {},
  });

  const after = await getEventCount();
  console.log(
    `[seed-dev-activities] ${process_.id} — ${after - before} activities added (${after} total)`,
  );
}

main().catch((err) => {
  console.error("[seed-dev-activities] failed:", err);
  process.exit(1);
});
