// scripts/verifyPhase3.ts — non-DB verification of the Phase 3 shared
// classifier + digest parity. Runs the REAL classifyActivity + the REAL
// digest assembler over a representative event set (current + legacy shapes),
// prints the "what shows in the feed" table, and writes the rendered digest
// HTML to /tmp/phase3-digest.html for a visual eyeball.
//
// Run: npx tsx scripts/verifyPhase3.ts

import {
  classifyActivity,
  type ClassifierEvent,
} from "../src/shared/feedActivity.js";
import { assembleDigestForUser } from "../src/modules/civic.digest/index.js";
import type { DigestEvent } from "../src/modules/civic.digest/index.js";
import { writeFileSync } from "node:fs";
import {
  VERIFY_PHASE3_SYNCED_ANNOUNCEMENT_DATA,
  VERIFY_PHASE3_HUB,
} from "../tests/fixtures/samples/verifyPhase3.js";

type Case = { label: string; ev: ClassifierEvent };

function mk(
  event_type: string,
  data: Record<string, unknown>,
  process_id = "proc_x",
  action_url = "https://hub.example/process/proc_x",
): ClassifierEvent {
  return { event_type, process_id, action_url, data };
}

// Representative set: every renderable kind (current discriminator), a few
// legacy data-shape variants, and the events that MUST stay out of the feed.
const cases: Case[] = [
  // --- should render ---
  { label: "vote open (new)", ev: mk("civic.process.started", { process: { type: "civic.vote" } }) },
  { label: "vote open (legacy, no type)", ev: mk("civic.process.started", {}) },
  { label: "wordcloud open", ev: mk("civic.process.started", { process: { type: "civic.wordcloud" } }, "wc_1", "https://hub.example/wordcloud/wc_1") },
  { label: "vote results (new)", ev: mk("civic.process.result_published", { process: { type: "civic.vote_results" }, results_id: "proc_x" }) },
  { label: "vote results (legacy brief_id)", ev: mk("civic.process.result_published", { brief_id: "b1" }) },
  { label: "announcement (admin)", ev: mk("civic.process.result_published", { announcement: { author_role: "admin", title: "Road closure" } }) },
  { label: "announcement (board)", ev: mk("civic.process.result_published", { announcement: { author_role: "board", title: "Budget note" } }) },
  { label: "announcement (synced gov)", ev: mk("civic.process.result_published", VERIFY_PHASE3_SYNCED_ANNOUNCEMENT_DATA) },
  { label: "meeting summary (new)", ev: mk("civic.process.result_published", { process: { type: "civic.meeting_summary" }, meeting_summary: { meeting_title: "BoS Regular", meeting_date: "2026-06-20", block_count: 4 } }) },
  { label: "meeting summary (legacy summary_id)", ev: mk("civic.process.result_published", { summary_id: "s1" }) },
  { label: "wordcloud result (legacy snapshot)", ev: mk("civic.process.result_published", { wordcloud_snapshot: {} }, "wc_1") },
  { label: "proposal submitted", ev: mk("civic.proposal.submitted", { proposal: { title: "Dog park" } }, "prop_1") },
  { label: "proposal closed (Part C)", ev: mk("civic.proposal.closed", { proposal: { support_count: 4 } }, "prop_1") },
  { label: "project created", ev: mk("civic.project.created", { project: { title: "Trail repair" } }, "proj_1", "https://hub.example/project/proj_1") },
  { label: "project updated", ev: mk("civic.project.updated", { project: { update_id: "u1" } }, "proj_1", "https://hub.example/project/proj_1") },
  { label: "conversation created", ev: mk("civic.process.created", { process: { type: "civic.polis_deliberation", title: "Zoning" } }, "conv_1") },
  { label: "conversation results (Part C)", ev: mk("civic.outcome_delivered", { originating_process_id: "conv_1" }, "conv_1") },
  { label: "conversation (legacy flat process_type started)", ev: mk("civic.process.started", { process_type: "civic.polis_deliberation" }, "conv_1") },

  // --- should be EXCLUDED (must not produce a card) ---
  { label: "vote close (raw, dup of results)", ev: mk("civic.process.result_published", { result: { total_votes: 9 } }) },
  { label: "vote created", ev: mk("civic.process.created", { process: { type: "civic.vote" } }) },
  { label: "comment added", ev: mk("civic.process.comment_added", { process: { type: "civic.vote" }, comment: {} }) },
  { label: "vote submitted", ev: mk("civic.process.vote_submitted", { process: { type: "civic.vote" } }) },
  { label: "process updated (status change)", ev: mk("civic.process.updated", { process: { type: "civic.vote", status: "active" } }) },
  { label: "project archived", ev: mk("civic.project.archived", { project: {} }, "proj_1") },
  { label: "proposal supported", ev: mk("civic.proposal.supported", { proposal: {} }) },
  { label: "review approved (restricted)", ev: mk("civic.review.approved", {}) },
];

console.log("\n=== FEED CLASSIFICATION (what shows in the feed) ===\n");
let shown = 0;
let excluded = 0;
for (const c of cases) {
  const a = classifyActivity(c.ev);
  if (!a) {
    excluded++;
    console.log(`  ✗ EXCLUDED   ${c.label}`);
  } else {
    shown++;
    console.log(
      `  ✓ ${a.surface.padEnd(15)} ${a.kind.padEnd(22)} pill="${a.pill}"  →  ${a.href}`,
    );
  }
}
console.log(`\n  ${shown} render, ${excluded} excluded (default-closed).`);

// --- Filter agreement: gate vs each ?type= surface ---
console.log("\n=== FILTER SURFACES (gate ↔ filter agree) ===\n");
const surfaces = ["announcement", "meeting_summary", "activity"] as const;
for (const s of surfaces) {
  const n = cases.filter((c) => classifyActivity(c.ev)?.surface === s).length;
  console.log(`  ${s.padEnd(16)} ${n} card(s)`);
}

// --- Digest parity: render the email from the renderable set ---
const digestEvents: DigestEvent[] = cases
  .filter((c) => classifyActivity(c.ev) !== null)
  .map((c, i) => ({
    id: `evt_${i}`,
    event_type: c.ev.event_type,
    timestamp: new Date(Date.UTC(2026, 5, 26, 9, i)).toISOString(),
    process_id: c.ev.process_id,
    action_url: c.ev.action_url,
    data: c.ev.data,
  }));

const digest = assembleDigestForUser({
  user: { id: "u1", email: "you@example.com", created_at: "2026-01-01T00:00:00Z", last_digest_sent_at: null },
  events: digestEvents,
  hub: VERIFY_PHASE3_HUB,
  since: "2026-06-01T00:00:00Z",
  process_titles: {
    proc_x: "Park funding vote",
    wc_1: "What should we prioritize?",
    prop_1: "Dog park proposal",
    proj_1: "Trail repair project",
    conv_1: "Downtown zoning conversation",
  },
});

console.log("\n=== DIGEST RENDER ===\n");
if (!digest) {
  console.log("  digest is null (nothing renderable) — UNEXPECTED");
} else {
  console.log(`  item_count: ${digest.item_count}`);
  console.log(`  subject:    ${digest.subject}`);
  const sections = [...digest.text.matchAll(/^([A-Z][A-Z ]+)\n-+$/gm)].map((m) => m[1]);
  console.log(`  sections:   ${sections.join(" | ")}`);
  writeFileSync("/tmp/phase3-digest.html", digest.html);
  console.log("  wrote /tmp/phase3-digest.html");
}
console.log("");
