// @civic-raw-client-importer: operator script, run by hand outside any request; it names its hub itself.
/**
 * Seed demo proposals and projects into the production database.
 * Inserts realistic Floyd County civic data for demo purposes.
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 * Usage:    env SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<prod_key> npx tsx scripts/seedProdDemo.ts --hub <slug>
 *
 * Safe to run multiple times — uses upsert so it won't duplicate.
 *
 * To remove the demo data:
 *   env SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<prod_key> npx tsx scripts/seedProdDemo.ts --hub <slug> --remove
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
    if (!process.env[key]) process.env[key] = val;
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

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_PROPOSAL_IDS = [
  "prop_demo_farmstand_001",
  "prop_demo_trailway_001",
];

const DEMO_PROPOSALS = [
  {
    id: "prop_demo_farmstand_001",
    title: "Community Farm Stand at the Farmers Market Pavilion",
    description:
      "Establish a permanent community farm stand at the Floyd Farmers Market pavilion where local growers — especially small-scale and beginning farmers — can sell produce on non-market days. The stand would operate on a cooperative model with shared costs for insurance, signage, and a simple point-of-sale system. This gives residents more access to local food and gives farmers a low-barrier sales outlet beyond Saturday mornings.",
    links: ["https://www.floydvirginia.org/farmers-market"],
    status: "submitted",
    support_count: 3,
    submitted_by: "user:floyd-resident-1",
    category: "idea",
    assistant_helped: false,
    // closes_at omitted — column may not exist in all environments
  },
  {
    id: "prop_demo_trailway_001",
    title: "Extend the Jacksonville Center Trail to Downtown Floyd",
    description:
      "Build a multi-use trail connecting the Jacksonville Center area to downtown Floyd along the old railroad right-of-way. The 2.8-mile path would be paved and accessible for walking, biking, and wheelchair use. Similar rail-trail projects in rural Virginia have boosted local businesses and given residents a safe, car-free route for daily trips. The county already owns portions of the right-of-way, which reduces land acquisition costs.",
    links: [
      "https://www.traillink.com/trail/new-river-trail-state-park/",
      "https://www.vdot.virginia.gov/doing-business/traffic-engineering/bicycling-and-pedestrian-program/",
    ],
    status: "submitted",
    support_count: 7,
    submitted_by: "user:floyd-resident-2",
    category: "idea",
    assistant_helped: false,
    // closes_at omitted — column may not exist in all environments
  },
];

const DEMO_PROJECT_IDS = [
  "proj_demo_skatepark_001",
];

const DEMO_PROJECTS = [
  {
    id: "proj_demo_skatepark_001",
    user_id: "user:floyd-resident-3",
    title: "Floyd County Community Skate Park",
    description:
      "A proposal to build a public concrete skate park in Floyd County, giving youth and residents of all ages a dedicated space for skateboarding, scootering, and inline skating.\n\nFloyd County currently has no public skate facility. Young people who skate often use parking lots, sidewalks, and building ledges — which creates friction with business owners and safety concerns for everyone. A purpose-built park solves this while creating a positive community gathering space.\n\nProposed location: The open lot adjacent to the County Recreation Park on Route 8, which is county-owned and already has parking and restroom access.\n\nEstimated cost: $180,000–$250,000 for a 6,000 sq ft concrete park with a mix of street and transition features. Comparable rural Virginia parks (Giles County, Craig County) were built in this range.\n\nFunding approach:\n- Tony Hawk Foundation / Built to Play grant (up to $25,000)\n- Virginia Land Conservation Foundation or DCR recreational access grant\n- County capital improvement budget allocation\n- Community fundraising and in-kind labor\n\nDesign process: We'd like to work with a professional skate park designer (e.g., Spohn Ranch or American Ramp Company) who involves local skaters in the design. This ensures the park actually gets used and reflects what the community wants.\n\nThis project page is for gathering community support, sharing updates, and coordinating volunteers as the idea moves forward.",
    sources: [
      "https://skatepark.org/skatepark-grants/",
      "https://www.tonyhawkfoundation.org/skatepark-grant/",
      "https://gilescounty.org/parks-recreation.html",
    ],
    status: "active",
    support_count: 12,
    oppose_count: 2,
    assistant_helped: false,
    banner_image_url: "/skatepark-banner.jpeg",
    banner_image_alt: "Concrete skate park with bowls and rails in a rural mountain setting",
  },
];

// ---------------------------------------------------------------------------
// Seed / remove
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Seeding demo proposals and projects...\n");

  for (const p of DEMO_PROPOSALS) {
    console.log(`  Proposal: "${p.title}"`);
    const { error } = await db
      .from("proposals")
      .upsert({ ...p, hub_id: HUB }, { onConflict: "id" });
    if (error) {
      console.error(`    FAILED: ${error.message}`);
    } else {
      console.log(`    OK (${p.id})`);
    }
  }

  for (const p of DEMO_PROJECTS) {
    console.log(`  Project: "${p.title}"`);
    const { error } = await db
      .from("projects")
      .upsert({ ...p, hub_id: HUB }, { onConflict: "id" });
    if (error) {
      console.error(`    FAILED: ${error.message}`);
    } else {
      console.log(`    OK (${p.id})`);
    }
  }

  console.log("\nDone. Demo data seeded.");
}

async function remove() {
  console.log("Removing demo proposals and projects...\n");

  const { error: pe } = await db
    .from("proposals")
    .delete()
    .in("id", DEMO_PROPOSAL_IDS)
    .eq("hub_id", HUB);
  console.log(pe ? `  Proposals FAILED: ${pe.message}` : "  Proposals removed");

  const { error: re } = await db
    .from("projects")
    .delete()
    .in("id", DEMO_PROJECT_IDS)
    .eq("hub_id", HUB);
  console.log(re ? `  Projects FAILED: ${re.message}` : "  Projects removed");

  console.log("\nDone.");
}

if (process.argv.includes("--remove")) {
  remove();
} else {
  seed();
}
