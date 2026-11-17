// Athens (fictional) seed data — Slice 19b + follow-up.
//
// Mirrors the structure of seedData.ts but populated with content for
// the fictional "Town of Athens, Virginia" used by the public demo
// deployment (demo-hub.civic.social). Same civic issues as Floyd's
// seed for the votes (waste disposal, surveillance cameras — these
// topics are nationally relevant); fully synthetic announcements
// and Town Council meeting summaries flesh out the rest of the feed
// so the demo looks lived-in rather than half-populated.
//
// Selected at runtime via CIVIC_SEED_FIXTURE=athens. Floyd remains
// the default so production behavior is unchanged.

import type { SeedScenario } from "./seedData.js";

// --- Athens Green Box Dumpster Sites (active vote) ---

export const ATHENS_GREEN_BOX: SeedScenario = {
  process: {
    id: "proc_greenbox_athens_001",
    definition: { type: "civic.vote", version: "0.1" },
    title: "Add More Secure Dumpster (Green Box) Sites",
    description:
      "Should the town of Athens invest in building additional fenced-in dumpster (green box) sites to improve access and reduce wildlife interference?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-athens",
    state: {
      options: [
        "Yes \u2014 build additional fenced-in dumpster sites in key areas",
        "No \u2014 maintain current number and locations",
        "Unsure / need more information",
      ],
      support_threshold: 3,
      voting_duration_ms: 14 * 24 * 60 * 60 * 1000,
      activation_mode: "direct",
    },
    content: {
      core_question:
        "Should the town of Athens invest in building additional fenced-in dumpster (green box) sites to improve access and reduce wildlife interference?",
      sections: [
        {
          title: "Background",
          body: [
            "Athens residents rely on green box dumpster sites for waste disposal. In recent years, bears and other wildlife have increasingly accessed these dumpsters, creating mess, safety concerns, and additional maintenance costs.",
            "The town has built a fenced-in dumpster facility on Main Street that has significantly reduced wildlife access and improved cleanliness. However, for many residents, this location is not convenient, requiring longer travel times for regular waste disposal.",
            "Expanding secure, fenced-in dumpster sites across the town could improve accessibility while also addressing wildlife-related issues.",
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
            "North Athens",
            "Near the historic district",
            "Additional site on the south end of town",
            "Near the town park entrance",
          ],
        },
        {
          title: "What your vote means",
          body: [
            "This vote provides a community signal to town officials about whether residents support expanding secure dumpster infrastructure.",
            "Results are advisory but intended to reflect the preferences of participating Athens residents.",
          ],
        },
      ],
      key_tradeoff:
        "Improved access and wildlife management vs. cost of new infrastructure",
      links: [],
      community_input: {
        prompt:
          "Do you have suggestions for locations, concerns, or alternatives?",
        label:
          "Optional: Share your thoughts (does not affect vote results)",
      },
      after_vote: {
        body: "This vote is advisory and does not directly determine policy. The goal is to provide a clear signal of community sentiment to town officials.",
        recipients: ["Athens Town Council"],
      },
    },
  },
  actions: [
    { type: "process.activate", actor: "user:civic-admin", payload: {} },
  ],
  inputs: [],
};

// --- Athens Flock Camera Issue (gathering-support proposal) ---

export const ATHENS_FLOCK_CAMERA: SeedScenario = {
  process: {
    id: "proc_flockcam_athens_001",
    definition: { type: "civic.vote", version: "0.1" },
    title: "Athens Flock Camera Use",
    description:
      "Should the town of Athens continue using Flock Safety license plate reader cameras?",
    createdBy: "user:civic-admin",
    jurisdiction: "us-va-athens",
    state: {
      options: [
        "Yes \u2014 continue using the cameras",
        "No \u2014 remove the cameras",
      ],
      support_threshold: 5,
      voting_duration_ms: 7 * 24 * 60 * 60 * 1000,
      activation_mode: "proposal_required",
    },
    content: {
      core_question:
        "Should the town of Athens continue using Flock Safety license plate reader cameras?",
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
            "In Athens, their continued use would likely depend on decisions made by the Athens Police Department and the Town Council.",
            "This vote is intended to understand community sentiment and does not directly determine policy.",
          ],
        },
      ],
      key_tradeoff: "Public safety vs. privacy",
      links: [
        {
          label: "Flock Safety website",
          url: "https://www.flocksafety.com/",
        },
        {
          label: "ACLU: Automated License Plate Readers",
          url: "https://www.aclu.org/issues/privacy-technology/location-tracking/automated-license-plate-readers-alprs",
        },
        {
          label: "EFF: ALPR overview",
          url: "https://www.eff.org/pages/automated-license-plate-readers-alpr",
        },
      ],
      community_input: {
        prompt: "What concerns you most about this issue?",
        label:
          "Optional: Share your perspective (does not affect vote results)",
      },
      after_vote: {
        body: "The goal is to provide a clear signal of community sentiment between elections. This vote is advisory and does not directly determine policy.",
        recipients: ["Athens Town Council", "Athens Police Department"],
      },
    },
  },
  actions: [
    { type: "process.propose", actor: "user:civic-admin", payload: {} },
    { type: "process.support", actor: "user:athens-resident-1", payload: {} },
    { type: "process.support", actor: "user:athens-resident-2", payload: {} },
    { type: "process.support", actor: "user:athens-resident-3", payload: {} },
  ],
  inputs: [
    {
      author_id: "user:athens-resident-1",
      body: "I'm worried about the data retention policies. How long are plate images stored, and who has access?",
    },
    {
      author_id: "user:athens-resident-4",
      body: "These cameras helped recover my neighbor's stolen truck last year. They work.",
    },
    {
      author_id: "user:athens-resident-2",
      body: "I don't think most people even know these exist. We need more transparency before making a decision.",
    },
  ],
};

// --- Athens announcements ---
//
// Synthetic news-style posts authored as if published directly by
// the Town of Athens government. The seed runner publishes these
// via the announcement module's emitPublicationEvents flow; they
// appear in the feed as standard announcement cards.
//
// Author role "Town of Athens Government" gets abbreviated to
// "Town of Athens Gov" in the pill (per Slice 17.1's
// abbreviateGovernment helper).

const ATHENS_ANNOUNCEMENT_AUTHOR = "user:athens-admin";
const ATHENS_ANNOUNCEMENT_AUTHOR_ROLE = "Town of Athens Government";

const ATHENS_TOWN_COUNCIL_NEXT_MEETING: SeedScenario = {
  process: {
    id: "proc_athens_announce_council_meeting",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Town Council Meeting — Thursday May 7",
    description:
      "The next regular Town Council meeting is Thursday, May 7 at 7:00 PM in the Town Hall meeting room.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Town Council Meeting — Thursday May 7",
      body: "The next regular Town Council meeting is **Thursday, May 7 at 7:00 PM** in the Town Hall meeting room (200 Main Street). The published agenda includes a vote on the FY26 budget draft, an update on the downtown sidewalk replacement project, and public comment.\n\nMeetings are open to the public. Recordings and minutes are posted to the hub within a week of each meeting.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

const ATHENS_WATER_MAIN_FLUSH: SeedScenario = {
  process: {
    id: "proc_athens_announce_water_main",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Water Main Flushing — May 3 to May 5",
    description:
      "Crews will flush water mains across the south side of town from Saturday May 3 through Monday May 5. Discolored water is harmless but residents may want to wait before doing laundry.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Water Main Flushing — May 3 to May 5",
      body: "Public works crews will flush water mains across the south side of town from **Saturday, May 3 through Monday, May 5**, between 8 AM and 4 PM each day.\n\nResidents on Maple, Oak, Cedar, and Pine streets may notice temporarily discolored water. The water is safe to drink, but you may want to wait until evening before running laundry. If discoloration persists past 24 hours after flushing ends, please call the Town Public Works office at 555-0100.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

const ATHENS_SPRING_FESTIVAL: SeedScenario = {
  process: {
    id: "proc_athens_announce_spring_festival",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Athens Spring Festival — Saturday May 17",
    description:
      "The annual Athens Spring Festival returns to the town square on Saturday, May 17 from 10 AM to 6 PM. Live music, food vendors, kids' activities, and a 5K fun run.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Athens Spring Festival — Saturday May 17",
      body: "The annual Athens Spring Festival returns to the town square on **Saturday, May 17 from 10 AM to 6 PM**.\n\nFeaturing live music on the gazebo stage, local food vendors, kids' activities, and the morning 5K fun run kicking off at 8 AM. Main Street will be closed to traffic between Oak and Cedar from 7 AM to 7 PM; please use the Maple Street detour.\n\nVendor applications are still open through May 9 — contact the Town Manager's office at townmgr@athens-va.example to apply.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

const ATHENS_PARK_BENCHES_SURVEY: SeedScenario = {
  process: {
    id: "proc_athens_announce_park_benches",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Park Benches Survey — Help Us Choose New Locations",
    description:
      "The Town is replacing eight worn park benches and adding four new ones. We want your input on where they should go.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Park Benches Survey — Help Us Choose New Locations",
      body: "The Town received a small grant to replace eight worn park benches and add four entirely new ones across our public spaces. Before placing them, we want resident input on where they'd be most useful.\n\nThe survey takes about three minutes and asks where you'd most appreciate a place to sit when walking through town — along the Main Street corridor, near the playground, on the trail behind the library, etc.\n\nPaper copies are available at the Town Hall front desk for residents who prefer them. Survey closes Friday, May 23.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

const ATHENS_DOWNTOWN_SIDEWALK_PROJECT: SeedScenario = {
  process: {
    id: "proc_athens_announce_sidewalk",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Downtown Sidewalk Replacement Begins May 12",
    description:
      "Sidewalks along Main Street between Oak and Pine will be replaced over six weeks starting May 12. Pedestrian access will remain on at least one side of the street throughout.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Downtown Sidewalk Replacement Begins May 12",
      body: "The downtown sidewalk replacement project begins **Monday, May 12** and is expected to take six weeks. Crews will work in three phases:\n\n1. Main Street between Oak and Maple (May 12 – May 23)\n2. Main Street between Maple and Cedar (May 26 – June 6)\n3. Main Street between Cedar and Pine (June 9 – June 20)\n\nPedestrian access will remain on at least one side of the street throughout. On-street parking will be reduced during active work hours; please use the public lot behind Town Hall.\n\nQuestions about access for downtown businesses can be directed to the Town Manager's office.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

const ATHENS_RECYCLING_SCHEDULE: SeedScenario = {
  process: {
    id: "proc_athens_announce_recycling",
    definition: { type: "civic.announcement", version: "0.1" },
    title: "Recycling Pickup Schedule Change Starting June 1",
    description:
      "Curbside recycling will move from biweekly Wednesday pickups to weekly Monday pickups starting June 1. No additional fee.",
    createdBy: ATHENS_ANNOUNCEMENT_AUTHOR,
    jurisdiction: "us-va-athens",
    state: {
      title: "Recycling Pickup Schedule Change Starting June 1",
      body: "Starting **Monday, June 1**, curbside recycling moves from **biweekly Wednesdays** to **weekly Mondays**. There is no additional fee — the change is part of our renegotiated contract with Mountain Valley Recycling.\n\nAccepted materials are unchanged: paper, cardboard, glass, aluminum cans, and plastics #1 and #2. Please rinse containers before placing them in the bin and do not bag recyclables in plastic.\n\nThe last biweekly Wednesday pickup is May 28. The first weekly Monday pickup is June 1.",
      author_id: ATHENS_ANNOUNCEMENT_AUTHOR,
      author_role: ATHENS_ANNOUNCEMENT_AUTHOR_ROLE,
      links: [],
      image_url: null,
      image_alt: null,
    },
  },
};

export const ATHENS_ANNOUNCEMENTS: SeedScenario[] = [
  ATHENS_TOWN_COUNCIL_NEXT_MEETING,
  ATHENS_WATER_MAIN_FLUSH,
  ATHENS_SPRING_FESTIVAL,
  ATHENS_PARK_BENCHES_SURVEY,
  ATHENS_DOWNTOWN_SIDEWALK_PROJECT,
  ATHENS_RECYCLING_SCHEDULE,
];

// --- Athens Town Council meeting summaries ---
//
// Synthetic published meeting summaries representing recent Town
// Council meetings. The seed runner walks each through
// emitCreationEvents → approveMeetingSummary so they appear in the
// feed as published summaries (no "pending review" admin step
// required for demo content).
//
// Block structure mirrors what the meeting-summary AI pipeline
// produces in production: 4–6 topic blocks per meeting, each with a
// title and narrative summary. start_time_seconds is null for the
// demo content (no real recording timestamps); action_taken is
// optional and used to flag votes / motions.

const ATHENS_COUNCIL_MEETING_APRIL_23: SeedScenario = {
  process: {
    id: "proc_athens_meeting_2026_04_23",
    definition: { type: "civic.meeting_summary", version: "0.1" },
    title: "Meeting summary: 2026-04-23",
    description:
      "Town Council Regular Meeting — April 23, 2026. Topics: FY26 budget draft, downtown sidewalk project award, recycling contract renewal, and resident comment on park improvements.",
    createdBy: "user:athens-admin",
    jurisdiction: "us-va-athens",
    state: {
      type: "civic.meeting_summary",
      source_id: "athens-2026-04-23",
      source_minutes_url:
        "https://demo-hub.civic.social/seed-data/athens-2026-04-23-minutes.pdf",
      source_video_url: null,
      additional_video_urls: [],
      meeting_title: "Town Council Regular Meeting",
      meeting_date: "2026-04-23",
      blocks: [
        {
          topic_title: "FY26 budget draft — first reading",
          topic_summary:
            "Town Manager Rivera presented the proposed FY26 operating budget. Total spending is up 3.4% over FY25, driven primarily by paving program expansion and a contracted 2% cost-of-living adjustment for town staff. The Council asked clarifying questions about line items for parks maintenance and the police department's vehicle replacement schedule. No vote was taken; the budget will return for second reading and a formal vote at the May 28 meeting following a public hearing on May 14.",
          start_time_seconds: null,
          action_taken: "First reading completed. Public hearing scheduled May 14.",
        },
        {
          topic_title: "Downtown sidewalk project — contract award",
          topic_summary:
            "The Council reviewed three bids received for the Main Street sidewalk replacement project. The bid review committee recommended awarding to Ridgeline Concrete (lowest qualifying bid at $186,400) over two higher bids. Construction is scheduled to begin May 12 and complete by late June. The contract includes a $10,000 contingency for unforeseen subgrade conditions.",
          start_time_seconds: null,
          action_taken:
            "Motion to award contract to Ridgeline Concrete passed 5–0.",
        },
        {
          topic_title: "Recycling contract renewal",
          topic_summary:
            "Mountain Valley Recycling presented terms for a three-year contract renewal at the same per-household rate. The new contract shifts pickup from biweekly Wednesdays to weekly Mondays at no additional cost — Mountain Valley reports it improves their route efficiency. Some council members asked about the addition of plastics #5 to the accepted materials list; Mountain Valley said it would be feasible in year two if regional sorting capacity expands.",
          start_time_seconds: null,
          action_taken:
            "Motion to authorize the Town Manager to sign the renewal passed 5–0.",
        },
        {
          topic_title: "Public comment — park improvements",
          topic_summary:
            "Three residents spoke during public comment, all on the park benches survey announced last week. One asked whether the survey results would be public; Town Manager Rivera confirmed they would be summarized and published to the hub. A second asked the council to consider adding shade trees alongside the bench placements; the council asked staff to bring a follow-up cost estimate. A third spoke in support of the playground equipment refresh that's pending grant approval.",
          start_time_seconds: null,
          action_taken: null,
        },
        {
          topic_title: "Adjournment",
          topic_summary:
            "Mayor Henley adjourned the meeting at 8:42 PM. Next regular meeting: Thursday, May 7 at 7:00 PM.",
          start_time_seconds: null,
          action_taken: null,
        },
      ],
      approval_status: "pending",
      generated_at: "2026-04-24T14:00:00Z",
      approved_at: null,
      published_at: null,
      admin_notes: "",
      last_edited_at: null,
      edit_count: 0,
      ai_instructions_used: "(demo seed — no AI generation)",
      ai_model: "(demo seed — no AI generation)",
      ai_attribution_label: "AI-generated summary",
    },
  },
};

const ATHENS_COUNCIL_BUDGET_WORKSHOP: SeedScenario = {
  process: {
    id: "proc_athens_meeting_2026_04_16",
    definition: { type: "civic.meeting_summary", version: "0.1" },
    title: "Meeting summary: 2026-04-16",
    description:
      "Town Council Budget Workshop — April 16, 2026. Department-by-department review of FY26 spending requests, with a focus on capital improvements and personnel costs.",
    createdBy: "user:athens-admin",
    jurisdiction: "us-va-athens",
    state: {
      type: "civic.meeting_summary",
      source_id: "athens-2026-04-16",
      source_minutes_url:
        "https://demo-hub.civic.social/seed-data/athens-2026-04-16-minutes.pdf",
      source_video_url: null,
      additional_video_urls: [],
      meeting_title: "Town Council Budget Workshop",
      meeting_date: "2026-04-16",
      blocks: [
        {
          topic_title: "Public Works — operating + capital",
          topic_summary:
            "Director Lee presented the Public Works request: $612,000 operating (flat from FY25) and $187,000 capital, the bulk of which is the downtown sidewalk replacement project. The Council asked about the timing of vehicle replacements; one of the dump trucks is at end-of-life but Lee proposed deferring until FY27 if a low-mileage replacement comes available at auction.",
          start_time_seconds: null,
          action_taken: null,
        },
        {
          topic_title: "Police Department — operating",
          topic_summary:
            "Chief Morales presented a $740,000 request — a 4.1% increase over FY25, driven primarily by the negotiated COLA and one additional patrol vehicle (replacing a 2018 cruiser at 142,000 miles). The Council asked about the Flock Safety camera contract that's being separately discussed via the hub's resident vote; Chief Morales noted the police budget assumes the cameras continue, and would be revised if the resident vote signals otherwise.",
          start_time_seconds: null,
          action_taken: null,
        },
        {
          topic_title: "Parks and Recreation — capital",
          topic_summary:
            "Recreation Coordinator Park presented the parks capital request: $42,000 for the bench replacements (announced separately for resident input on placement) and $115,000 in pending playground equipment, contingent on a state grant currently under review. The grant decision is expected by mid-May. If the grant is denied, the playground line drops to $25,000 for safety repairs only.",
          start_time_seconds: null,
          action_taken: null,
        },
        {
          topic_title: "Library — operating",
          topic_summary:
            "Library Director Chen presented a $185,000 operating request, flat from FY25. Highlights: a renewed digital materials subscription bundle that doubled e-book circulation in FY25, and a small budget line for the summer reading program ($2,500). No capital requests this cycle.",
          start_time_seconds: null,
          action_taken: null,
        },
        {
          topic_title: "Next steps",
          topic_summary:
            "Town Manager Rivera will compile department requests into a draft FY26 budget for first reading at the April 23 regular meeting. A formal public hearing is scheduled for May 14, with adoption targeted for the May 28 meeting.",
          start_time_seconds: null,
          action_taken: null,
        },
      ],
      approval_status: "pending",
      generated_at: "2026-04-17T10:00:00Z",
      approved_at: null,
      published_at: null,
      admin_notes: "",
      last_edited_at: null,
      edit_count: 0,
      ai_instructions_used: "(demo seed — no AI generation)",
      ai_model: "(demo seed — no AI generation)",
      ai_attribution_label: "AI-generated summary",
    },
  },
};

export const ATHENS_MEETING_SUMMARIES: SeedScenario[] = [
  ATHENS_COUNCIL_MEETING_APRIL_23,
  ATHENS_COUNCIL_BUDGET_WORKSHOP,
];
