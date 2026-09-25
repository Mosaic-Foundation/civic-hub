// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
// cleanupProdLegacyTables.ts — clear the legacy `proposals` + `projects`
// tables that the Proposals/Projects tabs read directly (decoupled from the
// processes/events cleanup). Adam wants a fully fresh slate — recreate demo
// content through the normal creation flow so it shows up in the feed too.
//
// - Saves the skate-park project copy to a readable doc (so Adam can recreate it).
// - Backs up ALL proposals + projects rows to backups/ before deleting.
// - Deletes ALL proposals (cascades to proposal_supports) + ALL projects
//   (cascades to project child tables).
//
// Dry-run by default; pass --apply to write. Prints the connecting host.
//
//   DRY RUN: node --env-file=.env.prod --import tsx scripts/cleanupProdLegacyTables.ts
//   APPLY:   node --env-file=.env.prod --import tsx scripts/cleanupProdLegacyTables.ts --apply

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const useDev = process.argv.includes("--dev");
const url = useDev ? process.env.SUPABASE_URL : process.env.PROD_SUPABASE_URL;
const key = useDev ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing creds."); process.exit(1); }

function hostOf(u: string) { try { return new URL(u).host; } catch { return u; } }

async function main() {
  const env = useDev ? "DEV" : "PROD";
  console.log(`\n${apply ? "APPLY" : "DRY RUN"} — ${hostOf(url!)}  [${env}]\n`);
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: proposals, error: pe } = await db.from("proposals").select("*").order("created_at", { ascending: false });
  if (pe) throw new Error(`proposals: ${pe.message}`);
  const { data: projects, error: je } = await db.from("projects").select("*").order("created_at", { ascending: false });
  if (je) throw new Error(`projects: ${je.message}`);

  console.log(`proposals to delete: ${proposals?.length ?? 0}`);
  (proposals ?? []).forEach((p) => console.log(`  - ${(p.title || "").slice(0, 50)}  [${p.status}]`));
  console.log(`projects to delete: ${projects?.length ?? 0}`);
  (projects ?? []).forEach((p) => console.log(`  - ${(p.title || "").slice(0, 50)}  [${p.status}]`));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });

  // Full-fidelity backup of everything about to be deleted.
  const backupPath = join(dir, `legacy-tables-backup-${env}-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), host: hostOf(url!), applied: apply, proposals, projects }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  // Readable copy of every project (so Adam can recreate the skate park etc.).
  const md: string[] = ["# Saved project copy (for recreating via the new flow)", ""];
  for (const p of projects ?? []) {
    const c = (p.content ?? {}) as Record<string, unknown>;
    md.push(`## ${p.title || "(untitled)"}`);
    md.push(`- status: ${p.status} · created: ${(p.created_at || "").slice(0, 10)} · id: ${p.id}`);
    if (p.description) md.push(`\n**Description**\n\n${p.description}\n`);
    const sources = (p.sources ?? c.sources) as unknown;
    if (Array.isArray(sources) && sources.length) md.push(`**Links / sources**\n${(sources as string[]).map((s) => `- ${s}`).join("\n")}\n`);
    const banner = (p.banner_image_url ?? c.banner_image_url) as string | undefined;
    if (banner) md.push(`**Banner image**: ${banner}${p.banner_image_alt ? ` (alt: ${p.banner_image_alt})` : ""}\n`);
    md.push(`<details><summary>full row</summary>\n\n\`\`\`json\n${JSON.stringify(p, null, 2)}\n\`\`\`\n</details>\n`);
  }
  const copyPath = join(dir, `saved-project-copy-${stamp}.md`);
  writeFileSync(copyPath, md.join("\n"));
  console.log(`Project copy saved: ${copyPath}`);

  if (!apply) { console.log(`\nDRY RUN — no deletes. Re-run with --apply.\n`); return; }

  // Delete (cascades handle child rows).
  const { error: dpe, count: dpc } = await db.from("proposals").delete({ count: "exact" }).neq("id", "");
  if (dpe) throw new Error(`delete proposals: ${dpe.message}`);
  const { error: dje, count: djc } = await db.from("projects").delete({ count: "exact" }).neq("id", "");
  if (dje) throw new Error(`delete projects: ${dje.message}`);

  console.log(`\nAPPLIED: deleted ${dpc ?? 0} proposals + ${djc ?? 0} projects.\n`);
}

main().catch((e) => { console.error("Failed:", e instanceof Error ? e.message : e); process.exit(1); });
