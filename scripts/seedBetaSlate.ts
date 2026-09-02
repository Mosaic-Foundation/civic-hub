/**
 * Beta demo content slate — every process type in every state.
 *
 * Source of truth for WHAT is seeded lives outside the repo:
 *   ~/Documents/Civic Social/Mosaic Foundation Management/Civic Social/
 *     Floyd Civic Hub/Rollout Plan/Seed-Content-Slate.md   (v2, 2026-09-01)
 *     Floyd Civic Hub/Rollout Plan/Seed-Content-Draft.md   (verbatim text)
 *
 * Run from: ~/Developer/Civic-Social-Mono/civic-hub
 *
 *   npx tsx scripts/seedBetaSlate.ts --env dev  --dry-run   # print the plan
 *   npx tsx scripts/seedBetaSlate.ts --env dev              # rehearse on dev
 *   npx tsx scripts/seedBetaSlate.ts --env prod --dry-run
 *   npx tsx scripts/seedBetaSlate.ts --env prod             # the real thing
 *   npx tsx scripts/seedBetaSlate.ts --env prod --remove    # clear the slate
 *
 * --env dev  reads .env (the dev Supabase project).
 * --env prod reads .env.prod (PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY)
 *            and .env.prod-pull (CIVIC_ADMIN_EMAILS, CIVIC_SPACE_DID), and pins
 *            BASE_URL / CIVIC_JURISDICTION to production values so every event's
 *            action_url and jurisdiction match what the live app writes.
 *
 * HOW IT WORKS — the real code paths, not raw row upserts.
 * Processes are created through processService.createProcess; votes run
 * through the civic.vote module's own lifecycle functions (propose → support →
 * threshold → activate → close → finalize); comments through civic.input;
 * supports / updates / sentiments / completion through their modules; links
 * through processLinks; live conversations through the deliberation handler's
 * real "start" action (which creates the Polis conversation and plants the seed
 * statements). That is what makes the feed — an event projection — show the
 * slate.
 *
 * TIMESTAMPS. The events table is append-only at the database (a trigger
 * blocks UPDATE), so history cannot be backdated after the fact. Instead every
 * emitter here is handed an `emit` that stamps the slate's planned timestamp
 * at write time (the same `timestamp` override the news-sync path uses), and
 * the row tables (processes, proposals, projects, comments, ballots, …) get
 * their created_at set to match. The result: the energy conversation closed
 * ~2 weeks ago, the farm-stand vote closed ~1 week ago, the café completed
 * ~3 weeks ago, the energy vote opened ~1 week ago, the rest recent, and
 * "Where We Agree" is the newest thing in the feed.
 *
 * CIVIC BRIEFS — the one hard rule. Both demo briefs (energy conversation,
 * farm-stand vote) are real civic.brief processes built the way the universal
 * spawn seam builds them (a civic.brief row whose state is createBriefState(
 * source, content) plus the aggregation_completed event), with the slate's
 * text as the content. Recipients are recorded through the real picker
 * (setRecipients → "Board of Supervisors", "Parks & Recreation"), and
 * approveBrief runs the real approve → deliver → outcome_recorded → publish →
 * result_published → finalize-the-source sequence. The ONLY substitution is
 * the injected sendEmail: a stub that logs and never sends. This script never
 * imports the mailer, and at bootstrap it deletes SMTP_* / RESEND_API_KEY from
 * process.env so no transport can exist in this process. The recipient
 * "addresses" recorded on the brief use the RFC 2606 reserved `.invalid` TLD,
 * which cannot resolve.
 *
 * IDEMPOTENT. Every new row has a fixed id; a rerun skips what exists.
 * ARCHIVE, NEVER HARD-DELETE on seed: the one stranded duplicate is archived
 * through processService.archiveProcess. --remove reverses what this script
 * did: it deletes only the rows it created (events included — DELETE is
 * permitted, UPDATE is not), and restores the kept items from the backup it
 * stashed on their state.
 *
 * KEPT + REFINED (prod ids). Water and Recreation conversations are reopened
 * in place (they had auto-closed on 2026-08-10 by deadline); the trails vote
 * gets two demo endorsements; the tool-library proposal one demo comment; the
 * skate-park project is retitled to the Lineberry Park version and gets two
 * updates. On dev, stand-ins for these are created first so the whole matrix
 * can be rehearsed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI + environment bootstrap (MUST run before any src/ import — config is
// read at module load).
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REMOVE = argv.includes("--remove");
const envIdx = argv.indexOf("--env");
const ENV = envIdx >= 0 ? argv[envIdx + 1] : undefined;
if (ENV !== "dev" && ENV !== "prod") {
  console.error("Usage: npx tsx scripts/seedBetaSlate.ts --env dev|prod [--dry-run] [--remove]");
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname ?? ".", "..");

function readEnvFile(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(resolve(ROOT, name), "utf-8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

{
  const dev = readEnvFile(".env");
  for (const [k, v] of Object.entries(dev)) if (!process.env[k]) process.env[k] = v;

  if (ENV === "prod") {
    const prod = readEnvFile(".env.prod");
    const pull = readEnvFile(".env.prod-pull");
    if (!prod.PROD_SUPABASE_URL || !prod.PROD_SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY in .env.prod");
      process.exit(1);
    }
    process.env.SUPABASE_URL = prod.PROD_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prod.PROD_SUPABASE_SERVICE_ROLE_KEY;
    process.env.BASE_URL = "https://floyd.civic.social";
    process.env.CIVIC_UI_BASE_URL = "https://floyd.civic.social";
    process.env.CIVIC_JURISDICTION = pull.CIVIC_JURISDICTION || "us-va-floyd";
    if (pull.CIVIC_ADMIN_EMAILS && pull.CIVIC_ADMIN_EMAILS !== "[SENSITIVE]") {
      process.env.CIVIC_ADMIN_EMAILS = pull.CIVIC_ADMIN_EMAILS;
    }
    if (pull.CIVIC_SPACE_DID && pull.CIVIC_SPACE_DID !== "[SENSITIVE]") {
      process.env.CIVIC_SPACE_DID = pull.CIVIC_SPACE_DID;
    }
    // Prod's POLIS_AUTH_TOKEN is pulled as [SENSITIVE]; the dev token targets
    // the same single Polis instance (polis.civic.social).
    if (!process.env.POLIS_AUTH_TOKEN || process.env.POLIS_AUTH_TOKEN === "[SENSITIVE]") {
      process.env.POLIS_AUTH_TOKEN = dev.POLIS_AUTH_TOKEN ?? "";
    }
  }

  // Hard rule: nothing in this process may be able to send mail. The brief
  // pipeline gets a logging stub for sendEmail (below); this is belt-and-braces.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SMTP_") || k === "RESEND_API_KEY") delete process.env[k];
  }
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Imports (after env)
// ---------------------------------------------------------------------------

const { getDb } = await import("../src/db/client.js");
const {
  createProcess,
  executeAction,
  getProcess,
  saveProcessState,
  archiveProcess,
  restoreProcess,
} = await import("../src/services/processService.js");
const { emitEvent } = await import("../src/events/eventEmitter.js");
const { HUB_ID, DEFAULT_JURISDICTION } = await import("../src/config/hub.js");
const { uiBaseUrl } = await import("../src/utils/baseUrl.js");
const { createProposal, supportProposal } = await import("../src/modules/civic.proposals/index.js");
const {
  createProject,
  addProjectUpdate,
  completeProject,
  setProjectSentiment,
} = await import("../src/modules/civic.projects/index.js");
const { submitInput } = await import("../src/modules/civic.input/index.js");
const { createEdge } = await import("../src/services/processLinks.js");
const vote = await import("../src/modules/civic.vote/index.js");
const { getBallotChoicesForProcess, clearActiveVoteKeysForProcess } = await import("../src/modules/civic.receipts/index.js");
const { setRecipients, approveBrief } = await import("../src/modules/civic.brief/index.js");
const { emitBriefAggregationCompleted } = await import("../src/modules/civic.brief/events.js");

type BriefProcessState = import("../src/modules/civic.brief/index.js").BriefProcessState;
type BriefContent = import("../src/modules/civic.brief/index.js").BriefContent;
type Process = import("../src/models/process.js").Process;
type ProcessStatus = import("../src/models/process.js").ProcessStatus;
type ProcessContent = import("../src/models/process.js").ProcessContent;
type CreateEventInput = import("../src/models/event.js").CreateEventInput;
type VoteProcessState = import("../src/modules/civic.vote/index.js").VoteProcessState;

const db = getDb();
const JURISDICTION = DEFAULT_JURISDICTION;
const POLIS_BASE_URL = (process.env.POLIS_BASE_URL || "https://polis.civic.social").replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Time helpers — the slate's timeline is relative to "now"
// ---------------------------------------------------------------------------

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString();
const daysAhead = (n: number): string => new Date(NOW + n * DAY).toISOString();
const minutesAgo = (n: number): string => new Date(NOW - n * 60_000).toISOString();
/** `iso` shifted forward by n minutes — orders events within one moment. */
const plus = (iso: string, minutes: number): string => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/** An event emitter that stamps a planned timestamp (the append-only events
 *  table cannot be backdated after the fact). */
function emitAt(iso: string) {
  return (input: CreateEventInput) => emitEvent({ ...input, timestamp: input.timestamp ?? iso });
}

// ---------------------------------------------------------------------------
// Fixed ids
// ---------------------------------------------------------------------------

const ID = {
  CONV_AGREE: "proc_beta_conv_agree_001",
  CONV_DONKENNY: "proc_beta_conv_donkenny_001",
  CONV_ENERGY: "proc_beta_conv_energy_001",
  BRIEF_ENERGY: "proc_beta_brief_energy_001",
  VOTE_ENERGY: "proc_beta_vote_energy_001",
  PROP_FARMSTAND: "proc_beta_prop_farmstand_001",
  VOTE_FARMSTAND: "proc_beta_vote_farmstand_001",
  BRIEF_FARMSTAND: "proc_beta_brief_farmstand_001",
  PROJ_CAFE: "proc_beta_proj_cafe_001",
  /** The closed energy conversation is served by the seed- mock layer, not Polis. */
  ENERGY_POLIS_ID: "seed-conv-energy-001",
} as const;

const NEW_PROCESS_IDS = [
  ID.CONV_AGREE,
  ID.CONV_DONKENNY,
  ID.CONV_ENERGY,
  ID.BRIEF_ENERGY,
  ID.VOTE_ENERGY,
  ID.PROP_FARMSTAND,
  ID.VOTE_FARMSTAND,
  ID.BRIEF_FARMSTAND,
  ID.PROJ_CAFE,
];

/** Kept-and-refined items. Prod ids are the real July 2026 rows; on dev the
 *  script creates stand-ins under these ids so the matrix can be rehearsed. */
const KEEP =
  ENV === "prod"
    ? {
        WATER: "proc_7fca320b59f649c5",
        RECREATION: "proc_6fbc00d6498045ef",
        TRAILS_VOTE: "proc_861a092e431845a3",
        TOOL_LIBRARY: "proc_c34075135a2b451d",
        SKATE_PARK: "proc_58293e6945e44a98",
        /** Stranded pending_review duplicate of the skate park (changes_requested, July 1). */
        SKATE_PARK_STRANDED: "proc_d945fcbbd0e84a86",
      }
    : {
        WATER: "proc_beta_dev_water_001",
        RECREATION: "proc_beta_dev_recreation_001",
        TRAILS_VOTE: "proc_beta_dev_trailsvote_001",
        TOOL_LIBRARY: "proc_beta_dev_toollib_001",
        SKATE_PARK: "proc_beta_dev_skatepark_001",
        SKATE_PARK_STRANDED: "proc_beta_dev_skatepark_stranded_001",
      };
const DEV_STANDIN_IDS = ENV === "dev" ? Object.values(KEEP) : [];

/** Key under which kept items stash what they looked like before this script
 *  touched them, so --remove can restore them exactly. */
const BACKUP_KEY = "beta_slate_backup";

// ---------------------------------------------------------------------------
// Demo resident accounts — fictional people, non-resolvable addresses
// ---------------------------------------------------------------------------

const DEMO_USERS = [
  { id: "user_demo_beta_001", full_name: "Maya Whitlock", email: "maya.whitlock@demo.invalid" },
  { id: "user_demo_beta_002", full_name: "Reuben Sloane", email: "reuben.sloane@demo.invalid" },
  { id: "user_demo_beta_003", full_name: "Della Kirkwood", email: "della.kirkwood@demo.invalid" },
  { id: "user_demo_beta_004", full_name: "Tomas Ferrell", email: "tomas.ferrell@demo.invalid" },
] as const;
const [MAYA, REUBEN, DELLA, TOMAS] = DEMO_USERS;
const DEMO_USER_IDS = DEMO_USERS.map((u) => u.id);

/** Placeholder delivery addresses recorded on the demo briefs. `.invalid` is
 *  reserved by RFC 2606 and can never resolve; the label is what the public
 *  page shows. */
const RECIPIENT_BOARD = { email: "board-of-supervisors@demo.invalid", label: "Board of Supervisors" };
const RECIPIENT_PARKS = { email: "parks-and-recreation@demo.invalid", label: "Parks & Recreation" };

// ---------------------------------------------------------------------------
// Content — Seed-Content-Slate.md v2 + Seed-Content-Draft.md (verbatim)
// ---------------------------------------------------------------------------

const SIX_WEEKS_MS = 42 * DAY;
const TWO_WEEKS_MS = 14 * DAY;

const CONV_AGREE = {
  topic: "Where We Agree: what would help us understand each other?",
  framing:
    "Floyd is longtime families and newcomers, different backgrounds, different politics — sharing one small county. The whole idea behind this Hub is that we probably agree more than the noise suggests. So let's test that. What helps us understand each other here? Where do we already stand together? Add your view, respond to others, and let's see where the common ground really is.",
  seed_statements: [
    "We agree on more than the national news would suggest.",
    "I've had a good conversation with someone I disagree with, right here in Floyd.",
    "Newcomers should make an effort to learn Floyd's history and ways.",
    "Longtime residents should stay open to new people and new ideas.",
    "We need more events where different groups mix.",
    "Small, in-person gatherings do more for understanding than online arguing.",
    "Most people here want the same basic things for their families.",
    "It's gotten harder to talk across differences the last few years.",
    "I'd come to a neighborhood potluck or a conversation café.",
    "Faith communities have a role in bringing people together.",
    "We can disagree about politics and still be good neighbors.",
    "Local problems are easier to agree on than national ones.",
  ],
};

const CONV_DONKENNY = {
  topic: "What should happen with the Don Kenny building behind Food Lion?",
  framing:
    "The Don Kenny building behind Food Lion is one of those places everybody drives past and wonders about. Before anyone proposes anything, this is a chance to say what you'd want to see there and hear what your neighbors think. What would serve the community? What would you use? What should we be careful about?",
  seed_statements: [
    "I'd like to see it used for something the whole community can use, not just one business.",
    "Floyd needs more indoor space for gatherings, classes, and events.",
    "A youth or teen center would be a great use.",
    "Whatever goes there shouldn't add traffic or parking problems on that lot.",
    "I'd rather see a local business or maker space there than a community facility.",
    "If it costs the county money to use, it should pay for itself over time.",
    "The building's history should be honored in whatever comes next.",
    "I don't have a strong opinion; I just don't want it sitting empty.",
  ],
};

const CONV_WATER = {
  topic: "How much can Floyd's water support?",
  framing:
    "Most of us in Floyd get our water from the ground — wells and springs, not a big reservoir. That means our water is finite, and everything new draws on the same source: new homes, new businesses, more visitors in the summer. This isn't a vote and nobody's proposing a rule. It's a chance to say where we stand and find out where we already agree. Share your view, add a statement of your own, and respond to your neighbors'.",
  seed_statements: [
    "Floyd's groundwater is a shared resource, not just whatever's under my own land.",
    "I've had my well run low or go dry in the last few years.",
    "The county should know how much water we have before approving big new developments.",
    "New businesses that use a lot of water should have to show where it's coming from.",
    "Protecting our water matters more to me than making it easier to build.",
    "People should be free to use the water on their own property as they see fit.",
    "Floyd should offer incentives for rainwater capture and conservation.",
    "Honestly, I don't think we have a water problem — this is being overblown.",
    "Summer tourism and short-term rentals put extra strain on our water.",
    "I'd support limits on new subdivisions where wells are already stressed.",
    "The county should map and monitor our aquifers and springs.",
    "Farms are our biggest water users and should be part of any conversation.",
  ],
};

const CONV_RECREATION = {
  topic: "What recreational equipment do you want to see built in Floyd?",
  framing:
    "What recreational equipment and facilities would you like to see built in Floyd — and who's it for? This is wide open on purpose. Courts, a pump track or skate features, playground gear, a pool or splash pad, trails, an indoor space for winter — or something nobody's mentioned yet. Tell us what you'd use, agree or disagree with your neighbors' ideas, and add your own. Where this lands can turn into real proposals and projects.",
  seed_statements: [
    "Floyd needs more for teenagers to do.",
    "We need safe places to walk and bike that aren't along the highway.",
    "An indoor space would help us get through winter.",
    "I'd use a community pool or splash pad in the summer.",
    "I'd rather we invest in trails than in buildings or equipment.",
    "Recreation should focus on kids and families first.",
    "Older residents need options too, not just youth sports.",
    "A pickleball or tennis court would get a lot of use.",
    "Lineberry Park is underused and could do more.",
    "I'd rather we fix and maintain what we have than build something new.",
    "Recreation should be free or low-cost so everyone can use it.",
    "We need better fields and facilities for youth sports.",
  ],
};

const CONV_ENERGY = {
  topic: "Keeping the lights on: how should Floyd prepare for outages?",
  framing:
    "Most of us have lost power for a day or more at some point: ice storms, summer storms, a truck into a pole. Some folks have generators; a lot don't. This isn't a vote and nobody's proposing a rule or a rate. It's a chance to say what matters most when the grid goes down, what we'd support the county or the community doing about it, and where we already agree. Share your view, add a statement of your own, and respond to your neighbors'.",
  seed_statements: [
    "When the power goes out, keeping emergency services, water, and the clinic running matters more than anything else.",
    "I've lost power for more than 24 hours in the last few years.",
    "Floyd should have a plan for long outages, not just hope the utility gets to us fast.",
    "The grocery, the pharmacy, and gas should be able to stay open during an outage.",
    "I'd support local solar and battery storage if it meant power for critical services during outages.",
    "Homes and farms should get help, like incentives, to add their own backup power.",
    "The county shouldn't spend tax money on this; it's the utility's job.",
    "A shared community backup system makes more sense than everyone buying their own generator.",
    "I'd pay a little more on my bill for more reliable power in storms.",
    "Warming and cooling centers should be part of any outage plan.",
    "Farms with livestock and refrigeration need to be part of the plan.",
    "Outages here aren't bad enough to justify a big effort.",
  ],
};

/** The closed energy conversation's stored outcome (what CompletedDeliberation
 *  renders). Deliberately modest demo numbers; methodology says so. */
function energySummary(generatedAt: string) {
  return {
    summary_text:
      "About 35 residents took part over five weeks, responding to 12 seed statements and adding 16 of their own. The strongest agreement in the conversation, across every group: critical services come first when the power goes out — emergency services, water, and the clinic. Residents also broadly agreed that Floyd should have a plan for long outages rather than relying on restoration speed alone, that warming and cooling centers belong in any outage plan, and that farms with livestock and refrigeration need to be part of it. Views divided on who pays, on shared community backup versus helping households and farms add their own, and on how urgent any of this is.",
    directed_questions: [
      "What outage-restoration priorities does the utility already have?",
      "What would any of this cost?",
      "Where would shared batteries or solar go?",
      "Could grants cover it?",
    ],
    top_consensus_statements: [
      { statement_text: CONV_ENERGY.seed_statements[0], agree_rate: 0.94, vote_count: 33 },
      { statement_text: CONV_ENERGY.seed_statements[2], agree_rate: 0.86, vote_count: 31 },
      { statement_text: CONV_ENERGY.seed_statements[9], agree_rate: 0.82, vote_count: 30 },
      { statement_text: CONV_ENERGY.seed_statements[10], agree_rate: 0.8, vote_count: 29 },
    ],
    opinion_groups: [
      {
        group_id: 0,
        size: 16,
        representative_statements: [
          { text: CONV_ENERGY.seed_statements[7], agreement_within_group: 0.88 },
          { text: CONV_ENERGY.seed_statements[4], agreement_within_group: 0.85 },
          { text: CONV_ENERGY.seed_statements[8], agreement_within_group: 0.7 },
        ],
      },
      {
        group_id: 1,
        size: 12,
        representative_statements: [
          { text: CONV_ENERGY.seed_statements[5], agreement_within_group: 0.9 },
          { text: CONV_ENERGY.seed_statements[6], agreement_within_group: 0.67 },
        ],
      },
      {
        group_id: 2,
        size: 7,
        representative_statements: [
          { text: CONV_ENERGY.seed_statements[11], agreement_within_group: 0.71 },
          { text: CONV_ENERGY.seed_statements[6], agreement_within_group: 0.64 },
        ],
      },
    ],
    participation_stats: {
      total_participants: 35,
      total_statements: 28,
      total_votes: 612,
      opinion_groups_formed: 3,
    },
    linked_polis_data_uri: "",
    methodology: {
      prompt_version: "demo-seed",
      model_used: "Seeded demo outcome (no model run)",
      generated_at: generatedAt,
    },
  };
}

const ENERGY_BRIEF: BriefContent = {
  title: CONV_ENERGY.topic,
  headline: "Critical services come first; how to get there divides",
  summary:
    "What we asked. Not whether to build anything, but what matters most to residents when the power goes out, what they'd support doing about it, and where they already agree.\n\nWho took part. About 35 residents over five weeks, responding to 12 seed statements and adding 16 of their own.",
  sections: [
    {
      heading: "Where residents broadly agree",
      body:
        "• Critical services come first: emergency services, water, and the clinic (the strongest agreement in the conversation, across every group).\n• Floyd should have a plan for long outages rather than relying on restoration speed alone.\n• Warming and cooling centers belong in any outage plan.\n• Farms with livestock and refrigeration need to be part of it.",
    },
    {
      heading: "Where views divide",
      body:
        "• Who pays: a county role, \"it's the utility's job,\" and a small bill surcharge each drew real support, from different people.\n• Shared community backup vs. individual backup: many like the idea of a shared system; many would rather help households and farms add their own.\n• Urgency: a minority feel outages aren't bad enough to justify an effort; those who've lost power for more than a day mostly disagree.",
    },
    {
      heading: "Open questions raised",
      body:
        "What restoration priorities the utility already has; what any of this would cost; where shared batteries or solar would go; whether grants could cover it.",
    },
    {
      heading: "Suggested next steps",
      body:
        "1. Ask the county and the utility what outage-restoration priorities and plans exist today.\n2. Consider a resilience assessment focused on critical services: what we have, what's at risk, what it would cost.\n3. Explore an incentive for homes and farms to add their own solar and battery backup.\n4. Let residents weigh which of these to pursue first. (This fed the linked energy-priority vote.)",
    },
  ],
  participation_label: "About 35 residents · 28 statements",
  participation_count: 35,
  comments: [],
  admin_notes: "",
  image_url: null,
  image_alt: null,
};

const VOTE_ENERGY = {
  title: "Which energy-resilience step should Floyd pursue first?",
  description:
    "This follows the \"Keeping the lights on\" conversation, where residents broadly agreed that critical services come first during outages but split on how to get there and who pays. Rather than one yes/no, this asks which step you would want the county and the community to pursue first. One choice. It's advisory, and it tells the Board where residents want to start.",
  options: [
    "A county resilience assessment: find out what we have, what's at risk, and what it would cost.",
    "Backup power for critical services first: emergency services, water, and the clinic.",
    "Incentives for homes and farms to add their own solar and battery backup.",
    "Warming and cooling centers with backup power for long outages.",
  ],
  /** ~30 ballots so far, one choice each. */
  ballots: [9, 12, 6, 3],
};

const PROP_FARMSTAND = {
  title: "Community Farm Stand at the Farmers Market Pavilion",
  description:
    "On the days the Farmers Market isn't running, the pavilion sits empty. Several of us grow more than we can use, and we'd like to run a simple, self-serve community farm stand there on non-market days: a table, an honor box, surplus produce and eggs, priced low or pay-what-you-can. It would give neighbors an easy place to pick up fresh local food midweek, and give small growers an outlet without committing to a full market booth. We'd handle setup, cleanup, and a rotation of volunteer stewards.\n\nSupport this if you'd shop there or contribute, and comment with any concerns, especially parking, overlap with market vendors, and who keeps it tidy, so we can work them out before this goes anywhere.",
  comments: [
    { user: DELLA, body: "Yes, please. I've got more squash and eggs than I can give away by July and I'd happily keep a shelf stocked. Count me in for a steward shift." },
    { user: TOMAS, body: "I pay for a booth on Saturdays. I don't mind this as long as it doesn't run on market days and doesn't undercut what the rest of us charge. Pay-what-you-can next to my table would be a problem." },
    { user: MAYA, body: "Who's responsible when the honor box gets ignored or somebody leaves a crate of soft tomatoes on the table for three days? Cleanup needs a name attached." },
    { user: REUBEN, body: "Fair points, all. Non-market days only, stewards rotate with a posted schedule so there's always a name on it, and let's call it a one-season trial. If it's a mess by fall, we stop." },
  ],
};

const VOTE_FARMSTAND = {
  title:
    "Should the county allow a community farm stand at the Farmers Market Pavilion on non-market days?",
  description:
    "This advisory vote follows the community farm-stand proposal, which gathered enough support to come to a vote. The question is simple: should the county allow residents to run a self-serve farm stand at the Farmers Market Pavilion on the days the market isn't operating? Supporters see easy midweek access to local food and an outlet for small growers. Concerns raised so far include parking, overlap with market vendors, and upkeep. Your vote tells the Board of Supervisors and Parks & Recreation where residents stand.",
  /** 58 ballots: yes 36 (62%) · no 14 (24%) · unsure 8 (14%). */
  ballots: { yes: 36, no: 14, unsure: 8 },
};

const FARMSTAND_BRIEF: BriefContent = {
  title: VOTE_FARMSTAND.title,
  headline: "62% yes: a clear majority, with practical conditions",
  summary:
    "The question. Whether to allow a resident-run, self-serve community farm stand at the Farmers Market Pavilion on non-market days.\n\nResult. 58 residents voted over two weeks: 62% yes, 24% no, 14% unsure. A clear majority in favor, with a meaningful minority raising practical concerns rather than opposing the idea itself.",
  sections: [
    {
      heading: "What supporters said",
      body: "Midweek access to fresh local food; a low-commitment outlet for small growers; a public pavilion that sits idle most of the week.",
    },
    {
      heading: "What opponents and the unsure raised",
      body: "Competition with vendors who pay for booths; parking on busy days; who handles cleanup and food safety; whether an honor box invites problems.",
    },
    {
      heading: "Conditions that came up repeatedly",
      body: "Non-market days only; a simple use agreement with the county; a named steward rotation for setup and cleanup; a one-season trial before anything permanent.",
    },
    {
      heading: "Suggested next step",
      body: "A one-season pilot under a simple use agreement with the conditions above, and a check-in at the end of the season. The vote is advisory; any decision rests with the county.",
    },
  ],
  participation_label: "58 residents voted",
  participation_count: 58,
  comments: [],
  admin_notes: "",
  image_url: null,
  image_alt: null,
};

const VOTE_TRAILS = {
  title:
    "Should Floyd County prioritize expanding public trails and outdoor recreation facilities in the next county budget cycle?",
  description:
    "Floyd County is at a turning point on outdoor recreation. Today the county's Parks & Recreation Authority runs a 43-acre park near town — ball fields, a hiking trail, a picnic shelter, and a playground — and the recently opened Melvin and Vickie Jensen Nature Preserve added hiking trails across more than 200 acres of woodlands, streams, and farmland, with a 10-year master plan to grow it into a county destination. Citizen groups like Trails in Floyd have already mapped out a conceptual trail network — with help from Virginia Tech's Community Design Assistance Center — showing where more trails could connect.\n\nIn April 2026, the county held a community meeting — part of an EPA Recreation Economy for Rural Communities grant — to hear what residents want. Two themes came through: business owners want more amenities to draw visitors, and families want more for their kids to do close to home.\n\nExpanding trails and recreation could support local tourism, give young people more reasons to stay, and build on Floyd's location along the Blue Ridge Parkway and the Crooked Road music trail. But the county budget is tight — a large share is already committed to state-mandated costs like schools and essential services — so this means weighing recreation against other real needs.\n\nThis is an advisory vote to tell the Board of Supervisors and the Parks & Recreation Department where residents stand. Your voice matters.",
};

const PROP_TOOL_LIBRARY = {
  title: "A community tool library for Floyd",
  description:
    "I keep buying tools I use once or twice a year — a tiller in spring, a ladder for the gutters, a good drill, canning equipment in the fall — and then they sit in the shed. What if Floyd had a tool library? Members borrow instead of buy: garden and yard tools, ladders, basic power tools, maybe canning and kitchen gear. Other small towns run these out of a spare room or a shed, staffed by volunteers, sometimes with a small annual membership to cover upkeep.\n\nI'm not committing anyone to anything yet — I just want to see if there's interest before taking it further. So: would you use it? What would you want to borrow — or lend? Do you know a space that could host it?\n\nSupport this if you'd use it, and drop a comment with what you'd borrow, what you'd lend, or a space that might work.",
  demoComment: {
    user: TOMAS,
    body: "I'd lend a post-hole digger and a pressure washer, and I'd borrow a tiller every April. On space: the old shop room behind the community center sits empty most evenings. Worth asking whether a shelf of loaners could live there two nights a week.",
  },
};

const PROJ_SKATEPARK = {
  title: "Floyd Skate Park at Lineberry Park",
  description:
    "Floyd's kids and teens don't have a real place to skate. A group of us want to change that — a community skate park at Warren G. Lineberry Memorial Park, in town where families already gather. This is resident-led: we'll organize the volunteers, raise the money, gather design input from the skaters who'll use it, and coordinate with the county on the site.\n\nWhat we need right now:\n- Neighbors willing to pitch in — building, fundraising, spreading the word.\n- Skaters (all ages) to help shape the design.\n- Leads on grants, local sponsors, or donated materials.\n- Anyone with construction, concrete, or event experience.\n\nStatus: Early — gathering supporters and getting organized. Follow the project for updates, and jump in wherever you can.",
  updates: [
    "First planning meeting is set: Tuesday evening at the library meeting room. Come if you skate, or if you've got a kid who does. We'll talk site, budget range, and who's doing what.",
    "Design-input session with skaters is on the calendar. Bring sketches, photos of parks you like, and honest opinions about what gets used and what doesn't. A designer who involves local skaters is the plan, and this is where that starts.",
  ],
};

const PROJ_CAFE = {
  title: "Floyd Conversation Café: the first one",
  description:
    "Where We Agree had a lot of people saying the same thing: we need more places to talk across our differences in person, not online. So a few of us organized one. A conversation café is simple: a room, coffee, small tables, a couple of good questions, and a host who keeps it kind. No speeches, no debate, no agenda beyond understanding each other a little better. We're starting with one and seeing who shows up.",
  update1:
    "Date's set: a Thursday evening in the community room. We've got coffee and a host. Bring a neighbor you don't usually talk to.",
  completionUpdate:
    "We did it. Twenty-eight people came, longtime families and newcomers, and most stayed past closing. The two questions that worked best: \"What's something about Floyd you hope never changes?\" and \"What's a time a neighbor surprised you?\" A few folks have already asked when the next one is. If you'd help host or bring snacks, say so here and we'll plan a second.",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const log = (msg: string): void => console.log(msg);
const step = (msg: string): void => console.log(`\n▶ ${msg}`);

let ADMIN_ID = "";
let ADMIN_NAME = "Admin";

async function resolveAdmin(): Promise<void> {
  const admins = (process.env.CIVIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const { data, error } = await db.from("users").select("id,email,full_name,display_name");
  if (error) throw new Error(`users read failed: ${error.message}`);
  const match = (data ?? []).find((u) => admins.includes(String(u.email).toLowerCase()));
  if (match) {
    ADMIN_ID = match.id;
    ADMIN_NAME = match.full_name || match.display_name || "Admin";
    return;
  }
  throw new Error(
    "No user in this database matches CIVIC_ADMIN_EMAILS — the admin account must exist before seeding.",
  );
}

async function processExists(id: string): Promise<boolean> {
  const { data } = await db.from("processes").select("id").eq("id", id).maybeSingle();
  return !!data;
}

/** getProcess with the not-found check. NOTE: getProcess runs the lazy
 *  deadline-close, so never call this on an active vote whose closes_at has
 *  been set into the past unless you want the auto-close to run. */
async function loadProcess(id: string): Promise<Process> {
  const p = await getProcess(id);
  if (!p) throw new Error(`Process not found: ${id}`);
  return p;
}

/** Row-level timestamp rewrite (row tables only — never events). */
async function stampRow(
  table: string,
  match: Record<string, string>,
  createdAt: string,
  updatedAt?: string,
  createdCol = "created_at",
): Promise<void> {
  const patch: Record<string, string> = { [createdCol]: createdAt };
  if (updatedAt !== undefined) patch.updated_at = updatedAt;
  let q = db.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw new Error(`stamp ${table}: ${error.message}`);
}

/** A logging stand-in for the mailer. Records what WOULD have gone out. */
const suppressedDeliveries: Array<{ to: string[]; subject: string }> = [];
async function sendEmailSuppressed(message: { to: string[]; subject: string }): Promise<void> {
  suppressedDeliveries.push({ to: message.to, subject: message.subject });
  log(`   ✉ delivery email SUPPRESSED (not sent) — to: ${message.to.join(", ")} — "${message.subject}"`);
}

/** Polis calls the adapter does not expose (reopen/close for kept items). */
async function polisPost(path: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.POLIS_AUTH_TOKEN ?? "";
  if (!token) throw new Error("POLIS_AUTH_TOKEN is not set");
  const res = await fetch(`${POLIS_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polis ${path} → ${res.status} ${await res.text().catch(() => "")}`);
}

function serializeBallot(method: string, option: string): string {
  return method === "approval" ? JSON.stringify([option]) : option;
}

/** Insert anonymized ballot records (receipt_id + choice; no user id — the
 *  schema's ballot-secrecy guarantee). Spread evenly over the window. */
async function insertBallots(
  processId: string,
  method: string,
  distribution: Array<[option: string, count: number]>,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const rows: Array<{ receipt_id: string; process_id: string; choice: string; created_at: string }> = [];
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const pool: string[] = [];
  for (const [opt, n] of distribution) for (let i = 0; i < n; i++) pool.push(opt);
  // Deterministic shuffle so reruns produce the same interleaving.
  let seed = 7;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.forEach((opt, i) => {
    const t = from + ((to - from) * (i + 1)) / (pool.length + 1);
    rows.push({
      receipt_id: randomUUID(),
      process_id: processId,
      choice: serializeBallot(method, opt),
      created_at: new Date(t).toISOString(),
    });
  });
  const { error } = await db.from("vote_records").insert(rows);
  if (error) throw new Error(`vote_records insert: ${error.message}`);
  return rows.length;
}

async function comment(
  processId: string,
  user: { id: string; full_name: string },
  body: string,
  at: string,
  phase: "proposal" | "vote" = "proposal",
): Promise<string> {
  const input = await submitInput(
    processId,
    user.id,
    body,
    { hub_id: HUB_ID, jurisdiction: JURISDICTION, emit: emitAt(at) },
    phase,
    { is_anonymous: false, author_name: user.full_name },
  );
  await stampRow("community_inputs", { id: input.id }, at, undefined, "submitted_at");
  return input.id;
}

/** Vote lifecycle through the civic.vote module, persisted the way
 *  executeAction persists (status + state, plus the process.updated event on
 *  a status change) — with the planned timestamp on every event. */
function voteCtx(p: Process, at: string) {
  return { process_id: p.id, hub_id: p.hubId, jurisdiction: p.jurisdiction, emit: emitAt(at) };
}
async function persistVote(p: Process, state: VoteProcessState, previousStatus: string, at: string, actor: string): Promise<void> {
  p.status = state.status as ProcessStatus;
  p.state = state as unknown as Record<string, unknown>;
  await saveProcessState(p);
  if (previousStatus !== p.status) {
    await emitAt(at)({
      event_type: "civic.process.updated",
      actor,
      process_id: p.id,
      hub_id: p.hubId,
      jurisdiction: p.jurisdiction,
      processType: "civic.vote",
      data: { process: { previous_status: previousStatus, status: p.status } },
    });
  }
}
async function ballotsFor(p: Process, state: VoteProcessState) {
  const method = vote.getVotingMethod(state.method ?? vote.DEFAULT_METHOD);
  return (await getBallotChoicesForProcess(p.id)).map((c) => method.parseReceipt(c));
}

/** Stash the untouched shape of a kept item on its state, once. */
async function backup(processId: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const p = await loadProcess(processId);
  const existing = (p.state[BACKUP_KEY] ?? null) as Record<string, unknown> | null;
  if (existing) return existing;
  const snapshot = {
    title: p.title,
    description: p.description,
    status: p.status,
    deadline: (p.state as { deadline?: string | null }).deadline ?? null,
    taken_at: new Date().toISOString(),
    ...extra,
  };
  p.state[BACKUP_KEY] = snapshot;
  await saveProcessState(p);
  return snapshot;
}

async function patchBackup(processId: string, patch: Record<string, unknown>): Promise<void> {
  const p = await loadProcess(processId);
  const existing = (p.state[BACKUP_KEY] ?? {}) as Record<string, unknown>;
  p.state[BACKUP_KEY] = { ...existing, ...patch };
  await saveProcessState(p);
}

// ---------------------------------------------------------------------------
// Matrix reporting
// ---------------------------------------------------------------------------

interface MatrixRow { type: string; state: string; id: string; title: string; brief: string }

async function readMatrix(): Promise<MatrixRow[]> {
  const { data: procs, error } = await db
    .from("processes")
    .select("id,type,status,title,state")
    .in("type", ["civic.polis_deliberation", "civic.vote", "civic.proposal", "civic.project", "civic.wordcloud"])
    .neq("status", "archived")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const { data: briefs } = await db.from("processes").select("id,state").eq("type", "civic.brief");
  const briefBySource = new Map<string, string>();
  for (const b of briefs ?? []) {
    const s = b.state as { source_process_id?: string; publication_status?: string };
    if (s.source_process_id) briefBySource.set(s.source_process_id, `${b.id} (${s.publication_status})`);
  }
  const rows: MatrixRow[] = [];
  for (const p of procs ?? []) {
    const st = p.state as Record<string, unknown>;
    let state = p.status as string;
    if (p.type === "civic.polis_deliberation") state = p.status === "active" ? "open" : p.status === "draft" ? "waiting" : p.status === "pending_review" ? "in review" : "completed";
    if (p.type === "civic.vote") state = String(st.status ?? p.status);
    if (p.type === "civic.proposal") state = p.status === "active" ? "open" : p.status === "pending_review" ? "in review" : "completed";
    if (p.type === "civic.project") state = p.status === "active" ? "active" : p.status === "pending_review" ? "in review" : "completed";
    rows.push({ type: p.type.replace("civic.", ""), state, id: p.id, title: p.title, brief: briefBySource.get(p.id) ?? "" });
  }
  return rows;
}

function printMatrix(label: string, rows: MatrixRow[]): void {
  console.log(`\n=== ${label} ===`);
  const order = ["polis_deliberation", "proposal", "vote", "project", "wordcloud"];
  rows.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.state.localeCompare(b.state));
  for (const r of rows) {
    console.log(
      `${r.type.padEnd(19)} ${r.state.padEnd(10)} ${r.id.padEnd(36)} ${r.title.slice(0, 70)}${r.brief ? `  [brief ${r.brief}]` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Plan — an ordered list of steps; --dry-run prints, otherwise runs
// ---------------------------------------------------------------------------

interface Step { label: string; run: () => Promise<void> }
const plan: Step[] = [];
const add = (label: string, run: () => Promise<void>): void => { plan.push({ label, run }); };

async function createStandardProcess(input: {
  id: string; type: string; version: string; title: string; description: string; createdBy: string;
  state?: Record<string, unknown>; content?: Record<string, unknown>; at: string;
}): Promise<Process> {
  const p = await createProcess({
    id: input.id,
    definition: { type: input.type, version: input.version },
    title: input.title,
    description: input.description,
    createdBy: input.createdBy,
    jurisdiction: JURISDICTION,
    hubId: HUB_ID,
    state: input.state,
    content: input.content as unknown as ProcessContent | undefined,
    eventTimestamp: input.at,
  });
  await stampRow("processes", { id: input.id }, input.at, input.at);
  return p;
}

async function buildSeedPlan(): Promise<void> {
  // ---- 0. Demo residents --------------------------------------------------
  add("Create 4 demo resident accounts (fictional names, .invalid addresses, digest opted out)", async () => {
    for (const u of DEMO_USERS) {
      const { error } = await db.from("users").upsert(
        {
          id: u.id,
          email: u.email,
          email_verified: true,
          is_resident: true,
          full_name: u.full_name,
          digest_frequency_days: null, // never in a digest run
          created_at: daysAgo(60),
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(`users upsert ${u.id}: ${error.message}`);
      log(`   ${u.full_name} (${u.id})`);
    }
  });

  // ---- 1. Dev stand-ins for the kept prod items ---------------------------
  if (ENV === "dev") {
    add("[dev only] Create stand-ins for the kept prod items (Water, Recreation, trails vote, tool library, skate park + stranded duplicate)", async () => {
      const T0 = daysAgo(62);
      for (const conv of [
        { id: KEEP.WATER, c: CONV_WATER },
        { id: KEEP.RECREATION, c: CONV_RECREATION },
      ]) {
        if (await processExists(conv.id)) { log(`   exists: ${conv.id}`); continue; }
        await createStandardProcess({
          id: conv.id, type: "civic.polis_deliberation", version: "1.0", title: conv.c.topic, description: conv.c.framing, createdBy: ADMIN_ID, at: T0,
          state: { topic: conv.c.topic, framing: conv.c.framing, seed_statements: conv.c.seed_statements, duration_ms: SIX_WEEKS_MS },
        });
        await executeAction(conv.id, { type: "start", actor: ADMIN_ID, payload: {} });
        // Mimic prod: they auto-closed by deadline on 2026-08-10 and were finalized.
        const p = await loadProcess(conv.id);
        p.status = "finalized";
        (p.state as { deadline: string | null }).deadline = daysAgo(22);
        (p.state as { summary_status: string }).summary_status = "failed";
        await saveProcessState(p);
        await stampRow("processes", { id: conv.id }, T0, daysAgo(22));
        log(`   created finalized stand-in ${conv.id}`);
      }
      if (!(await processExists(KEEP.TRAILS_VOTE))) {
        const p = await createStandardProcess({
          id: KEEP.TRAILS_VOTE, type: "civic.vote", version: "0.1", title: VOTE_TRAILS.title, description: VOTE_TRAILS.description, createdBy: ADMIN_ID, at: T0,
          state: { method: "yes_no_unsure", options: ["yes", "no", "unsure"], activation_mode: "proposal_required", support_threshold: 5, voting_duration_ms: 90 * DAY },
        });
        let st = p.state as unknown as VoteProcessState;
        ({ state: st } = await vote.propose(st, ADMIN_ID, voteCtx(p, plus(T0, 1))));
        await persistVote(p, st, "draft", plus(T0, 1), ADMIN_ID);
        ({ state: st } = await vote.addSupport(st, ADMIN_ID, voteCtx(p, plus(T0, 2))));
        await persistVote(p, st, "proposed", plus(T0, 2), ADMIN_ID);
        log(`   created proposed stand-in ${KEEP.TRAILS_VOTE}`);
      }
      if (!(await processExists(KEEP.TOOL_LIBRARY))) {
        await createStandardProcess({
          id: KEEP.TOOL_LIBRARY, type: "civic.proposal", version: "0.1", title: PROP_TOOL_LIBRARY.title, description: PROP_TOOL_LIBRARY.description, createdBy: ADMIN_ID, at: T0,
          content: { category: "idea", optional_links: [], assistant_helped: false },
        });
        await createProposal(
          { id: KEEP.TOOL_LIBRARY, title: PROP_TOOL_LIBRARY.title, description: PROP_TOOL_LIBRARY.description, submitted_by: ADMIN_ID, category: "idea", assistant_helped: false, closes_at: daysAhead(28) },
          emitAt(T0),
        );
        await stampRow("proposals", { id: KEEP.TOOL_LIBRARY }, T0, T0);
        log(`   created open stand-in ${KEEP.TOOL_LIBRARY}`);
      }
      if (!(await processExists(KEEP.SKATE_PARK))) {
        const title = "Build a Community Skate Park in Floyd County";
        const description = "A proposal to build a public concrete skate park in Floyd County (stand-in for the prod project).";
        await createStandardProcess({ id: KEEP.SKATE_PARK, type: "civic.project", version: "0.1", title, description, createdBy: ADMIN_ID, at: T0, content: { sources: [], assistant_helped: false } });
        await createProject({ id: KEEP.SKATE_PARK, title, description, user_id: ADMIN_ID }, emitAt(T0));
        await stampRow("projects", { id: KEEP.SKATE_PARK }, T0, T0);
        log(`   created active stand-in ${KEEP.SKATE_PARK}`);
      }
      if (!(await processExists(KEEP.SKATE_PARK_STRANDED))) {
        const p = await createStandardProcess({
          id: KEEP.SKATE_PARK_STRANDED, type: "civic.project", version: "0.1", title: "Floyd County Community Skate Park",
          description: "Stranded pending-review duplicate (stand-in).", createdBy: ADMIN_ID, at: T0,
        });
        p.status = "pending_review" as ProcessStatus;
        await saveProcessState(p);
        log(`   created pending_review stand-in ${KEEP.SKATE_PARK_STRANDED}`);
      }
    });
  }

  // ---- 2. Archive what does not fit ---------------------------------------
  add(`Archive the stranded pending-review skate-park duplicate ${KEEP.SKATE_PARK_STRANDED} (restorable)`, async () => {
    const p = await getProcess(KEEP.SKATE_PARK_STRANDED);
    if (!p) { log("   not found — skipping"); return; }
    if (p.status === "archived") { log("   already archived"); return; }
    await archiveProcess(KEEP.SKATE_PARK_STRANDED, ADMIN_ID, "Beta slate: duplicate of the live skate-park project (changes requested, never resubmitted).");
    log("   archived");
  });

  // ---- 3. Energy conversation (completed + brief) --------------------------
  const T_ENERGY_CREATED = daysAgo(50);
  const T_ENERGY_CLOSED = daysAgo(15);
  const T_ENERGY_BRIEF = daysAgo(13);
  add(`Energy conversation ${ID.CONV_ENERGY}: created 50 days ago, closed 15 days ago with a stored outcome (35 participants, 28 statements; served by the seed- mock layer, no live Polis)`, async () => {
    if (await processExists(ID.CONV_ENERGY)) { log("   exists — skipping"); return; }
    const p = await createStandardProcess({
      id: ID.CONV_ENERGY, type: "civic.polis_deliberation", version: "1.0", title: CONV_ENERGY.topic, description: CONV_ENERGY.framing, createdBy: ADMIN_ID, at: T_ENERGY_CREATED,
      state: { topic: CONV_ENERGY.topic, framing: CONV_ENERGY.framing, seed_statements: CONV_ENERGY.seed_statements, duration_ms: 35 * DAY },
    });
    const st = p.state as Record<string, unknown>;
    st.polis_conversation_id = ID.ENERGY_POLIS_ID;
    st.polis_base_url = `${POLIS_BASE_URL}/${ID.ENERGY_POLIS_ID}`;
    st.deadline = T_ENERGY_CLOSED;
    st.summary = energySummary(T_ENERGY_CLOSED);
    st.summary_status = "complete";
    st.last_math_tick = 41;
    p.status = "closed";
    await saveProcessState(p);
    // The lifecycle events the real start/close actions would have emitted.
    await emitAt(plus(T_ENERGY_CREATED, 1))({
      event_type: "civic.process.started", actor: ADMIN_ID, process_id: ID.CONV_ENERGY, hub_id: HUB_ID, jurisdiction: JURISDICTION,
      processType: "civic.polis_deliberation",
      data: { process_id: ID.CONV_ENERGY, process_type: "civic.polis_deliberation", polis_conversation_id: ID.ENERGY_POLIS_ID, topic: CONV_ENERGY.topic },
    });
    await emitAt(T_ENERGY_CLOSED)({
      event_type: "civic.process.ended", actor: "system:auto-close", process_id: ID.CONV_ENERGY, hub_id: HUB_ID, jurisdiction: JURISDICTION,
      processType: "civic.polis_deliberation",
      data: { process_id: ID.CONV_ENERGY, process_type: "civic.polis_deliberation", summary_status: "complete", participation_stats: (st.summary as ReturnType<typeof energySummary>).participation_stats },
    });
    await stampRow("processes", { id: ID.CONV_ENERGY }, T_ENERGY_CREATED, T_ENERGY_CLOSED);
    log("   created + closed");
  });

  add(`Energy brief ${ID.BRIEF_ENERGY}: civic.brief from the closed conversation → slate text → recipients "Board of Supervisors" → approve (email SUPPRESSED) → publish → finalize the conversation`, async () => {
    if (await processExists(ID.BRIEF_ENERGY)) { log("   exists — skipping"); return; }
    await publishDemoBrief(ID.BRIEF_ENERGY, ID.CONV_ENERGY, "civic.polis_deliberation", ENERGY_BRIEF, [RECIPIENT_BOARD], T_ENERGY_CLOSED, T_ENERGY_BRIEF);
  });

  // ---- 4. Energy vote (active) ---------------------------------------------
  const T_EVOTE_OPEN = daysAgo(7);
  add(`Energy vote ${ID.VOTE_ENERGY}: active, opened 7 days ago, 7 days left, ~30 ballots; links → energy conversation`, async () => {
    if (await processExists(ID.VOTE_ENERGY)) { log("   exists — skipping"); return; }
    const p = await createStandardProcess({
      id: ID.VOTE_ENERGY, type: "civic.vote", version: "0.1", title: VOTE_ENERGY.title, description: VOTE_ENERGY.description, createdBy: ADMIN_ID, at: T_EVOTE_OPEN,
      state: { method: "approval", options: VOTE_ENERGY.options, activation_mode: "direct", voting_duration_ms: TWO_WEEKS_MS },
    });
    let st = p.state as unknown as VoteProcessState;
    ({ state: st } = await vote.activate(st, ADMIN_ID, voteCtx(p, plus(T_EVOTE_OPEN, 1))));
    st.voting_opens_at = T_EVOTE_OPEN;
    st.voting_closes_at = daysAhead(7);
    const n = await insertBallots(
      ID.VOTE_ENERGY, "approval",
      VOTE_ENERGY.options.map((o, i) => [o, VOTE_ENERGY.ballots[i]] as [string, number]),
      T_EVOTE_OPEN, daysAgo(0.5),
    );
    st.total_votes = n;
    await persistVote(p, st, "draft", plus(T_EVOTE_OPEN, 1), ADMIN_ID);
    await stampRow("processes", { id: ID.VOTE_ENERGY }, T_EVOTE_OPEN, daysAgo(0.5));
    await createEdge(ID.VOTE_ENERGY, { to_id: ID.CONV_ENERGY, relation: "continues" }, ADMIN_ID);
    log(`   active with ${n} ballots; linked`);
  });

  // ---- 5. Farm-stand proposal (completed → advanced to a vote) -------------
  const T_PROP_CREATED = daysAgo(35);
  const T_PROP_CONVERTED = daysAgo(21);
  add(`Farm-stand proposal ${ID.PROP_FARMSTAND}: by Reuben 35 days ago, 5 supports, 4 comments; advanced to the vote 21 days ago`, async () => {
    if (await processExists(ID.PROP_FARMSTAND)) { log("   exists — skipping"); return; }
    await createStandardProcess({
      id: ID.PROP_FARMSTAND, type: "civic.proposal", version: "0.1", title: PROP_FARMSTAND.title, description: PROP_FARMSTAND.description, createdBy: REUBEN.id, at: T_PROP_CREATED,
      content: { category: "idea", optional_links: [], assistant_helped: false },
    });
    await createProposal(
      { id: ID.PROP_FARMSTAND, title: PROP_FARMSTAND.title, description: PROP_FARMSTAND.description, submitted_by: REUBEN.id, category: "idea", assistant_helped: false, closes_at: T_PROP_CONVERTED },
      emitAt(T_PROP_CREATED),
    );
    await stampRow("proposals", { id: ID.PROP_FARMSTAND }, T_PROP_CREATED, T_PROP_CREATED);
    let i = 0;
    for (const uid of [DELLA.id, MAYA.id, TOMAS.id, ADMIN_ID]) {
      const at = daysAgo(34 - i * 2);
      await supportProposal(ID.PROP_FARMSTAND, uid, emitAt(at));
      await stampRow("proposal_supports", { proposal_id: ID.PROP_FARMSTAND, user_id: uid }, at);
      i++;
    }
    let c = 0;
    for (const cm of PROP_FARMSTAND.comments) {
      await comment(ID.PROP_FARMSTAND, cm.user, cm.body, daysAgo(33 - c * 1.5), "proposal");
      c++;
    }
    // 5th support after the discussion settles it
    await supportProposal(ID.PROP_FARMSTAND, REUBEN.id, emitAt(daysAgo(22)));
    await stampRow("proposal_supports", { proposal_id: ID.PROP_FARMSTAND, user_id: REUBEN.id }, daysAgo(22));
    // Advanced: "converted" is the proposal's outcome vocabulary; it points at the vote.
    const { error: pe } = await db.from("proposals").update({ status: "converted", converted_to_process_id: ID.VOTE_FARMSTAND, updated_at: T_PROP_CONVERTED }).eq("id", ID.PROP_FARMSTAND);
    if (pe) throw new Error(`proposal convert: ${pe.message}`);
    const { error: pe2 } = await db.from("processes").update({ status: "closed", updated_at: T_PROP_CONVERTED }).eq("id", ID.PROP_FARMSTAND);
    if (pe2) throw new Error(`proposal process close: ${pe2.message}`);
    // civic.proposal.closed is the canonical close event (feed-silent by
    // design — the vote's brief is the announcement); the pointer to the vote
    // rides along in data and on the proposals row.
    await emitAt(T_PROP_CONVERTED)({
      event_type: "civic.proposal.closed", actor: "system:proposal-threshold", process_id: ID.PROP_FARMSTAND, hub_id: HUB_ID, jurisdiction: JURISDICTION,
      processType: "civic.proposal",
      data: { proposal: { support_count: 5, support_threshold: 5, converted_to_process_id: ID.VOTE_FARMSTAND } },
    });
    log("   created with supports + comments; advanced");
  });

  // ---- 6. Farm-stand vote (closed + brief) ---------------------------------
  const T_FVOTE_OPEN = daysAgo(21);
  const T_FVOTE_CLOSE = daysAgo(7);
  const T_FVOTE_BRIEF = daysAgo(5);
  add(`Farm-stand vote ${ID.VOTE_FARMSTAND}: proposed → 5 endorsements → threshold met → opened 21 days ago → 58 ballots → closed 7 days ago; links → proposal`, async () => {
    if (await processExists(ID.VOTE_FARMSTAND)) { log("   exists — skipping"); return; }
    const p = await createStandardProcess({
      id: ID.VOTE_FARMSTAND, type: "civic.vote", version: "0.1", title: VOTE_FARMSTAND.title, description: VOTE_FARMSTAND.description, createdBy: REUBEN.id, at: T_PROP_CONVERTED,
      state: { method: "yes_no_unsure", options: ["yes", "no", "unsure"], activation_mode: "proposal_required", support_threshold: 5, voting_duration_ms: TWO_WEEKS_MS, source_proposal_id: ID.PROP_FARMSTAND },
    });
    let st = p.state as unknown as VoteProcessState;
    ({ state: st } = await vote.propose(st, REUBEN.id, voteCtx(p, plus(T_PROP_CONVERTED, 1))));
    await persistVote(p, st, "draft", plus(T_PROP_CONVERTED, 1), REUBEN.id);
    let m = 2;
    for (const uid of [DELLA.id, MAYA.id, TOMAS.id, ADMIN_ID, REUBEN.id]) {
      const prev = st.status;
      ({ state: st } = await vote.addSupport(st, uid, voteCtx(p, plus(T_PROP_CONVERTED, m))));
      await persistVote(p, st, prev, plus(T_PROP_CONVERTED, m), uid);
      m++;
    }
    if (st.status !== "active") throw new Error(`farm-stand vote should be active after threshold, is ${st.status}`);
    st.voting_opens_at = T_FVOTE_OPEN;
    st.voting_closes_at = T_FVOTE_CLOSE;
    const n = await insertBallots(
      ID.VOTE_FARMSTAND, "yes_no_unsure",
      [["yes", VOTE_FARMSTAND.ballots.yes], ["no", VOTE_FARMSTAND.ballots.no], ["unsure", VOTE_FARMSTAND.ballots.unsure]],
      T_FVOTE_OPEN, T_FVOTE_CLOSE,
    );
    st.total_votes = n;
    // Close through the module (what process.close does): tally from the
    // anonymized receipts, emit ended/closed, drop the receipt bridge.
    ({ state: st } = await vote.closeVote(st, "system:auto-close", await ballotsFor(p, st), voteCtx(p, T_FVOTE_CLOSE)));
    await persistVote(p, st, "active", T_FVOTE_CLOSE, "system:auto-close");
    await clearActiveVoteKeysForProcess(ID.VOTE_FARMSTAND);
    await stampRow("processes", { id: ID.VOTE_FARMSTAND }, T_PROP_CONVERTED, T_FVOTE_CLOSE);
    await createEdge(ID.VOTE_FARMSTAND, { to_id: ID.PROP_FARMSTAND, relation: "continues" }, REUBEN.id);
    log(`   closed with ${n} ballots; linked`);
  });

  add(`Farm-stand brief ${ID.BRIEF_FARMSTAND}: civic.brief from the closed vote → slate text → recipients "Board of Supervisors" + "Parks & Recreation" → approve (email SUPPRESSED) → publish → finalize the vote`, async () => {
    if (await processExists(ID.BRIEF_FARMSTAND)) { log("   exists — skipping"); return; }
    await publishDemoBrief(ID.BRIEF_FARMSTAND, ID.VOTE_FARMSTAND, "civic.vote", FARMSTAND_BRIEF, [RECIPIENT_BOARD, RECIPIENT_PARKS], T_FVOTE_CLOSE, T_FVOTE_BRIEF);
  });

  // ---- 7. Café project (completed) -----------------------------------------
  const T_CAFE_CREATED = daysAgo(40);
  const T_CAFE_DONE = daysAgo(21);
  add(`Café project ${ID.PROJ_CAFE}: by Della 40 days ago, 3 supporters, update 1, completion update, completed 21 days ago`, async () => {
    if (await processExists(ID.PROJ_CAFE)) { log("   exists — skipping"); return; }
    await createStandardProcess({
      id: ID.PROJ_CAFE, type: "civic.project", version: "0.1", title: PROJ_CAFE.title, description: PROJ_CAFE.description, createdBy: DELLA.id, at: T_CAFE_CREATED,
      content: { sources: [], assistant_helped: false },
    });
    await createProject({ id: ID.PROJ_CAFE, title: PROJ_CAFE.title, description: PROJ_CAFE.description, user_id: DELLA.id }, emitAt(T_CAFE_CREATED));
    await stampRow("projects", { id: ID.PROJ_CAFE }, T_CAFE_CREATED, T_CAFE_CREATED);
    let i = 0;
    for (const uid of [MAYA.id, TOMAS.id, ADMIN_ID]) {
      const at = daysAgo(39 - i * 2);
      await setProjectSentiment(ID.PROJ_CAFE, uid, "support", emitAt(at));
      await stampRow("project_sentiments", { project_id: ID.PROJ_CAFE, user_id: uid }, at, at);
      i++;
    }
    const u1 = await addProjectUpdate(ID.PROJ_CAFE, DELLA.id, PROJ_CAFE.update1, [], emitAt(daysAgo(36)));
    await stampRow("project_updates", { id: u1.id }, daysAgo(36));
    const u2 = await addProjectUpdate(ID.PROJ_CAFE, DELLA.id, PROJ_CAFE.completionUpdate, [], emitAt(T_CAFE_DONE));
    await stampRow("project_updates", { id: u2.id }, T_CAFE_DONE);
    await completeProject(ID.PROJ_CAFE, DELLA.id, emitAt(plus(T_CAFE_DONE, 1)));
    await stampRow("processes", { id: ID.PROJ_CAFE }, T_CAFE_CREATED, T_CAFE_DONE);
    await stampRow("projects", { id: ID.PROJ_CAFE }, T_CAFE_CREATED, T_CAFE_DONE);
    log("   completed");
  });

  // ---- 8. Kept items: refine ------------------------------------------------
  add(`Trails vote ${KEEP.TRAILS_VOTE}: +2 demo endorsements (Maya 3 days ago, Della 2 days ago) → "needs 2 more"`, async () => {
    const p = await loadProcess(KEEP.TRAILS_VOTE);
    let st = p.state as unknown as VoteProcessState;
    if (st.status !== "proposed") { log(`   not in proposed state (${st.status}) — skipping`); return; }
    const bk = await backup(KEEP.TRAILS_VOTE, { supporters_added: [] as string[] });
    const added: string[] = Array.isArray(bk.supporters_added) ? [...(bk.supporters_added as string[])] : [];
    let i = 0;
    for (const uid of [MAYA.id, DELLA.id]) {
      if (st.supporters[uid]) { i++; continue; }
      if (st.support_count + 1 >= st.config.support_threshold) { log("   would cross the threshold — stopping short"); break; }
      const at = daysAgo(3 - i);
      ({ state: st } = await vote.addSupport(st, uid, voteCtx(p, at)));
      await persistVote(p, st, "proposed", at, uid);
      added.push(uid);
      i++;
    }
    await patchBackup(KEEP.TRAILS_VOTE, { supporters_added: added });
    log(`   ${st.support_count} of ${st.config.support_threshold} endorsements (needs ${st.config.support_threshold - st.support_count} more)`);
  });

  add(`Tool-library proposal ${KEEP.TOOL_LIBRARY}: +1 demo comment (Tomas, 4 days ago: what he'd lend, a possible space)`, async () => {
    const bk = await backup(KEEP.TOOL_LIBRARY, { comment_ids: [] as string[] });
    if (Array.isArray(bk.comment_ids) && (bk.comment_ids as string[]).length > 0) { log("   already added"); return; }
    const id = await comment(KEEP.TOOL_LIBRARY, PROP_TOOL_LIBRARY.demoComment.user, PROP_TOOL_LIBRARY.demoComment.body, daysAgo(4), "proposal");
    await patchBackup(KEEP.TOOL_LIBRARY, { comment_ids: [id] });
    log("   commented");
  });

  add(`Skate-park project ${KEEP.SKATE_PARK}: retitle to "Floyd Skate Park at Lineberry Park" (Draft §PROJECT verbatim), +2 updates (12 and 2 days ago); links → Recreation conversation + trails vote`, async () => {
    const bk = await backup(KEEP.SKATE_PARK, { update_ids: [] as string[] });
    const p = await loadProcess(KEEP.SKATE_PARK);
    const { error: e1 } = await db.from("processes").update({ title: PROJ_SKATEPARK.title, description: PROJ_SKATEPARK.description }).eq("id", KEEP.SKATE_PARK);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db.from("projects").update({ title: PROJ_SKATEPARK.title, description: PROJ_SKATEPARK.description }).eq("id", KEEP.SKATE_PARK);
    if (e2) throw new Error(e2.message);
    if (!(Array.isArray(bk.update_ids) && (bk.update_ids as string[]).length > 0)) {
      const { data: proj } = await db.from("projects").select("user_id").eq("id", KEEP.SKATE_PARK).single();
      const creator = (proj?.user_id as string) ?? p.createdBy;
      const ids: string[] = [];
      const at = [daysAgo(12), daysAgo(2)];
      for (let i = 0; i < PROJ_SKATEPARK.updates.length; i++) {
        const u = await addProjectUpdate(KEEP.SKATE_PARK, creator, PROJ_SKATEPARK.updates[i], [], emitAt(at[i]));
        await stampRow("project_updates", { id: u.id }, at[i]);
        ids.push(u.id);
      }
      await patchBackup(KEEP.SKATE_PARK, { update_ids: ids });
    }
    await createEdge(KEEP.SKATE_PARK, { to_id: KEEP.RECREATION, relation: "references" }, ADMIN_ID);
    await createEdge(KEEP.SKATE_PARK, { to_id: KEEP.TRAILS_VOTE, relation: "references" }, ADMIN_ID);
    await createEdge(KEEP.TRAILS_VOTE, { to_id: KEEP.RECREATION, relation: "continues" }, ADMIN_ID);
    log("   refined + linked");
  });

  for (const conv of [
    { id: KEEP.WATER, label: "Water" },
    { id: KEEP.RECREATION, label: "Recreation" },
  ]) {
    add(`${conv.label} conversation ${conv.id}: reopen in place (finalized by deadline on 2026-08-10) → active, deadline +6 weeks, Polis conversation reopened; participation data untouched`, async () => {
      const p = await loadProcess(conv.id);
      if (p.status === "active") { log("   already active"); return; }
      await backup(conv.id);
      const fresh = await loadProcess(conv.id);
      const st = fresh.state as { polis_conversation_id: string; deadline: string | null };
      try {
        await polisPost("/api/v3/conversation/reopen", { conversation_id: st.polis_conversation_id });
        log(`   Polis ${st.polis_conversation_id} reopened`);
      } catch (err) {
        log(`   ⚠ Polis reopen failed (${err instanceof Error ? err.message : err}) — continuing; check polis.civic.social admin`);
      }
      const { error } = await db.from("processes").update({ status: "active", state: { ...fresh.state, deadline: daysAhead(42) }, updated_at: new Date().toISOString() }).eq("id", conv.id);
      if (error) throw new Error(error.message);
      await emitEvent({
        event_type: "civic.process.updated", actor: ADMIN_ID, process_id: conv.id, hub_id: HUB_ID, jurisdiction: JURISDICTION,
        processType: "civic.polis_deliberation",
        data: { process: { previous_status: p.status, status: "active" }, reason: "beta slate: reopened" },
      });
      log("   reopened");
    });
  }

  // ---- 9. Open conversations with live Polis (Don Kenny, then Where We Agree last so it leads the feed)
  for (const conv of [
    { id: ID.CONV_DONKENNY, c: CONV_DONKENNY, by: MAYA.id, at: minutesAgo(40) },
    { id: ID.CONV_AGREE, c: CONV_AGREE, by: ADMIN_ID, at: minutesAgo(1) },
  ]) {
    add(`Conversation ${conv.id} "${conv.c.topic}": create + start (real Polis conversation, ${conv.c.seed_statements.length} seed statements, 6-week window)`, async () => {
      if (await processExists(conv.id)) { log("   exists — skipping"); return; }
      await createStandardProcess({
        id: conv.id, type: "civic.polis_deliberation", version: "1.0", title: conv.c.topic, description: conv.c.framing, createdBy: conv.by, at: conv.at,
        state: { topic: conv.c.topic, framing: conv.c.framing, seed_statements: conv.c.seed_statements, duration_ms: SIX_WEEKS_MS },
      });
      const r = await executeAction(conv.id, { type: "start", actor: conv.by, payload: {} });
      await stampRow("processes", { id: conv.id }, conv.at, conv.at);
      log(`   live — Polis ${String(r.result.polis_conversation_id)}`);
    });
  }

  add(`Link: café project → Where We Agree (continues)`, async () => {
    await createEdge(ID.PROJ_CAFE, { to_id: ID.CONV_AGREE, relation: "continues" }, DELLA.id);
    log("   linked");
  });
}

/**
 * The real brief pipeline with one substitution (sendEmail → logging stub).
 *
 * Build the civic.brief the way spawnBriefFromClosedProcess does (a process
 * whose state is createBriefState(source, content) — the brief handler's
 * initializeState — plus the aggregation_completed event), with the slate
 * text as content. Then the real review + approval sequence: setRecipients →
 * approveBrief (approved → deliver → outcome_recorded → published →
 * result_published → finalize the source). Timestamps: creation at the
 * source's close, approval/publication two days later.
 */
async function publishDemoBrief(
  briefId: string,
  sourceId: string,
  sourceType: string,
  content: BriefContent,
  recipients: Array<{ email: string; label: string }>,
  closedAt: string,
  publishedAt: string,
): Promise<void> {
  const src = await loadProcess(sourceId);
  const record = await createStandardProcess({
    id: briefId, type: "civic.brief", version: "0.1", title: src.title, description: src.description, createdBy: "system:brief-spawn", at: closedAt,
    state: { source_process_id: sourceId, source_process_type: sourceType, content },
  });
  const state = record.state as unknown as BriefProcessState;
  const ctxAt = (at: string) => ({ process_id: record.id, hub_id: record.hubId, jurisdiction: record.jurisdiction, emit: emitAt(at) });
  await emitBriefAggregationCompleted(ctxAt(plus(closedAt, 1)), "system:brief-spawn", state);
  state.generated_at = closedAt;

  setRecipients(state, recipients);
  await saveProcessState(record);

  await approveBrief(state, ADMIN_ID, ctxAt(publishedAt), {
    fallbackRecipients: [],
    hubLabel: "Floyd Civic Hub",
    publicBriefUrl: `${uiBaseUrl()}/brief/${record.id}`,
    sendEmail: sendEmailSuppressed,
    // Mirrors services/briefFinalize.ts, with the planned timestamp on the
    // source's finalize events (that service's emitter would stamp "now").
    finalizeSource: async (sourceProcessId, sourceProcessType, actor) => {
      const s = await loadProcess(sourceProcessId);
      if (s.status === "finalized") return;
      if (sourceProcessType === "civic.vote") {
        let vState = s.state as unknown as VoteProcessState;
        ({ state: vState } = await vote.finalizeVote(vState, actor, await ballotsFor(s, vState), voteCtx(s, publishedAt)));
        s.status = vState.status as ProcessStatus;
        s.state = vState as unknown as Record<string, unknown>;
        await saveProcessState(s);
        return;
      }
      s.status = "finalized";
      await saveProcessState(s);
    },
  });
  record.status = "finalized";
  state.approved_at = publishedAt;
  state.published_at = publishedAt;
  state.delivered_at = publishedAt;
  record.state = state as unknown as Record<string, unknown>;
  await saveProcessState(record);
  await stampRow("processes", { id: briefId }, closedAt, publishedAt);
  {
    const { error } = await db.from("processes").update({ updated_at: publishedAt }).eq("id", sourceId);
    if (error) throw new Error(`stamp source updated_at: ${error.message}`);
  }
  log(`   brief ${briefId} published; sent_to = ${JSON.stringify(state.delivered_to_labels)}; status "Awaiting response"`);
}

// ---------------------------------------------------------------------------
// --remove: reverse everything this script did
// ---------------------------------------------------------------------------

async function del(table: string, col: string, values: string[]): Promise<void> {
  if (values.length === 0) return;
  const { error } = await db.from(table).delete().in(col, values);
  if (error) throw new Error(`delete ${table}.${col}: ${error.message}`);
}

async function buildRemovePlan(): Promise<void> {
  const created = [...NEW_PROCESS_IDS, ...DEV_STANDIN_IDS];

  add(`Close the live Polis conversations the script created (best-effort)`, async () => {
    for (const id of [ID.CONV_AGREE, ID.CONV_DONKENNY, ...(ENV === "dev" ? [KEEP.WATER, KEEP.RECREATION] : [])]) {
      const { data } = await db.from("processes").select("state").eq("id", id).maybeSingle();
      const cid = (data?.state as { polis_conversation_id?: string } | null)?.polis_conversation_id;
      if (!cid || cid.startsWith("seed-")) continue;
      try { await polisPost("/api/v3/conversation/close", { conversation_id: cid }); log(`   closed Polis ${cid}`); }
      catch (err) { log(`   ⚠ could not close Polis ${cid}: ${err instanceof Error ? err.message : err}`); }
    }
  });

  add(`Delete the processes this script created (${created.length}, briefs included) with their responses, comments, supports, ballots, updates, sentiments, links, and events`, async () => {
    await del("brief_responses", "brief_id", created);
    await del("community_inputs", "process_id", created);
    await del("proposal_supports", "proposal_id", created);
    await del("project_updates", "project_id", created);
    await del("project_comments", "project_id", created);
    await del("project_sentiments", "project_id", created);
    await del("vote_records", "process_id", created);
    await del("vote_participation", "process_id", created);
    await del("active_vote_keys", "process_id", created);
    await del("deliberation_submissions", "process_id", created);
    await del("process_links", "from_id", created);
    await del("process_links", "to_id", created);
    await del("events", "process_id", created);
    await del("proposals", "id", created);
    await del("projects", "id", created);
    await del("processes", "id", created);
    log("   removed");
  });

  if (ENV === "prod") {
    add("Restore the kept items from their stashed backups (trails vote endorsements, tool-library comment, skate-park title/updates, Water/Recreation status)", async () => {
      // Trails vote: drop the demo supporters
      {
        const p = await getProcess(KEEP.TRAILS_VOTE);
        const bk = p?.state[BACKUP_KEY] as { supporters_added?: string[] } | undefined;
        if (p && bk) {
          const st = p.state as { supporters: Record<string, boolean>; support_count: number };
          for (const uid of bk.supporters_added ?? []) {
            if (st.supporters[uid]) { delete st.supporters[uid]; st.support_count -= 1; }
          }
          delete p.state[BACKUP_KEY];
          await saveProcessState(p);
          const { error } = await db.from("events").delete().eq("process_id", KEEP.TRAILS_VOTE).in("actor", DEMO_USER_IDS);
          if (error) throw new Error(error.message);
          log("   trails vote restored");
        }
      }
      // Tool library: drop the demo comment
      {
        const p = await getProcess(KEEP.TOOL_LIBRARY);
        const bk = p?.state[BACKUP_KEY] as { comment_ids?: string[] } | undefined;
        if (p && bk) {
          await del("community_inputs", "id", bk.comment_ids ?? []);
          const { error } = await db.from("events").delete().eq("process_id", KEEP.TOOL_LIBRARY).in("actor", DEMO_USER_IDS);
          if (error) throw new Error(error.message);
          delete p.state[BACKUP_KEY];
          await saveProcessState(p);
          log("   tool library restored");
        }
      }
      // Skate park: title/description back, updates gone, links gone
      {
        const p = await getProcess(KEEP.SKATE_PARK);
        const bk = p?.state[BACKUP_KEY] as { title?: string; description?: string; update_ids?: string[] } | undefined;
        if (p && bk) {
          const ids = bk.update_ids ?? [];
          if (ids.length) {
            const { data: ups } = await db.from("project_updates").select("id,created_at").in("id", ids);
            for (const u of ups ?? []) {
              await db.from("events").delete().eq("process_id", KEEP.SKATE_PARK).eq("event_type", "civic.project.updated").eq("created_at", u.created_at);
            }
            await del("project_updates", "id", ids);
          }
          await db.from("processes").update({ title: bk.title, description: bk.description }).eq("id", KEEP.SKATE_PARK);
          await db.from("projects").update({ title: bk.title, description: bk.description }).eq("id", KEEP.SKATE_PARK);
          await db.from("process_links").delete().eq("from_id", KEEP.SKATE_PARK).in("to_id", [KEEP.RECREATION, KEEP.TRAILS_VOTE]);
          await db.from("process_links").delete().eq("from_id", KEEP.TRAILS_VOTE).eq("to_id", KEEP.RECREATION);
          const fresh = await loadProcess(KEEP.SKATE_PARK);
          delete fresh.state[BACKUP_KEY];
          await saveProcessState(fresh);
          log("   skate park restored");
        }
      }
      // Water / Recreation: back to finalized with the old deadline; Polis closed again
      for (const id of [KEEP.WATER, KEEP.RECREATION]) {
        const p = await getProcess(id);
        const bk = p?.state[BACKUP_KEY] as { status?: string; deadline?: string | null } | undefined;
        if (p && bk) {
          const cid = (p.state as { polis_conversation_id?: string }).polis_conversation_id;
          if (cid) { try { await polisPost("/api/v3/conversation/close", { conversation_id: cid }); } catch { /* best-effort */ } }
          const state = { ...p.state, deadline: bk.deadline ?? null };
          delete (state as Record<string, unknown>)[BACKUP_KEY];
          await db.from("processes").update({ status: bk.status ?? "finalized", state, updated_at: new Date().toISOString() }).eq("id", id);
          await db.from("events").delete().eq("process_id", id).eq("event_type", "civic.process.updated").contains("data", { reason: "beta slate: reopened" });
          log(`   ${id} restored to ${bk.status}`);
        }
      }
    });
    add(`Restore the archived stranded skate-park duplicate ${KEEP.SKATE_PARK_STRANDED}`, async () => {
      const p = await getProcess(KEEP.SKATE_PARK_STRANDED);
      if (p?.status === "archived") { await restoreProcess(KEEP.SKATE_PARK_STRANDED, ADMIN_ID); log("   restored"); }
      else log("   not archived — nothing to do");
    });
  }

  add("Delete the 4 demo resident accounts", async () => {
    await del("sessions", "user_id", DEMO_USER_IDS);
    await del("users", "id", DEMO_USER_IDS);
    log("   removed");
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const host = new URL(process.env.SUPABASE_URL!).host;
  console.log(`seedBetaSlate — env=${ENV} (${host}) ${DRY_RUN ? "DRY RUN" : REMOVE ? "REMOVE" : "SEED"}`);
  console.log(`  BASE_URL=${process.env.BASE_URL}  jurisdiction=${JURISDICTION}  hub_id=${HUB_ID}  polis=${POLIS_BASE_URL}`);
  console.log(`  mail transport: none (SMTP_*/RESEND_API_KEY scrubbed from env; brief delivery uses a logging stub)`);

  await resolveAdmin();
  console.log(`  admin account: ${ADMIN_ID} (${ADMIN_NAME})`);

  const before = await readMatrix();
  printMatrix("BEFORE", before);

  if (REMOVE) await buildRemovePlan();
  else await buildSeedPlan();

  console.log(`\n=== PLAN (${plan.length} steps) ===`);
  plan.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.label}`));

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    return;
  }

  for (let i = 0; i < plan.length; i++) {
    step(`${i + 1}/${plan.length} ${plan[i].label}`);
    await plan[i].run();
  }

  const after = await readMatrix();
  printMatrix("AFTER", after);

  console.log(`\nSuppressed delivery emails: ${suppressedDeliveries.length}`);
  for (const d of suppressedDeliveries) console.log(`  would have gone to ${d.to.join(", ")} — "${d.subject}"`);
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
