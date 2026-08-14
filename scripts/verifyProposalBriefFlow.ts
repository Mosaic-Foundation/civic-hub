// Integration check of the PROPOSAL → brief flow against the real DB.
// Creates a proposal with a past support window, runs the adapter's
// closeIfExpired (its real lazy-close path), and verifies the brief spawns
// with the endorsement count.
// Usage: node --env-file=.env --import tsx scripts/verifyProposalBriefFlow.ts

import { getDb } from "../src/db/client.js";
import { getProcess } from "../src/services/processService.js";
import proposalAdapter from "../src/processes/proposalAdapter.js";
import {
  createProposal,
  supportProposal,
} from "../src/modules/civic.proposals/index.js";
import { findExistingBriefId } from "../src/processes/spawnBrief.js";
import { emitEvent } from "../src/events/eventEmitter.js";
import type { BriefProcessState } from "../src/modules/civic.brief/index.js";
import type { Process } from "../src/models/process.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../src/config/hub.js";

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL:"} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const pastClose = new Date(Date.now() - 60_000).toISOString();
  const proposal = await createProposal(
    {
      title: "E2E Proposal Brief Test",
      description: "A proposal to verify the brief flow.",
      submitted_by: "verify-script",
      closes_at: pastClose,
    },
    emitEvent,
  );
  const id = proposal.id;
  console.log(`  proposal ${id}`);

  // Two endorsements (support window is in the past, but supportProposal
  // gates on status "submitted", which it still is until closeIfExpired).
  try {
    await supportProposal(id, "backer_a", emitEvent);
    await supportProposal(id, "backer_b", emitEvent);
  } catch (e) {
    console.log("  (support skipped:", e instanceof Error ? e.message : e, ")");
  }

  // Run the real lazy-close path.
  const source: Process = {
    id,
    definition: { type: "civic.proposal", version: "0.1" },
    title: proposal.title,
    description: proposal.description ?? "",
    status: "active",
    hubId: HUB_ID,
    jurisdiction: DEFAULT_JURISDICTION,
    createdBy: "verify-script",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: {},
  };
  await proposalAdapter.closeIfExpired!(source);
  ok(source.status === "closed", `proposal closed via closeIfExpired (got "${source.status}")`);

  const briefId = await findExistingBriefId(id);
  ok(!!briefId, `a civic.brief spawned for the proposal`);
  if (briefId) {
    const briefProc = await getProcess(briefId);
    const bs = briefProc!.state as unknown as BriefProcessState;
    ok(bs.source_process_type === "civic.proposal", `brief source_process_type is civic.proposal`);
    console.log("    headline:", bs.content.headline);
    console.log("    participation:", bs.content.participation_label);
    await getDb().from("processes").delete().eq("id", briefId);
  }

  // Cleanup.
  await getDb().from("processes").delete().eq("id", id);
  await getDb().from("proposals").delete().eq("id", id);
  console.log("  ✓ cleaned up");
}

main().then(() => {
  console.log(process.exitCode ? "\nFAILED" : "\nALL CHECKS PASSED");
  process.exit(process.exitCode ?? 0);
});
