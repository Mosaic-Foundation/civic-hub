// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Seed a word cloud process with sample submissions into the production database.
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    env SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<prod_key> npx tsx scripts/seedProdWordcloud.ts --hub <slug>
 *
 * Safe to run multiple times — uses upsert for the process, skips existing submissions.
 *
 * To remove:
 *   env SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<prod_key> npx tsx scripts/seedProdWordcloud.ts --hub <slug> --remove
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hubArg } from "./lib/hubScope.js";

// A missing/malformed --hub must fail before anything touches the network.
const HUB = hubArg();

// Load .env manually (no dotenv dependency)
try {
  const envPath = resolve(import.meta.dirname ?? ".", "..", ".env");
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val.replace(/^["']|["']$/g, "");
  }
} catch {
  // .env not found — rely on existing env vars
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PROCESS_ID = "proc_wordcloud_floyd_001";

const PROCESS_ROW = {
  id: PROCESS_ID,
  type: "civic.wordcloud",
  process_version: "0.1",
  title: "What do you love about Floyd?",
  description: "Share what makes Floyd County special to you.",
  jurisdiction: "us-va-floyd",
  status: "active",
  content: null,
  state: {
    type: "civic.wordcloud",
    status: "active",
    prompts: [
      { id: "p1", text: "In a few words, what do you love about Floyd?" },
    ],
    lifecycle_mode: "evergreen",
    config: {
      ngram_max: 3,
      display_threshold: 1,
      max_submission_length: 280,
    },
  },
  hub_id: HUB,
  created_by: "user:civic-admin",
  source_proposal_id: null,
  starts_at: null,
  ends_at: null,
};

const SUBMISSIONS = [
  { id: "wcsub_seed_001", actor: "user-seed-1", text: "Mountains and music" },
  { id: "wcsub_seed_002", actor: "user-seed-2", text: "Small town community" },
  { id: "wcsub_seed_003", actor: "user-seed-3", text: "Beautiful mountains" },
  { id: "wcsub_seed_004", actor: "user-seed-4", text: "The community spirit" },
  { id: "wcsub_seed_005", actor: "user-seed-5", text: "Friday night jamboree" },
  { id: "wcsub_seed_006", actor: "user-seed-6", text: "Local farms and community" },
  { id: "wcsub_seed_007", actor: "user-seed-7", text: "Peace and quiet mountains" },
  { id: "wcsub_seed_008", actor: "user-seed-8", text: "Small town charm" },
  { id: "wcsub_seed_009", actor: "user-seed-9", text: "Blue Ridge mountains" },
  { id: "wcsub_seed_010", actor: "user-seed-10", text: "Friendly neighbors and community" },
  { id: "wcsub_seed_011", actor: "user-seed-11", text: "Nature and hiking trails" },
  { id: "wcsub_seed_012", actor: "user-seed-12", text: "Music heritage and traditions" },
  { id: "wcsub_seed_013", actor: "user-seed-13", text: "Farm to table food" },
  { id: "wcsub_seed_014", actor: "user-seed-14", text: "Stars at night" },
  { id: "wcsub_seed_015", actor: "user-seed-15", text: "Community events and gatherings" },
  { id: "wcsub_seed_016", actor: "user-seed-16", text: "Slow pace of life" },
  { id: "wcsub_seed_017", actor: "user-seed-17", text: "Local artisans and makers" },
  { id: "wcsub_seed_018", actor: "user-seed-18", text: "Clean air and water" },
  { id: "wcsub_seed_019", actor: "user-seed-19", text: "Bluegrass and old time music" },
  { id: "wcsub_seed_020", actor: "user-seed-20", text: "Winding country roads" },
  { id: "wcsub_seed_021", actor: "user-seed-21", text: "Friendly people everywhere" },
  { id: "wcsub_seed_022", actor: "user-seed-22", text: "The Floyd Country Store" },
  { id: "wcsub_seed_023", actor: "user-seed-23", text: "Gardening and homesteading" },
  { id: "wcsub_seed_024", actor: "user-seed-24", text: "Dark skies and fireflies" },
  { id: "wcsub_seed_025", actor: "user-seed-25", text: "Supporting local businesses" },
  { id: "wcsub_seed_026", actor: "user-seed-26", text: "Mountain views from every road" },
  { id: "wcsub_seed_027", actor: "user-seed-27", text: "Kids playing outside safely" },
  { id: "wcsub_seed_028", actor: "user-seed-28", text: "Wildflowers in the meadows" },
  { id: "wcsub_seed_029", actor: "user-seed-29", text: "Knowing your neighbors" },
  { id: "wcsub_seed_030", actor: "user-seed-30", text: "The covered farmers market" },
];

async function seed() {
  console.log(`Inserting word cloud process "${PROCESS_ROW.title}"...`);

  const { error: procErr } = await db
    .from("processes")
    .upsert(PROCESS_ROW, { onConflict: "id" });

  if (procErr) {
    console.error(`Process FAILED: ${procErr.message}`);
    process.exit(1);
  }
  console.log(`  Process OK (${PROCESS_ID})`);

  console.log("Inserting submissions...");
  for (const s of SUBMISSIONS) {
    const { error } = await db
      .from("wordcloud_submissions")
      .upsert(
        {
          id: s.id,
          process_id: PROCESS_ID,
          prompt_id: "p1",
          author_id: s.actor,
          body: s.text,
          device_token: null,
          hub_id: HUB,
        },
        { onConflict: "id" },
      );
    if (error) {
      console.error(`  "${s.text}" FAILED: ${error.message}`);
    } else {
      console.log(`  "${s.text}" OK`);
    }
  }

  console.log(`\nDone! View at: https://floyd.civic.social/wordcloud/${PROCESS_ID}`);
}

async function remove() {
  console.log("Removing word cloud demo data...");

  await db
    .from("wordcloud_submissions")
    .delete()
    .eq("process_id", PROCESS_ID)
    .eq("hub_id", HUB);
  console.log("  Submissions removed");

  await db
    .from("processes")
    .delete()
    .eq("id", PROCESS_ID)
    .eq("hub_id", HUB);
  console.log("  Process removed");

  console.log("Done.");
}

if (process.argv.includes("--remove")) {
  remove();
} else {
  seed();
}
