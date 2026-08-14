// Integration check of the VOTE → brief migration against the real DB.
// Drives create → activate → vote×3 → close through the service layer and
// verifies a civic.brief spawns with the tally (no more civic.vote_results).
// Usage: node --env-file=.env --import tsx scripts/verifyVoteBriefFlow.ts

import { getDb } from "../src/db/client.js";
import {
  createProcess,
  executeAction,
  getProcess,
} from "../src/services/processService.js";
import { findExistingBriefId } from "../src/processes/spawnBrief.js";
import type { BriefProcessState } from "../src/modules/civic.brief/index.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../src/config/hub.js";

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL:"} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // 1. Create + directly activate a yes/no/unsure vote.
  const vote = await createProcess({
    definition: { type: "civic.vote", version: "0.1" },
    title: "E2E Vote Brief Test",
    description: "Should the test pass?",
    hubId: HUB_ID,
    jurisdiction: DEFAULT_JURISDICTION,
    createdBy: "verify-script",
    state: {
      method: "yes_no_unsure",
      options: ["yes", "no", "unsure"],
      activation_mode: "direct",
    },
  });
  const id = vote.id;
  console.log(`  vote ${id} (status ${vote.status})`);

  await executeAction(id, { type: "process.activate", actor: "verify-script", payload: {} });

  // 2. Three ballots.
  await executeAction(id, { type: "process.vote", actor: "voter_a", payload: { option: "yes" } });
  await executeAction(id, { type: "process.vote", actor: "voter_b", payload: { option: "yes" } });
  await executeAction(id, { type: "process.vote", actor: "voter_c", payload: { option: "no" } });

  // 3. Close → the universal seam should spawn a brief (NOT a vote_results).
  await executeAction(id, { type: "process.close", actor: "verify-script", payload: {} });

  const closed = await getProcess(id);
  ok(closed?.status === "closed", `vote is closed (got "${closed?.status}")`);

  const { data: voteResults } = await getDb()
    .from("processes")
    .select("id")
    .eq("type", "civic.vote_results")
    .eq("state->>source_process_id", id);
  ok((voteResults?.length ?? 0) === 0, `no civic.vote_results spawned (migration retired it)`);

  const briefId = await findExistingBriefId(id);
  ok(!!briefId, `a civic.brief spawned for the vote`);
  if (!briefId) return;

  const briefProc = await getProcess(briefId);
  const bs = briefProc!.state as unknown as BriefProcessState;
  ok(bs.source_process_type === "civic.vote", `brief source_process_type is civic.vote`);
  ok(bs.content.participation_count === 3, `tally counted 3 votes (got ${bs.content.participation_count})`);
  ok(
    bs.content.sections.some((s) => s.body.includes("yes: 2") && s.body.includes("no: 1")),
    `brief section shows the tally (yes: 2, no: 1)`,
  );
  console.log("    headline:", bs.content.headline);
  console.log("    section:", bs.content.sections[0]?.body.replace(/\n/g, " | "));

  // Cleanup — brief + vote + receipts.
  await getDb().from("processes").delete().eq("id", briefId);
  await getDb().from("processes").delete().eq("id", id);
  await getDb().from("vote_records").delete().eq("process_id", id);
  await getDb().from("vote_participation").delete().eq("process_id", id);
  console.log("  ✓ cleaned up");
}

main().then(() => {
  console.log(process.exitCode ? "\nFAILED" : "\nALL CHECKS PASSED");
  process.exit(process.exitCode ?? 0);
});
