// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * One-time script to seed a demo conversation into the production database.
 * Inserts a single Flock Camera deliberation process with an "active" status
 * and a seed- conversation ID so the mock data layer serves demo statements.
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    npx tsx scripts/seedProdConversation.ts
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env (via dotenv).
 * Safe to run multiple times — uses upsert so it won't duplicate.
 *
 * To remove the demo data later:
 *   npx tsx scripts/seedProdConversation.ts --remove
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on existing env vars
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PROCESS_ID = "proc_delib_flock_001";

const FLOCK_CONVERSATION_ROW = {
  id: PROCESS_ID,
  type: "civic.polis_deliberation",
  process_version: "1.0",
  title: "Floyd County Flock Camera Use",
  description:
    "Should Floyd County continue using Flock Safety license plate reader cameras? Share your perspective.",
  jurisdiction: "us-va-floyd",
  status: "active",
  content: null,
  state: {
    polis_conversation_id: "seed-conv-flock-001",
    polis_base_url: "https://polis.civic.social/seed-conv-flock-001",
    topic: "Floyd County Flock Camera Use",
    framing:
      "Flock Safety cameras are automated license plate readers used by law enforcement in Floyd County. Some residents see them as a valuable public safety tool; others are concerned about surveillance, privacy, and the lack of public input before they were installed. What do you think?",
    deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    participation_threshold: 75,
    last_math_tick: 15,
    summary: null,
    summary_status: "pending",
    continued_from_response_id: null,
  },
  hub_id: "civic-hub-local",
  created_by: "user:civic-admin",
  source_proposal_id: null,
  starts_at: null,
  ends_at: null,
};

async function seed() {
  console.log(`Inserting demo conversation "${FLOCK_CONVERSATION_ROW.title}"...`);

  const { data, error } = await db
    .from("processes")
    .upsert(FLOCK_CONVERSATION_ROW, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("Failed to insert:", error.message);
    process.exit(1);
  }

  console.log(`Done. Process ID: ${data.id}, status: ${data.status}`);
  console.log(
    "The mock data layer will serve demo statements and opinion groups for this conversation.",
  );
}

async function remove() {
  console.log(`Removing demo conversation ${PROCESS_ID}...`);

  const { error } = await db
    .from("processes")
    .delete()
    .eq("id", PROCESS_ID);

  if (error) {
    console.error("Failed to remove:", error.message);
    process.exit(1);
  }

  console.log("Done. Demo conversation removed.");
}

const args = process.argv.slice(2);
if (args.includes("--remove")) {
  remove();
} else {
  seed();
}
