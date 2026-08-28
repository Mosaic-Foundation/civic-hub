/**
 * Seed a PENDING Civic Brief on the dev database, for exercising the
 * admin review flow (recipient picker, approve → email delivery, public
 * "Sent to" receipt) without closing a real process.
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    node --env-file=.env --import tsx scripts/seedDevPendingBrief.ts
 * Remove:   node --env-file=.env --import tsx scripts/seedDevPendingBrief.ts --remove
 *
 * The source_process_id points at a non-existent process on purpose:
 * finalizeBriefSource is best-effort (a missing source is a no-op), so
 * approving this brief publishes it and sends the delivery email without
 * touching any real dev process. Delete it afterwards with --remove
 * (or archive it from the brief page).
 */
import { getDb } from "../src/db/client.js";

const BRIEF_ID = "proc_brief_devtest_001";
const db = getDb();

if (process.argv.includes("--remove")) {
  await db.from("brief_responses").delete().eq("brief_id", BRIEF_ID);
  const { error } = await db.from("processes").delete().eq("id", BRIEF_ID);
  if (error) throw new Error(error.message);
  console.log(`removed ${BRIEF_ID} (and any responses to it)`);
  process.exit(0);
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
  content: {
    title: "TEST — Sidewalk connectivity in the town of Floyd",
    headline: "Broad agreement that the gaps on Main Street come first",
    summary:
      "Residents talked through where new sidewalk segments would matter most. " +
      "The clearest common ground: closing the two gaps along Main Street " +
      "between the school and the library, before any new segments elsewhere.\n\n" +
      "This is a seeded TEST brief for exercising the review flow — safe to " +
      "edit, approve, and respond to on dev.",
    sections: [
      {
        heading: "Where the community agreed",
        body: "Main Street gaps first; school walking routes second; decorative extensions last.",
      },
    ],
    participation_label: "23 participants",
    participation_count: 23,
    comments: [
      "My kids walk that stretch every day — the gap by the library is the scary part.",
      "Fix what's half-built before starting anything new.",
    ],
    admin_notes: "",
    image_url: null,
    image_alt: null,
  },
};

const row = {
  id: BRIEF_ID,
  type: "civic.brief",
  process_version: "0.1",
  title: state.content.title,
  description: "",
  jurisdiction: "us-va-floyd",
  status: "active",
  state,
  hub_id: "floyd-civic-hub",
  created_by: "system_seed",
};

const { error } = await db.from("processes").upsert(row, { onConflict: "id" });
if (error) throw new Error(error.message);
console.log(`seeded pending brief ${BRIEF_ID}`);
console.log("Review it at: http://localhost:5173/admin/briefs");
