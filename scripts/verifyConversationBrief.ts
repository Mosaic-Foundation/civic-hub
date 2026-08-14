// Focused check of the CONVERSATION generateBrief mapping (Polis summary →
// BriefContent). The full close path needs a live Polis instance; this
// exercises the pure mapping the handler runs on state.summary.
// Usage: node --env-file=.env --import tsx scripts/verifyConversationBrief.ts

// Import via processService so the registry boots in the app's normal order
// (importing deliberationBoot directly triggers a circular-import TDZ).
import "../src/services/processService.js";
import { getProcessHandler } from "../src/processes/registry.js";
import type { Process } from "../src/models/process.js";
import type { BriefContent } from "../src/modules/civic.brief/index.js";

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL:"} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const handler = getProcessHandler("civic.polis_deliberation")!;
  ok(typeof handler.generateBrief === "function", "conversation handler implements generateBrief");

  const summary = {
    summary_text: "Residents broadly agreed the town should conserve water.",
    directed_questions: ["How should conservation be funded?"],
    top_consensus_statements: [
      { statement_text: "Fix leaks first", agree_rate: 0.82, vote_count: 40 },
    ],
    opinion_groups: [
      { group_id: 0, size: 25, representative_statements: [{ text: "Prioritize infrastructure", agreement_within_group: 0.9 }] },
    ],
    participation_stats: { total_participants: 42, total_statements: 60, total_votes: 300, opinion_groups_formed: 2 },
    linked_polis_data_uri: "",
    methodology: { prompt_version: "v1", model_used: "test", generated_at: "now" },
  };

  const process = {
    id: "conv_test",
    definition: { type: "civic.polis_deliberation", version: "0.1" },
    title: "Water supply",
    description: "",
    status: "closed",
    hubId: "hub",
    jurisdiction: "local",
    createdBy: "system",
    createdAt: "now",
    updatedAt: "now",
    state: { topic: "How much can Floyd's water support?", summary, summary_status: "complete" },
  } as unknown as Process;

  const brief = (await handler.generateBrief!(process)) as BriefContent;
  ok(!!brief, "generateBrief returns content for a completed summary");
  ok(brief.summary === summary.summary_text, "brief summary is the Polis summary text");
  ok(brief.participation_count === 42, `participation counted (got ${brief.participation_count})`);
  ok(
    brief.sections.some((s) => s.heading === "Where the community agreed") &&
      brief.sections.some((s) => s.heading === "Where opinions differed"),
    "brief has agreement + divergence sections",
  );
  console.log("    headline:", brief.headline);
  console.log("    sections:", brief.sections.map((s) => s.heading).join(", "));

  // Incomplete summary → no brief.
  const noSummary = { ...process, state: { topic: "x", summary_status: "failed" } } as unknown as Process;
  ok((await handler.generateBrief!(noSummary)) === null, "returns null when the summary isn't complete");
}

main().then(() => {
  console.log(process.exitCode ? "\nFAILED" : "\nALL CHECKS PASSED");
  process.exit(process.exitCode ?? 0);
});
