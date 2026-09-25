// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
// cleanupProdProcesses.ts — clean-slate the test/demo civic processes.
//
// What it does (per Adam, 2026-06-30):
//   • ARCHIVES every process of a "civic process" type (conversation, proposal,
//     vote, vote_results, project) — hidden from public listings + admin queue.
//   • DELETES the events tied to those archived processes — clears them from the
//     home feed (the feed renders from raw events, which a status change alone
//     does not hide).
//   • KEEPS the word cloud process(es) ACTIVE but DELETES all word-cloud
//     submissions — so "What do you love about Floyd?" starts blank for testers.
//   • PRESERVES announcements + meeting summaries entirely (also `processes`,
//     but never touched).
//
// SAFETY:
//   • Dry-run by default. Pass --apply to actually write.
//   • Before any write it dumps a full backup (target processes + their events +
//     word-cloud submissions) to ./backups/, so every change is recoverable.
//   • Prints the connecting host so you can confirm dev vs prod.
//
// Run:
//   DRY RUN (prod):  node --env-file=.env.prod --import tsx scripts/cleanupProdProcesses.ts
//   APPLY   (prod):  node --env-file=.env.prod --import tsx scripts/cleanupProdProcesses.ts --apply
//   (add --dev to target the dev project via SUPABASE_URL/SERVICE_ROLE_KEY)

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const useDev = process.argv.includes("--dev");

const url = useDev ? process.env.SUPABASE_URL : process.env.PROD_SUPABASE_URL;
const key = useDev
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    `Missing creds (${useDev ? "SUPABASE_URL/KEY" : "PROD_SUPABASE_URL/KEY"}).`,
  );
  process.exit(1);
}

// Types whose rows get ARCHIVED (test/demo civic processes).
const ARCHIVE_TYPES = [
  "civic.polis_deliberation",
  "civic.proposal",
  "civic.vote",
  "civic.vote_results",
  "civic.project",
];
// Word cloud is KEPT active; only its submissions are cleared.
const WORDCLOUD_TYPE = "civic.wordcloud";
// Never touched.
const PRESERVE_TYPES = ["civic.announcement", "civic.meeting_summary"];

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

async function main() {
  const env = useDev ? "DEV" : "PROD";
  console.log(`\n${apply ? "APPLY" : "DRY RUN"} — connecting to ${hostOf(url!)}  [${env}]\n`);

  const db = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  // --- Gather targets ---
  const { data: allProcs, error: pErr } = await db.from("processes").select("*");
  if (pErr) throw new Error(`processes: ${pErr.message}`);

  const toArchive = (allProcs ?? []).filter(
    (p) => ARCHIVE_TYPES.includes(p.type) && p.status !== "archived",
  );
  const wordclouds = (allProcs ?? []).filter((p) => p.type === WORDCLOUD_TYPE);
  const archiveIds = toArchive.map((p) => p.id);

  // Events tied to the processes we're archiving (these get deleted).
  let targetEvents: any[] = [];
  if (archiveIds.length) {
    const { data: evs, error: eErr } = await db
      .from("events")
      .select("*")
      .in("process_id", archiveIds);
    if (eErr) throw new Error(`events: ${eErr.message}`);
    targetEvents = evs ?? [];
  }

  // All word-cloud submissions (cleared so the cloud starts blank).
  const { data: wcSubs, error: wcErr } = await db
    .from("wordcloud_submissions")
    .select("*");
  if (wcErr) throw new Error(`wordcloud_submissions: ${wcErr.message}`);

  // --- Report ---
  console.log("Will ARCHIVE these processes (+ delete their events):");
  for (const p of toArchive) {
    const evCount = targetEvents.filter((e) => e.process_id === p.id).length;
    console.log(
      `  ${p.type.replace("civic.", "").padEnd(20)} ${(p.status || "").padEnd(11)} ${evCount} ev  ${(p.title || "(untitled)").slice(0, 44)}`,
    );
  }
  console.log(`\n  → ${toArchive.length} processes, ${targetEvents.length} events to delete\n`);
  console.log(
    `Word cloud KEPT active: ${wordclouds.map((w) => `"${w.title}" (${w.status})`).join(", ") || "(none)"}`,
  );
  console.log(`  → ${wcSubs?.length ?? 0} word-cloud submissions to delete (cloud starts blank)\n`);
  console.log(
    `PRESERVED untouched: ${(allProcs ?? []).filter((p) => PRESERVE_TYPES.includes(p.type)).length} announcements + meeting summaries\n`,
  );

  // --- Backup before any write ---
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const backupPath = join(dir, `cleanup-backup-${env}-${stamp}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        host: hostOf(url!),
        environment: env,
        applied: apply,
        archived_processes: toArchive,
        deleted_events: targetEvents,
        deleted_wordcloud_submissions: wcSubs ?? [],
        kept_wordclouds: wordclouds,
      },
      null,
      2,
    ),
  );
  console.log(`Backup of everything about to change written to:\n  ${backupPath}\n`);

  if (!apply) {
    console.log("DRY RUN — no changes made. Re-run with --apply to execute.\n");
    return;
  }

  // --- Apply (order: events → submissions → archive) ---
  // 1) Delete events of the archived processes (chunked to keep URLs short).
  let deletedEvents = 0;
  for (let i = 0; i < archiveIds.length; i += 50) {
    const chunk = archiveIds.slice(i, i + 50);
    const { error, count } = await db
      .from("events")
      .delete({ count: "exact" })
      .in("process_id", chunk);
    if (error) throw new Error(`delete events: ${error.message}`);
    deletedEvents += count ?? 0;
  }

  // 2) Delete all word-cloud submissions.
  const wcIds = wordclouds.map((w) => w.id);
  let deletedSubs = 0;
  if (wcIds.length) {
    const { error, count } = await db
      .from("wordcloud_submissions")
      .delete({ count: "exact" })
      .in("process_id", wcIds);
    if (error) throw new Error(`delete wc submissions: ${error.message}`);
    deletedSubs = count ?? 0;
  }

  // 3) Archive the processes.
  let archived = 0;
  for (let i = 0; i < archiveIds.length; i += 50) {
    const chunk = archiveIds.slice(i, i + 50);
    const { error, count } = await db
      .from("processes")
      .update({ status: "archived" }, { count: "exact" })
      .in("id", chunk);
    if (error) throw new Error(`archive processes: ${error.message}`);
    archived += count ?? 0;
  }

  console.log("APPLIED:");
  console.log(`  archived processes:           ${archived}`);
  console.log(`  deleted events:               ${deletedEvents}`);
  console.log(`  deleted word-cloud submissions: ${deletedSubs}`);
  console.log(`\nDone. Backup: ${backupPath}\n`);
}

main().catch((e) => {
  console.error("Cleanup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
