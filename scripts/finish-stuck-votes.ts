/**
 * Finish votes that closed but were never finalized (2026-10-07).
 *
 *   node --env-file=<env file> --import tsx scripts/finish-stuck-votes.ts --hub <slug>          # dry run
 *   node --env-file=<env file> --import tsx scripts/finish-stuck-votes.ts --hub <slug> --apply
 *
 * Until 2026-10-07 a vote finished only when its brief was approved, so a vote
 * that closed while the Briefs plugin was off was never finished: it stays
 * `closed` and its results were never announced. This finishes each one the
 * way a close does today: final tally, a "Vote results" card in the feed
 * (placed at the vote's close time), and the next resident digest carries it.
 * A closed vote that has a brief is listed and left alone; it finishes when
 * its brief is approved. See scripts/lib/finishStuckVotes.ts.
 *
 * Dry run by default. Unlike the dev-only repair scripts this one may run
 * against production, which is where stuck votes would be: run the dry run
 * first and read the list.
 */

import { withScriptHub } from "./lib/hubScope.js";
import { finishStuckVotes } from "./lib/finishStuckVotes.js";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(`mode: ${APPLY ? "APPLY" : "dry run (pass --apply to write)"}\n`);
  const report = await withScriptHub(() => finishStuckVotes({ apply: APPLY }));

  if (report.stuck.length === 0) {
    console.log("No stuck votes: every closed vote has a brief, or there are none.");
  } else {
    console.log(`${APPLY ? "Finished" : "Would finish"} ${report.stuck.length} vote(s):`);
    for (const v of report.stuck) {
      const count = v.total_votes === undefined ? "" : `, ${v.total_votes} vote(s) counted`;
      console.log(`  ${v.id}  "${v.title}"  closed ${v.closed_at ?? "(unknown; stamped now)"}${count}`);
    }
  }

  if (report.failed.length > 0) {
    console.log(`\nFAILED, ${report.failed.length} vote(s) (left as they were; the rest carried on):`);
    for (const v of report.failed) console.log(`  ${v.id}  "${v.title}"  ${v.error}`);
    process.exitCode = 1; // so a failure is not missed in a terminal or a log
  }

  if (report.skipped.length > 0) {
    console.log(`\nSkipped, ${report.skipped.length} closed vote(s) whose state disagrees with the row (check by hand):`);
    for (const v of report.skipped) console.log(`  ${v.id}  "${v.title}"  ${v.reason}`);
  }

  if (report.waiting_on_brief.length > 0) {
    console.log(`\nLeft alone, ${report.waiting_on_brief.length} closed vote(s) with a brief (they finish when it is approved):`);
    for (const v of report.waiting_on_brief) console.log(`  ${v.id}  "${v.title}"  brief ${v.brief_id}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
