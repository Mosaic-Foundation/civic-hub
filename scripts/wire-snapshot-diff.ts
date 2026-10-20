// Compare two wire-snapshot directories (scripts/wire-snapshot.ts).
//
//   npx tsx scripts/wire-snapshot-diff.ts <before-dir> <after-dir>
//
// Every event in BEFORE must be in AFTER with byte-identical documents in all
// three views. Events only in AFTER (written between the runs, e.g. by the
// smoke job) are counted, not compared. Exits 1 on any difference.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type Snapshot = { hub: string; documents: Array<{ event_id: string }> };

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("usage: wire-snapshot-diff.ts <before-dir> <after-dir>");
  process.exit(2);
}

let compared = 0;
let added = 0;
const problems: string[] = [];
for (const file of readdirSync(beforeDir).filter((f) => f.endsWith(".json")).sort()) {
  const before = JSON.parse(readFileSync(join(beforeDir, file), "utf8")) as Snapshot;
  const afterPath = join(afterDir, file);
  if (!existsSync(afterPath)) {
    problems.push(`${before.hub}: missing from ${afterDir}`);
    continue;
  }
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Snapshot;
  const afterById = new Map(after.documents.map((d) => [d.event_id, JSON.stringify(d)]));
  for (const doc of before.documents) {
    const now = afterById.get(doc.event_id);
    if (now === undefined) problems.push(`${before.hub}: ${doc.event_id} is gone`);
    else if (now !== JSON.stringify(doc)) problems.push(`${before.hub}: ${doc.event_id} changed`);
    compared++;
  }
  added += after.documents.length - before.documents.length;
}

console.log(`[wire-snapshot-diff] ${compared} events compared, ${added} new since the first run`);
if (problems.length > 0) {
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  console.error(`[wire-snapshot-diff] ${problems.length} difference(s)`);
  process.exit(1);
}
console.log("[wire-snapshot-diff] identical");
