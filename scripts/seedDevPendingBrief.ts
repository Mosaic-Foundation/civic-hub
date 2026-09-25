/**
 * Seed a PENDING Civic Brief on the dev database, for exercising the
 * admin review flow (recipient picker, approve → email delivery, public
 * "Sent to" receipt) without closing a real process.
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    node --env-file=.env --import tsx scripts/seedDevPendingBrief.ts --hub <slug>
 * Remove:   node --env-file=.env --import tsx scripts/seedDevPendingBrief.ts --hub <slug> --remove
 *
 * The source_process_id points at a non-existent process on purpose:
 * finalizeBriefSource is best-effort (a missing source is a no-op), so
 * approving this brief publishes it and sends the delivery email without
 * touching any real dev process. Delete it afterwards with --remove
 * (or archive it from the brief page).
 */
import { forHub } from "../src/db/forHub.js";
import type { Hub } from "../src/models/hub.js";
import { withScriptHub } from "./lib/hubScope.js";
import {
  SEED_DEV_PENDING_BRIEF_JURISDICTION,
  SEED_DEV_PENDING_BRIEF_CONTENT,
} from "../tests/fixtures/samples/seedDevPendingBrief.js";

const BRIEF_ID = "proc_brief_devtest_001";

async function main(hub: Hub): Promise<void> {
  const db = forHub(hub.id);

  if (process.argv.includes("--remove")) {
    await db.from("brief_responses").delete().eq("brief_id", BRIEF_ID);
    await db.from("processes").delete().eq("id", BRIEF_ID);
    console.log(`removed ${BRIEF_ID} (and any responses to it)`);
    return;
  }

  const state = {
    type: "civic.brief",
    source_process_id: "proc_devtest_source_does_not_exist",
    source_process_type: "civic.polis_deliberation",
    publication_status: "pending",
    generated_at: new Date().toISOString(),
    approved_at: null,
    published_at: null,
    delivered_to: [],
    content: SEED_DEV_PENDING_BRIEF_CONTENT,
  };

  const row = {
    id: BRIEF_ID,
    type: "civic.brief",
    process_version: "0.1",
    title: state.content.title,
    description: "",
    jurisdiction: SEED_DEV_PENDING_BRIEF_JURISDICTION,
    status: "active",
    state,
    created_by: "system_seed",
  };

  await db.from("processes").upsert(row, { onConflict: "hub_id,id" });
  console.log(`seeded pending brief ${BRIEF_ID}`);
  console.log("Review it at: http://localhost:5173/admin/briefs");
}

withScriptHub(main).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
