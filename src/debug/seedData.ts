// Seed data scenarios — used by debug/seed endpoint and test scripts.
// NOT loaded at startup. Server starts with zero processes.

import type { PolisDeliberationState, DeliberationSummary } from "../shared/polis_deliberation/types.js";

// --- Deliberation seed data (bypasses Polis API) -------------------------

export interface DeliberationSeedScenario {
  process: {
    id: string;
    definition: { type: string; version: string };
    title: string;
    description: string;
    createdBy: string;
    jurisdiction?: string;
    state: PolisDeliberationState;
  };
  /** Override the process status directly (bypasses action dispatcher). */
  status: "draft" | "active" | "closed" | "finalized";
}

// 1. Active conversation — broadband infrastructure
export const FLOYD_BROADBAND_CONVERSATION: DeliberationSeedScenario = {
  status: "active",
  process: {
    id: "proc_delib_broadband_001",
    definition: { type: "civic.polis_deliberation", version: "1.0" },
    title: "Rural Broadband Expansion Priorities",
    description:
      "Help shape the county's approach to expanding broadband internet access to underserved areas.",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      polis_conversation_id: "seed-conv-broadband-001",
      polis_base_url: "https://polis.civic.social/seed-conv-broadband-001",
      topic: "Rural Broadband Expansion Priorities",
      framing:
        "Floyd County is exploring options for expanding broadband internet access. Many rural areas still lack reliable high-speed internet, affecting education, healthcare, and economic opportunity. What should the county prioritize?",
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      participation_threshold: 50,
    duration_ms: null,
    assistant_helped: false,
    seed_statements: null,
      last_math_tick: 12,
      summary: null,
      summary_status: "pending",
      continued_from_response_id: null,
    },
  },
};

// 2. Active conversation — county budget
export const FLOYD_BUDGET_CONVERSATION: DeliberationSeedScenario = {
  status: "active",
  process: {
    id: "proc_delib_budget_001",
    definition: { type: "civic.polis_deliberation", version: "1.0" },
    title: "FY2027 Budget Priorities",
    description:
      "What should Floyd County prioritize in next year's budget?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      polis_conversation_id: "seed-conv-budget-001",
      polis_base_url: "https://polis.civic.social/seed-conv-budget-001",
      topic: "FY2027 Budget Priorities",
      framing:
        "The county is beginning its budget planning process for FY2027. We want to hear from residents about which services, programs, and infrastructure investments matter most. Share your priorities and react to others'.",
      deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      participation_threshold: 100,
    duration_ms: null,
    assistant_helped: false,
    seed_statements: null,
      last_math_tick: 8,
      summary: null,
      summary_status: "pending",
      continued_from_response_id: null,
    },
  },
};

// 3. Completed conversation — short-term rentals (full summary)
const SHORT_TERM_RENTAL_SUMMARY: DeliberationSummary = {
  summary_text:
    "The community is broadly supportive of some regulation of short-term rentals but divided on how strict those regulations should be. A strong majority (78%) agrees that property owners should have the right to rent their homes, but an equally strong consensus emerged that rentals concentrated in residential neighborhoods create quality-of-life issues. Three distinct opinion groups formed: property-rights advocates who favor minimal regulation, neighborhood-preservation residents who want strict caps and zoning limits, and a pragmatic middle group that supports a permit system with neighbor notification requirements.",
  directed_questions: [
    "Should the county cap the total number of short-term rental permits per district, and if so, what's the right number?",
    "How should enforcement work — complaint-driven or proactive inspections?",
    "Should existing unpermitted rentals be grandfathered in or required to apply?",
  ],
  top_consensus_statements: [
    {
      statement_text:
        "Property owners should have the right to rent their homes, but not at the expense of neighbors' quality of life.",
      agree_rate: 0.91,
      vote_count: 87,
    },
    {
      statement_text:
        "The county needs a clear, simple permit process rather than an outright ban.",
      agree_rate: 0.84,
      vote_count: 82,
    },
    {
      statement_text:
        "Noise and parking problems from short-term rentals are real and need enforceable rules.",
      agree_rate: 0.82,
      vote_count: 79,
    },
    {
      statement_text:
        "Short-term rentals bring tourism dollars that benefit local businesses.",
      agree_rate: 0.76,
      vote_count: 74,
    },
    {
      statement_text:
        "Absentee-owned party houses are a different problem from a neighbor occasionally renting their home.",
      agree_rate: 0.88,
      vote_count: 85,
    },
  ],
  opinion_groups: [
    {
      group_id: 1,
      size: 34,
      representative_statements: [
        {
          text: "This is a property rights issue. The government shouldn't tell me what I can do with my own home.",
          agreement_within_group: 0.94,
        },
        {
          text: "Short-term rentals help families make ends meet in a county with limited economic opportunity.",
          agreement_within_group: 0.88,
        },
      ],
    },
    {
      group_id: 2,
      size: 28,
      representative_statements: [
        {
          text: "Our neighborhood has three Airbnbs on one street. It's changed the character of the community.",
          agreement_within_group: 0.92,
        },
        {
          text: "We need strict caps — no more than one rental per road in residential areas.",
          agreement_within_group: 0.85,
        },
      ],
    },
    {
      group_id: 3,
      size: 31,
      representative_statements: [
        {
          text: "A permit system with clear rules would solve most of the problems without banning anything.",
          agreement_within_group: 0.91,
        },
        {
          text: "Require hosts to notify adjacent neighbors and give them a way to file complaints.",
          agreement_within_group: 0.87,
        },
      ],
    },
  ],
  participation_stats: {
    total_participants: 93,
    total_statements: 47,
    total_votes: 2814,
    opinion_groups_formed: 3,
  },
  linked_polis_data_uri: "https://polis.civic.social/seed-conv-rentals-001",
  methodology: {
    prompt_version: "polis-summary-v1",
    model_used: "claude-sonnet-4-20250514",
    generated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
};

export const FLOYD_RENTALS_CONVERSATION: DeliberationSeedScenario = {
  status: "finalized",
  process: {
    id: "proc_delib_rentals_001",
    definition: { type: "civic.polis_deliberation", version: "1.0" },
    title: "Short-Term Rental Regulation",
    description:
      "How should Floyd County approach regulating short-term rentals like Airbnb and VRBO?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      polis_conversation_id: "seed-conv-rentals-001",
      polis_base_url: "https://polis.civic.social/seed-conv-rentals-001",
      topic: "Short-Term Rental Regulation",
      framing:
        "Short-term vacation rentals have grown significantly in Floyd County. Some residents see them as economic opportunity; others are concerned about housing availability and neighborhood impact. How should the county approach regulation?",
      deadline: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      participation_threshold: 50,
    duration_ms: null,
    assistant_helped: false,
    seed_statements: null,
      last_math_tick: 47,
      summary: SHORT_TERM_RENTAL_SUMMARY,
      summary_status: "complete",
      continued_from_response_id: null,
    },
  },
};

// 4. Draft conversation — emergency services
export const FLOYD_EMERGENCY_CONVERSATION: DeliberationSeedScenario = {
  status: "draft",
  process: {
    id: "proc_delib_emergency_001",
    definition: { type: "civic.polis_deliberation", version: "1.0" },
    title: "Volunteer Fire & Rescue Funding",
    description:
      "How should the county support volunteer fire and rescue departments facing recruitment challenges?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      polis_conversation_id: "",
      polis_base_url: "",
      topic: "Volunteer Fire & Rescue Funding",
      framing:
        "Floyd County's volunteer fire and rescue departments are the backbone of emergency response, but many are struggling with declining volunteer numbers and aging equipment. How should the county invest in supporting these organizations?",
      deadline: null,
      participation_threshold: null,
    duration_ms: null,
    assistant_helped: false,
    seed_statements: null,
      last_math_tick: 0,
      summary: null,
      summary_status: "pending",
      continued_from_response_id: null,
    },
  },
};

// 5. Active conversation — Flock Camera (production demo)
export const FLOYD_FLOCK_CONVERSATION: DeliberationSeedScenario = {
  status: "active",
  process: {
    id: "proc_delib_flock_001",
    definition: { type: "civic.polis_deliberation", version: "1.0" },
    title: "Floyd County Flock Camera Use",
    description:
      "Should Floyd County continue using Flock Safety license plate reader cameras? Share your perspective.",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      polis_conversation_id: "seed-conv-flock-001",
      polis_base_url: "https://polis.civic.social/seed-conv-flock-001",
      topic: "Floyd County Flock Camera Use",
      framing:
        "Flock Safety cameras are automated license plate readers used by law enforcement in Floyd County. Some residents see them as a valuable public safety tool; others are concerned about surveillance, privacy, and the lack of public input before they were installed. What do you think?",
      deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      participation_threshold: 75,
    duration_ms: null,
    assistant_helped: false,
    seed_statements: null,
      last_math_tick: 15,
      summary: null,
      summary_status: "pending",
      continued_from_response_id: null,
    },
  },
};

export const ALL_DELIBERATION_SEEDS: DeliberationSeedScenario[] = [
  FLOYD_BROADBAND_CONVERSATION,
  FLOYD_BUDGET_CONVERSATION,
  FLOYD_RENTALS_CONVERSATION,
  FLOYD_EMERGENCY_CONVERSATION,
];

// --- Standard seed scenarios (votes, proposals) --------------------------

export interface SeedScenario {
  process: {
    id?: string; // Fixed ID for deterministic seeding (survives serverless cold starts)
    definition: { type: string; version: string };
    title: string;
    description: string;
    createdBy: string;
    jurisdiction?: string;
    state: Record<string, unknown>;
    content?: Record<string, unknown>;
  };
  /**
   * Generic process actions — used by civic.vote and civic.proposal
   * scenarios that go through the standard action dispatcher.
   * Optional: announcement and meeting-summary scenarios bypass
   * action dispatch entirely (see autoSeed.ts type-aware runScenario).
   */
  actions?: { type: string; actor: string; payload: Record<string, unknown> }[];
  inputs?: { author_id: string; body: string }[];
}

// --- Floyd County Green Box Dumpster Sites (active vote) ---

export const FLOYD_GREEN_BOX: SeedScenario = {
  process: {
    id: "proc_greenbox_floyd_001",
    definition: { type: "civic.vote", version: "0.1" },
    title: "Add More Secure Dumpster (Green Box) Sites",
    description:
      "Should Floyd County invest in building additional fenced-in dumpster (green box) sites to improve access and reduce wildlife interference?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      options: [
        "Yes \u2014 build additional fenced-in dumpster sites in key areas",
        "No \u2014 maintain current number and locations",
        "Unsure / need more information",
      ],
      support_threshold: 3,
      voting_duration_ms: 14 * 24 * 60 * 60 * 1000, // 14 days
      activation_mode: "direct",
    },
    content: {
      core_question:
        "Should Floyd County invest in building additional fenced-in dumpster (green box) sites to improve access and reduce wildlife interference?",
      sections: [
        {
          title: "Background",
          body: [
            "Floyd County residents rely on green box dumpster sites for waste disposal. In recent years, bears and other wildlife have increasingly accessed these dumpsters, creating mess, safety concerns, and additional maintenance costs.",
            "The county has built a fenced-in dumpster facility on Christiansburg Pike that has significantly reduced wildlife access and improved cleanliness. However, for many residents, this location is not convenient, requiring longer travel times for regular waste disposal.",
            "Expanding secure, fenced-in dumpster sites across the county could improve accessibility while also addressing wildlife-related issues.",
          ],
        },
        {
          title: "Key considerations",
          body: [
            "Accessibility: Are current dumpster locations convenient for most residents?",
            "Wildlife impact: Do fenced-in sites meaningfully reduce bear interference?",
            "Cost: What is the cost of building and maintaining additional sites?",
            "Land use: Where would new sites be located?",
          ],
        },
        {
          title: "Potential locations (examples)",
          body: [
            "Northern Floyd County",
            "Near Check / Indian Valley area",
            "Additional site in eastern or western portions of the county",
            "North Route 8 at the old Green Box site",
          ],
        },
        {
          title: "What your vote means",
          body: [
            "This vote provides a community signal to county officials about whether residents support expanding secure dumpster infrastructure.",
            "Results are advisory but intended to reflect the preferences of participating Floyd County residents.",
          ],
        },
      ],
      key_tradeoff: "Improved access and wildlife management vs. cost of new infrastructure",
      links: [],
      community_input: {
        prompt: "Do you have suggestions for locations, concerns, or alternatives?",
        label: "Optional: Share your thoughts (does not affect vote results)",
      },
      after_vote: {
        body: "This vote is advisory and does not directly determine policy. The goal is to provide a clear signal of community sentiment to county officials.",
        recipients: [
          "Floyd County Board of Supervisors",
        ],
      },
    },
  },
  actions: [
    // Direct activation — goes straight from draft to active
    { type: "process.activate", actor: "user:civic-admin", payload: {} },
  ],
  inputs: [],
};

// --- Floyd County Flock Camera Issue (real pilot issue) ---

export const FLOYD_FLOCK_CAMERA: SeedScenario = {
  process: {
    id: "proc_flockcam_floyd_001",
    definition: { type: "civic.vote", version: "0.1" },
    title: "Floyd County Flock Camera Use",
    description: "Should Floyd County continue using Flock Safety license plate reader cameras?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-floyd",
    state: {
      options: [
        "Yes \u2014 continue using the cameras",
        "No \u2014 remove the cameras",
      ],
      support_threshold: 5,
      voting_duration_ms: 7 * 24 * 60 * 60 * 1000, // 7 days
      activation_mode: "proposal_required",
    },
    content: {
      core_question: "Should Floyd County continue using Flock Safety license plate reader cameras?",
      sections: [
        {
          title: "What are Flock cameras?",
          body: [
            "Flock Safety cameras are automated license plate readers (ALPRs) used by law enforcement to:",
            "Capture images of license plates",
            "Compare plates against databases (e.g. stolen vehicles, warrants)",
            "Assist in investigations",
            "They do not continuously record video, but they do capture license plate numbers, timestamps, and location data.",
          ],
        },
        {
          title: "Why are they used?",
          body: [
            "Supporters argue they:",
            "Help solve crimes (especially stolen vehicles)",
            "Provide useful investigative leads",
            "Extend law enforcement capabilities without constant patrol presence",
          ],
        },
        {
          title: "Concerns raised",
          body: [
            "Critics argue they:",
            "Create a form of ongoing surveillance",
            "Collect data on residents who are not suspected of wrongdoing",
            "May lack sufficient transparency or oversight",
            "Raise privacy and civil liberties concerns",
          ],
        },
        {
          title: "Local context",
          body: [
            "Flock cameras are typically deployed in coordination with local law enforcement.",
            "In Floyd County, their continued use would likely depend on decisions made by the Floyd County Sheriff\u2019s Office and the Board of Supervisors.",
            "This proposal was created as part of a pilot to explore better ways for the community to understand public sentiment.",
            "This vote is intended to understand community sentiment and does not directly determine policy.",
          ],
        },
      ],
      key_tradeoff: "Public safety vs. privacy",
      links: [
        { label: "Flock Safety website", url: "https://www.flocksafety.com/" },
        { label: "How Flock cameras work", url: "https://www.flocksafety.com/how-it-works" },
        { label: "Law enforcement use article (GovTech)", url: "https://www.govtech.com/public-safety/flock-safety-cameras-help-police-solve-crimes" },
        { label: "ACLU: Automated License Plate Readers", url: "https://www.aclu.org/issues/privacy-technology/location-tracking/automated-license-plate-readers-alprs" },
        { label: "EFF: ALPR overview", url: "https://www.eff.org/pages/automated-license-plate-readers-alpr" },
      ],
      community_input: {
        prompt: "What concerns you most about this issue?",
        label: "Optional: Share your perspective (does not affect vote results)",
      },
      after_vote: {
        body: "The goal is to provide a clear signal of community sentiment between elections. This vote is advisory and does not directly determine policy.",
        recipients: [
          "Floyd County Board of Supervisors",
        ],
      },
    },
  },
  actions: [
    { type: "process.propose", actor: "user:civic-admin", payload: {} },
    { type: "process.support", actor: "user:floyd-resident-1", payload: {} },
    { type: "process.support", actor: "user:floyd-resident-2", payload: {} },
    { type: "process.support", actor: "user:floyd-resident-3", payload: {} },
  ],
  inputs: [
    { author_id: "user:floyd-resident-1", body: "I'm worried about the data retention policies. How long are plate images stored, and who has access?" },
    { author_id: "user:floyd-resident-4", body: "These cameras helped recover my neighbor's stolen truck last year. They work." },
    { author_id: "user:floyd-resident-2", body: "I don't think most people even know these exist. We need more transparency before making a decision." },
  ],
};
