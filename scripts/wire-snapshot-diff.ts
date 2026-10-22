// Compare two wire-snapshot directories (scripts/wire-snapshot.ts).
//
//   npx tsx scripts/wire-snapshot-diff.ts <before-dir> <after-dir>
//
// Every event in BEFORE must be in AFTER with byte-identical documents in all
// three views, with TWO exceptions (Architecture 3, ADR-010; Adam,
// 2026-10-21): a member or public view may differ exactly by the declared
// public-payload projection, applied to the before view the declared
// DISCLOSURE POLICY maps it onto — an anonymous type's member view must equal
// its old public one, a public type's public view its old member one
// (policyBeforeView). The admin view may never differ. Every allowed
// difference is reported, so the run's output IS the shape diff: the
// approved changes and nothing else. Events only in AFTER (written between
// the runs, e.g. by the smoke job) are counted, not compared. Exits 1 on any
// other difference.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  documentProcessType,
  policyBeforeView,
  projectDocumentPayload,
} from "../src/events/publicPayload.js";

interface SnapshotDoc {
  event_id: string;
  /** In snapshots taken since Architecture 3; the diff reads AFTER's. */
  event_type?: string;
  admin: Record<string, unknown>;
  member: Record<string, unknown>;
  public: Record<string, unknown>;
}
type Snapshot = { hub: string; documents: SnapshotDoc[] };

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("usage: wire-snapshot-diff.ts <before-dir> <after-dir>");
  process.exit(2);
}

function payloadKeys(doc: Record<string, unknown>): string[] {
  const object = doc.object;
  if (!object || typeof object !== "object") return [];
  const payload = (object as Record<string, unknown>)["hub:payload"];
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload as Record<string, unknown>);
}

let compared = 0;
let added = 0;
let identical = 0;
const problems: string[] = [];
/** "<event_type> <view>: -dropped,fields" → count of projected documents. */
const projected = new Map<string, number>();

for (const file of readdirSync(beforeDir).filter((f) => f.endsWith(".json")).sort()) {
  const before = JSON.parse(readFileSync(join(beforeDir, file), "utf8")) as Snapshot;
  const afterPath = join(afterDir, file);
  if (!existsSync(afterPath)) {
    problems.push(`${before.hub}: missing from ${afterDir}`);
    continue;
  }
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Snapshot;
  const afterById = new Map(after.documents.map((d) => [d.event_id, d]));
  for (const doc of before.documents) {
    const now = afterById.get(doc.event_id);
    compared++;
    if (now === undefined) {
      problems.push(`${before.hub}: ${doc.event_id} is gone`);
      continue;
    }
    const eventType = now.event_type ?? doc.event_type;
    let wholeDocIdentical = true;
    for (const view of ["admin", "member", "public"] as const) {
      const was = JSON.stringify(doc[view]);
      const is = JSON.stringify(now[view]);
      if (is === was) continue;
      wholeDocIdentical = false;
      if (view === "admin" || !eventType) {
        problems.push(`${before.hub}: ${doc.event_id} ${view} view changed`);
        continue;
      }
      // The before view this one must now equal (the disclosure policy's
      // mapping), then the declared payload projection on top of it.
      const base = doc[policyBeforeView(view, documentProcessType(doc[view]))];
      if (JSON.stringify(projectDocumentPayload(base, eventType)) === is) {
        const dropped = payloadKeys(base).filter((k) => !payloadKeys(now[view]).includes(k));
        const moved =
          JSON.stringify(base) !== was ? " (names per the declared disclosure policy)" : "";
        // A restricted activity is withheld from member/public callers by the
        // serving rule, so a projection there changes no byte anyone gets.
        const restricted = !JSON.stringify(doc[view].to ?? []).includes("#Public");
        const label = `${eventType} ${view}: -${dropped.sort().join(",") || "(names only)"}${moved}${
          restricted ? " (restricted; never served to this audience)" : ""
        }`;
        projected.set(label, (projected.get(label) ?? 0) + 1);
      } else {
        problems.push(`${before.hub}: ${doc.event_id} ${view} view changed beyond the declared projection`);
      }
    }
    if (wholeDocIdentical) identical++;
  }
  added += after.documents.length - before.documents.length;
}

console.log(
  `[wire-snapshot-diff] ${compared} events compared, ${identical} identical, ${added} new since the first run`,
);
if (projected.size > 0) {
  console.log("[wire-snapshot-diff] declared payload projection (the approved shape changes):");
  for (const [label, count] of [...projected.entries()].sort()) {
    console.log(`  ${count}\t${label}`);
  }
}
if (problems.length > 0) {
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  console.error(`[wire-snapshot-diff] ${problems.length} difference(s) beyond the declared projection`);
  process.exit(1);
}
console.log(
  projected.size > 0
    ? "[wire-snapshot-diff] identical apart from the declared projection above"
    : "[wire-snapshot-diff] identical",
);
