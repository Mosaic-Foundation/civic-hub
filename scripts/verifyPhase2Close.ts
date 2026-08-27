/**
 * Phase 2 verification — one lazy, type-agnostic deadline-close + lifecycle
 * gating. Exercises the new paths directly against the configured Supabase
 * project (civic-hub/.env → dev urfmvqhzmamigssqwsya). Creates throwaway rows
 * with a "p2v_" id prefix and deletes them at the end.
 *
 * Deliberation close is intentionally NOT exercised here: its close action
 * makes an external call to the Polis backend (guarded, but still a network
 * call), which is out of bounds for local verification. It's verified by
 * construction (same dispatch path as votes) + the guarded close action.
 *
 * Run: node --env-file=.env --import tsx scripts/verifyPhase2Close.ts
 */

import {
  createProcess,
  executeAction,
  getProcess,
  getProcessState,
  saveProcessState,
} from "../src/services/processService.js";
import { createProposal } from "../src/modules/civic.proposals/index.js";
import { emitEvent } from "../src/events/eventEmitter.js";
import { getDb } from "../src/db/client.js";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ❌ FAILED: ${msg}`);
    failures++;
  }
}

const PAST = new Date(Date.now() - 60_000).toISOString();
const ids: string[] = [];

async function eventExists(processId: string, eventType: string): Promise<boolean> {
  const { data } = await getDb()
    .from("events")
    .select("id")
    .eq("process_id", processId)
    .eq("event_type", eventType)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function rowStatus(table: string, id: string): Promise<string | null> {
  const { data } = await getDb().from(table).select("status").eq("id", id).maybeSingle();
  return (data?.status as string) ?? null;
}

async function run() {
  console.log("🏛️  Phase 2 — deadline-close + lifecycle verification\n");
  console.log(`Target: ${process.env.SUPABASE_URL}\n`);

  // ── 1. Vote: past deadline auto-closes on read ───────────────────────────
  console.log("── 1. Vote close on elapsed voting_closes_at ──");
  const voteId = `p2v_vote_${Date.now()}`;
  ids.push(voteId);
  await createProcess({
    id: voteId,
    definition: { type: "civic.vote", version: "0.1" },
    title: "P2 verify vote",
    description: "throwaway",
    createdBy: "user:p2verify",
    state: { options: ["yes", "no", "unsure"] },
  });
  await executeAction(voteId, { type: "process.activate", actor: "user:p2verify", payload: {} });
  // Backdate the voting window so the next read should auto-close it.
  const vp = await getProcess(voteId);
  (vp!.state as Record<string, unknown>).voting_closes_at = PAST;
  await saveProcessState(vp!);

  const vState = (await getProcessState(voteId)) as Record<string, unknown>;
  assert(vState?.status === "closed", `vote auto-closed on read (status=${vState?.status})`);
  assert(await eventExists(voteId, "civic.process.ended"), "vote emitted civic.process.ended");
  assert((await rowStatus("processes", voteId)) === "closed", "vote processes-row persisted as closed");
  // Clean up the spawned vote-results record too.
  const followUps = ((await getProcess(voteId))?.state as Record<string, unknown>)
    ?.follow_up_process_ids as string[] | undefined;
  if (followUps) ids.push(...followUps);

  // ── 2. Vote: malformed deadline must NOT close (guard) ────────────────────
  console.log("\n── 2. Vote with malformed deadline stays open (date guard) ──");
  const badVoteId = `p2v_badvote_${Date.now()}`;
  ids.push(badVoteId);
  await createProcess({
    id: badVoteId,
    definition: { type: "civic.vote", version: "0.1" },
    title: "P2 verify bad-deadline vote",
    description: "throwaway",
    createdBy: "user:p2verify",
    state: { options: ["yes", "no"] },
  });
  await executeAction(badVoteId, { type: "process.activate", actor: "user:p2verify", payload: {} });
  const bvp = await getProcess(badVoteId);
  (bvp!.state as Record<string, unknown>).voting_closes_at = "not-a-date";
  await saveProcessState(bvp!);
  const bvState = (await getProcessState(badVoteId)) as Record<string, unknown>;
  assert(bvState?.status === "active", `malformed-deadline vote stays active (status=${bvState?.status})`);

  // ── 3. Proposal: past closes_at auto-closes on read ──────────────────────
  console.log("\n── 3. Proposal close on elapsed closes_at ──");
  const propId = `p2v_prop_${Date.now()}`;
  ids.push(propId);
  // Child proposals row (open, deadline in the past).
  await createProposal(
    { id: propId, title: "P2 verify proposal", description: "throwaway", submitted_by: "user:p2verify", closes_at: PAST },
    emitEvent,
  );
  // Canonical processes row (active), keyed by the same id — what approval creates.
  await getDb().from("processes").insert({
    id: propId,
    type: "civic.proposal",
    process_version: "1.0",
    title: "P2 verify proposal",
    description: "throwaway",
    jurisdiction: "local",
    status: "active",
    state: {},
    hub_id: "civic-hub-local",
    created_by: "user:p2verify",
  });

  const pState = (await getProcessState(propId)) as Record<string, unknown>;
  assert(pState?.status === "closed", `proposal auto-closed on read (status=${pState?.status})`);
  assert((await rowStatus("proposals", propId)) === "closed", "proposal child-row persisted as closed");
  assert((await rowStatus("processes", propId)) === "closed", "proposal processes-row persisted as closed");
  assert(await eventExists(propId, "civic.proposal.closed"), "proposal emitted civic.proposal.closed");

  // ── 4. Proposal: no deadline must NOT close (guard) ───────────────────────
  // (proposals.closes_at is a timestamptz column, so a *malformed* value is
  // impossible at the source; the realistic guard case is a null deadline.)
  console.log("\n── 4. Proposal with no closes_at stays open (date guard) ──");
  const badPropId = `p2v_nodeadprop_${Date.now()}`;
  ids.push(badPropId);
  await createProposal(
    { id: badPropId, title: "P2 verify no-deadline proposal", description: "throwaway", submitted_by: "user:p2verify" },
    emitEvent,
  );
  await getDb().from("processes").insert({
    id: badPropId, type: "civic.proposal", process_version: "1.0", title: "P2 verify no-deadline proposal",
    description: "throwaway", jurisdiction: "local", status: "active", state: {},
    hub_id: "civic-hub-local", created_by: "user:p2verify",
  });
  const bpState = (await getProcessState(badPropId)) as Record<string, unknown>;
  assert(bpState?.status === "active", `no-deadline proposal stays active (status=${bpState?.status})`);
  assert((await rowStatus("proposals", badPropId)) === "submitted", "no-deadline proposal child stays submitted");

  // ── 5. Lifecycle gate: pending_review / archived not fetchable by id ──────
  console.log("\n── 5. getProcessState gating ──");
  const pendId = `p2v_pending_${Date.now()}`;
  ids.push(pendId);
  await getDb().from("processes").insert({
    id: pendId, type: "civic.vote", process_version: "1.0", title: "P2 verify pending",
    description: "throwaway", jurisdiction: "local", status: "pending_review",
    state: { type: "civic.vote", status: "draft", options: ["yes", "no"], votes: {}, supporters: {}, support_count: 0, config: { support_threshold: 5, voting_duration_ms: 1, activation_mode: "proposal_required" }, voting_opens_at: null, voting_closes_at: null, result: null },
    hub_id: "civic-hub-local", created_by: "user:p2verify",
  });
  assert((await getProcessState(pendId)) === undefined, "pending_review process not fetchable by id (404)");

  const archId = `p2v_archived_${Date.now()}`;
  ids.push(archId);
  await getDb().from("processes").insert({
    id: archId, type: "civic.project", process_version: "1.0", title: "P2 verify archived",
    description: "throwaway", jurisdiction: "local", status: "archived", state: {},
    hub_id: "civic-hub-local", created_by: "user:p2verify",
  });
  assert((await getProcessState(archId)) === undefined, "archived process not fetchable by id (404)");
}

async function cleanup() {
  console.log("\n── Cleanup ──");
  for (const id of ids) {
    try {
      // Inlined 2026-08-26. processService.deleteProcess was removed: it hard-
      // deleted a processes row while `proposals` / `projects` have NO foreign
      // key to it, so it silently orphaned child rows. This script owns only
      // its own throwaway "p2v_" ids, so it cleans them up directly.
      await getDb().from("proposals").delete().eq("id", id);
      await getDb().from("events").delete().eq("process_id", id);
      await getDb().from("processes").delete().eq("id", id);
    } catch (e) {
      console.warn(`  (cleanup) ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`  cleaned ${ids.length} throwaway ids`);
}

run()
  .catch((e) => {
    console.error("FATAL:", e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
