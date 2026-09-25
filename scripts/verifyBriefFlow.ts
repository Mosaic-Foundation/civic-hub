// One-off verification of the universal brief flow against the real DB.
// Usage: node --env-file=.env --import tsx scripts/verifyBriefFlow.ts --hub <slug> <sourceProcessId>

import { forHub } from "../src/db/forHub.js";
import { getProcess, saveProcessState } from "../src/services/processService.js";
import {
  approveBrief,
  type BriefProcessState,
} from "../src/modules/civic.brief/index.js";
import { emitEvent } from "../src/events/eventEmitter.js";
import { finalizeBriefSource } from "../src/services/briefFinalize.js";
import type { Hub } from "../src/models/hub.js";
import { withScriptHub } from "./lib/hubScope.js";

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL:"} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main(hub: Hub) {
  const db = forHub(hub.id);
  const args = process.argv.slice(2);
  const sourceId = args.filter(
    (a, i) => a !== "--hub" && !a.startsWith("--hub=") && args[i - 1] !== "--hub",
  )[0];
  if (!sourceId) throw new Error("pass the source process id");

  // 1. The source should now be closed/completed. Projects live in the
  //    projects table (no processes row), so check both.
  const source = await getProcess(sourceId);
  const projRow = await db
    .from("projects")
    .select("status")
    .eq("id", sourceId)
    .maybeSingle();
  const sourceStatus = source?.status ?? projRow?.status;
  ok(!!sourceStatus, `source ${sourceId} exists`);
  ok(
    sourceStatus === "closed" || sourceStatus === "completed",
    `source is closed/completed (got "${sourceStatus}")`,
  );

  // 2. A civic.brief should have spawned, linked to the source.
  const briefs = await db
    .from("processes")
    .select("id, status, state")
    .eq("type", "civic.brief")
    .eq("state->>source_process_id", sourceId);
  ok(!!briefs && briefs.length === 1, `exactly one brief spawned (got ${briefs?.length ?? 0})`);
  const briefRow = briefs?.[0];
  if (!briefRow) return;

  const briefState = briefRow.state as unknown as BriefProcessState;
  ok(briefState.publication_status === "pending", `brief is pending review`);
  ok(!!briefState.content.headline, `brief has a headline: "${briefState.content.headline}"`);
  ok(
    typeof briefState.source_process_type === "string" &&
      briefState.source_process_type.startsWith("civic."),
    `source_process_type recorded ("${briefState.source_process_type}")`,
  );
  console.log("    sections:", briefState.content.sections.map((s) => s.heading).join(", "));

  // 3. Approve the brief (the exact orchestration the admin endpoint runs).
  const briefProc = await getProcess(briefRow.id);
  if (!briefProc) return;
  const state = briefProc.state as unknown as BriefProcessState;
  await approveBrief(state, "verify-script", {
    process_id: briefProc.id,
    hub_id: briefProc.hubId,
    jurisdiction: briefProc.jurisdiction,
    emit: emitEvent,
  }, {
    recipients: [],
    hubLabel: "Test Hub",
    publicBriefUrl: `https://hub/brief/${briefProc.id}`,
    sendEmail: async () => undefined,
    finalizeSource: finalizeBriefSource,
  });
  briefProc.status = "finalized";
  await saveProcessState(briefProc);

  ok(state.publication_status === "published", `brief transitions to published on approve`);

  // 4. The source's terminal status holds after publish (projects stay
  //    "completed"; other types finalize on the processes row).
  const after = await getProcess(sourceId);
  const projAfter = await db
    .from("projects")
    .select("status")
    .eq("id", sourceId)
    .maybeSingle();
  const afterStatus = after?.status ?? projAfter?.status;
  ok(
    afterStatus === "finalized" || afterStatus === "completed",
    `source terminal after brief publish (got "${afterStatus}")`,
  );

  // 5. Cleanup — remove the test brief + source so dev data stays clean.
  await db.from("processes").delete().eq("id", briefRow.id);
  await db.from("processes").delete().eq("id", sourceId);
  await db.from("projects").delete().eq("id", sourceId);
  console.log("  ✓ cleaned up test rows");
}

withScriptHub(main).then(() => {
  console.log(process.exitCode ? "\nFAILED" : "\nALL CHECKS PASSED");
  process.exit(process.exitCode ?? 0);
});
