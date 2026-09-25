// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
// exportProdProcesses.ts — READ-ONLY backup of all civic processes.
//
// Dumps every row of `processes` (+ `wordcloud_submissions`) to a timestamped
// JSON (full fidelity) and Markdown (human-readable copy) under ./backups/.
// It NEVER writes to the database — only SELECTs + local file writes.
//
// Purpose: capture the copy/content of existing processes BEFORE a selective
// production cleanup, so test/demo processes can be referenced or reintroduced
// as seed examples later.
//
// Run against PRODUCTION:
//   node --env-file=.env.prod --import tsx scripts/exportProdProcesses.ts --hub <slug>
//   (reads PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY)
//
// Run against DEV (sanity check first):
//   node --env-file=.env --import tsx scripts/exportProdProcesses.ts --hub <slug> --dev
//   (reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hubArg } from "./lib/hubScope.js";

// A missing/malformed --hub must fail before anything touches the network.
const HUB = hubArg();

const useDev = process.argv.includes("--dev");

const url = useDev
  ? process.env.SUPABASE_URL
  : process.env.PROD_SUPABASE_URL;
const key = useDev
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    `Missing creds. Expected ${useDev ? "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" : "PROD_SUPABASE_URL/PROD_SUPABASE_SERVICE_ROLE_KEY"}.`,
  );
  process.exit(1);
}

// The five "civic process" types the cleanup would remove.
const DELETE_TYPES = new Set([
  "civic.polis_deliberation",
  "civic.proposal",
  "civic.vote",
  "civic.vote_results",
  "civic.project",
  "civic.wordcloud",
]);
// Types that MUST be preserved (BoS content).
const PRESERVE_TYPES = new Set(["civic.announcement", "civic.meeting_summary"]);

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

async function main() {
  console.log(`\nConnecting (READ-ONLY) to: ${hostOf(url!)}  [${useDev ? "DEV" : "PROD"}]\n`);

  const db = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  const { data: processes, error: pErr } = await db
    .from("processes")
    .select("*")
    .eq("hub_id", HUB)
    .order("created_at", { ascending: true });
  if (pErr) throw new Error(`processes: ${pErr.message}`);

  const { data: wc, error: wcErr } = await db
    .from("wordcloud_submissions")
    .select("*")
    .eq("hub_id", HUB)
    .order("submitted_at", { ascending: true });
  if (wcErr) throw new Error(`wordcloud_submissions: ${wcErr.message}`);

  const procs = processes ?? [];
  const wcSubs = wc ?? [];

  // Group by type.
  const byType: Record<string, typeof procs> = {};
  for (const p of procs) (byType[p.type] ??= []).push(p);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });

  // --- JSON (full fidelity) ---
  const jsonPath = join(dir, `prod-processes-${stamp}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        source_host: hostOf(url!),
        environment: useDev ? "dev" : "prod",
        process_count: procs.length,
        wordcloud_submission_count: wcSubs.length,
        delete_types: [...DELETE_TYPES],
        preserve_types: [...PRESERVE_TYPES],
        processes: procs,
        wordcloud_submissions: wcSubs,
      },
      null,
      2,
    ),
  );

  // --- Markdown (readable copy) ---
  const md: string[] = [];
  md.push(`# Civic Hub — process backup`);
  md.push(``);
  md.push(`- **Source:** ${hostOf(url!)} (${useDev ? "DEV" : "PROD"})`);
  md.push(`- **Exported:** ${new Date().toISOString()}`);
  md.push(`- **Processes:** ${procs.length} · **Word-cloud submissions:** ${wcSubs.length}`);
  md.push(``);
  md.push(`> Types in the **delete set** (would be removed by cleanup): ${[...DELETE_TYPES].join(", ")}`);
  md.push(`> Types **preserved**: ${[...PRESERVE_TYPES].join(", ")}`);
  md.push(``);

  const typeOrder = [
    ...PRESERVE_TYPES,
    "civic.polis_deliberation",
    "civic.proposal",
    "civic.vote",
    "civic.vote_results",
    "civic.project",
    "civic.wordcloud",
  ];
  const seenTypes = new Set<string>();
  for (const t of [...typeOrder, ...Object.keys(byType)]) {
    if (seenTypes.has(t) || !byType[t]) continue;
    seenTypes.add(t);
    const label = PRESERVE_TYPES.has(t)
      ? "PRESERVE"
      : DELETE_TYPES.has(t)
        ? "DELETE"
        : "OTHER";
    md.push(`\n---\n`);
    md.push(`## ${t}  —  ${byType[t].length}  *(${label})*`);
    for (const p of byType[t]) {
      md.push(``);
      md.push(`### ${p.title || "(untitled)"}`);
      md.push(`- id: \`${p.id}\` · status: \`${p.status}\` · by: \`${p.created_by || "?"}\` · created: ${(p.created_at || "").slice(0, 10)}`);
      if (p.description) md.push(`\n${p.description}\n`);
      // Surface state copy compactly (vote options, prompts, etc.)
      if (p.state && Object.keys(p.state).length) {
        md.push(`<details><summary>state</summary>\n\n\`\`\`json\n${JSON.stringify(p.state, null, 2)}\n\`\`\`\n</details>`);
      }
      if (p.content && Object.keys(p.content).length) {
        md.push(`<details><summary>content</summary>\n\n\`\`\`json\n${JSON.stringify(p.content, null, 2)}\n\`\`\`\n</details>`);
      }
      // Word-cloud submissions for this process.
      if (t === "civic.wordcloud") {
        const subs = wcSubs.filter((s) => s.process_id === p.id);
        if (subs.length) {
          md.push(`\n**Word-cloud submissions (${subs.length}):** ` + subs.map((s) => `"${s.body ?? ""}"`).join(", "));
        }
      }
    }
  }

  const mdPath = join(dir, `prod-processes-${stamp}.md`);
  writeFileSync(mdPath, md.join("\n"));

  // --- Console summary ---
  console.log("Process counts by type:");
  for (const t of Object.keys(byType).sort()) {
    const label = PRESERVE_TYPES.has(t) ? "PRESERVE" : DELETE_TYPES.has(t) ? "DELETE  " : "OTHER   ";
    console.log(`  [${label}] ${t.padEnd(26)} ${byType[t].length}`);
  }
  console.log(`\nWord-cloud submissions: ${wcSubs.length}`);
  console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}\n`);
  console.log("READ-ONLY — no database rows were modified.\n");
}

main().catch((e) => {
  console.error("Export failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
