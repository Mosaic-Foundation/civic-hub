// The sample content a new hub starts with (Phase 7) — templates, not data.
//
// Contract: BUILD-PLAN-multi-tenant.md → "Phase 7 — Sample content for new
// hubs". Adapted from the Floyd use cases (scripts/seedBetaSlate.ts, retired
// 2026-09-27 and in git history up to 39ac22d;
// src/debug/seedData.ts) with the place taken out. Approved by Adam
// 2026-09-26 (list and copy).
//
// RULES FOR THIS FILE
// - Substitution only: {HUB_NAME}, {JURISDICTION}, {GOVERNING_BODY}. No other
//   local fact, and nothing that assumes a rural or an urban setting.
// - No real people, businesses, organizations or places. Authors are the
//   synthetic users below.
// - Neutral and nonpartisan. Every vote has real options on more than one
//   side; statements and comments cover several viewpoints, none a strawman.
// - Times are days relative to the moment of seeding (negative = past), so
//   the open vote is open and the feed looks current whenever a hub is made.
// - `fits`: the jurisdiction types (identity.jurisdiction_type) a template
//   reads right in. The seed skips the rest. School districts are not
//   covered properly yet — that is the later presets work.

import { JURISDICTION_TYPES, type JurisdictionType } from "../shared/jurisdictionType.js";

/** Every type a general-purpose local government can be. */
const LOCAL_GOVERNMENT: readonly JurisdictionType[] = ["county", "city", "town", "village", "borough", "other"];
const EVERY_TYPE: readonly JurisdictionType[] = JURISDICTION_TYPES.map((t) => t.id);

// --- Synthetic authors --------------------------------------------------------

export interface SampleAuthor {
  /** n in user_sample_<hub>_00n. */
  n: number;
  /** Filled like the copy: may use the three placeholders. */
  full_name: string;
}

export const SAMPLE_AUTHORS = {
  JORDAN: { n: 1, full_name: "Jordan P." },
  ALEX: { n: 2, full_name: "Alex R." },
  CASEY: { n: 3, full_name: "Casey M." },
  SAM: { n: 4, full_name: "Sam T." },
  // Not a real office: a sample announcement must not appear to speak for
  // the local government, even out of context (Adam, 2026-09-26).
  TEAM: { n: 5, full_name: "{HUB_NAME} team" },
} as const satisfies Record<string, SampleAuthor>;

type Author = keyof typeof SAMPLE_AUTHORS;

export interface SampleComment {
  by: Author;
  body: string;
  /** Days relative to seeding. */
  at: number;
}

// --- Templates ----------------------------------------------------------------

interface Base {
  /** Stable key; the process id is proc_sample_<hub>_<key>. */
  key: string;
  fits: readonly JurisdictionType[];
  by: Author;
  /** Created, days relative to seeding. */
  at: number;
}

export interface SampleVote extends Base {
  kind: "vote";
  title: string;
  description: string;
  /**
   * The voting method. `yes_no_unsure` is the single-choice method (one
   * option per voter, any option list); `approval` lets a voter pick several.
   */
  method: "yes_no_unsure" | "approval";
  /** Option labels, in order. */
  options: readonly string[];
  /** open: ballots cast so far; closed: final; proposed: none yet. */
  phase: "proposed" | "open" | "closed";
  opens_at?: number;
  closes_at?: number;
  /** Anonymous ballots per option, same order as `options`. */
  ballots?: readonly number[];
  /** Endorsements while proposed (the threshold is the hub's). */
  endorsed_by?: readonly Author[];
}

export interface SampleOutcome extends Base {
  kind: "outcome";
  /** The closed vote this reports. */
  source: string;
  published_at: number;
  headline: string;
  summary: string;
  sections: ReadonlyArray<{ heading: string; body: string }>;
  participation_label: string;
  participation_count: number;
  /** The public "Sent to" label. Delivery is never attempted. */
  sent_to: string;
}

export interface SampleProposal extends Base {
  kind: "proposal";
  title: string;
  description: string;
  closes_at: number;
  endorsed_by: readonly Author[];
  comments: readonly SampleComment[];
}

export interface SampleDeliberation extends Base {
  kind: "deliberation";
  topic: string;
  framing: string;
  closes_at: number;
  /** Shown through the seed- mock layer; nothing is sent to Polis. */
  statements: readonly string[];
  /**
   * The participation picture the mock layer serves (Adam, 2026-09-26:
   * about twenty participants, two groups, broad agreement on registration
   * and on counting first). Statement references are indexes into
   * `statements`.
   */
  picture: {
    participants: number;
    groups: ReadonlyArray<{ size: number; agree: readonly number[]; disagree: readonly number[] }>;
    consensus: ReadonlyArray<{ statement: number; agree_rate: number; votes: number }>;
  };
}

export interface SampleProject extends Base {
  kind: "project";
  title: string;
  description: string;
  supported_by: readonly Author[];
  updates: ReadonlyArray<{ body: string; at: number }>;
  comments: readonly SampleComment[];
}

export interface SampleAnnouncement extends Base {
  kind: "announcement";
  title: string;
  body: string;
}

export type SampleTemplate =
  | SampleVote
  | SampleOutcome
  | SampleProposal
  | SampleDeliberation
  | SampleProject
  | SampleAnnouncement;

export const SAMPLE_TEMPLATES: readonly SampleTemplate[] = [
  // 1 — adapted from seedBetaSlate VOTE_ENERGY; topic from seedData
  //     "Rural Broadband Expansion Priorities".
  {
    key: "vote_internet",
    kind: "vote",
    fits: LOCAL_GOVERNMENT,
    by: "JORDAN",
    at: -6,
    title: "Which internet access step should {JURISDICTION} take first?",
    description:
      "Some households here have fast, affordable internet. Others have slow service, no wired option, or a monthly bill they struggle with. A local government can help in several ways, and each costs a different amount and helps different people.\n\n" +
      "This advisory vote asks which step {JURISDICTION} should take first. Pick one. The result goes to the {GOVERNING_BODY} as a statement of where residents stand; it does not decide anything by itself.",
    method: "yes_no_unsure", // single choice: "Pick one", 30 ballots = 30 voters
    options: [
      "Map where service is missing or unaffordable before choosing a fix",
      "Partner with a provider to extend service to areas that lack it",
      "Help households with the monthly cost of service",
      "Add free public Wi-Fi at libraries, parks and public buildings",
    ],
    phase: "open",
    opens_at: -6,
    closes_at: 8,
    ballots: [8, 10, 7, 5],
  },

  // 2 — adapted from seedBetaSlate KEEP.TRAILS_VOTE (a vote gathering
  //     endorsements); topic from seedData "Volunteer Fire & Rescue Funding".
  {
    key: "vote_fire_rescue",
    kind: "vote",
    fits: LOCAL_GOVERNMENT,
    by: "SAM",
    at: -5,
    title: "Should {JURISDICTION} increase funding for fire and rescue services?",
    description:
      "Fire and rescue services face rising costs for equipment, training and staffing. More funding could shorten response times or replace aging equipment. It would also mean less money for other services, or a higher tax rate, or both.\n\n" +
      "This vote opens once enough residents endorse it. Endorse it if you think residents should be asked; endorsing does not mean you would vote yes.",
    method: "yes_no_unsure",
    options: ["Yes", "No", "Unsure"],
    phase: "proposed",
    endorsed_by: ["SAM", "ALEX", "CASEY"],
  },

  // 3 — adapted from seedBetaSlate VOTE_FARMSTAND (a closed vote with an
  //     outcome); topic new.
  {
    key: "vote_library_hours",
    kind: "vote",
    fits: EVERY_TYPE,
    by: "ALEX",
    at: -21,
    title: "Library hours: add weekday evenings or Saturday afternoons?",
    description:
      "The library cannot add hours without adding cost, so if it extends its hours it has to choose where. Weekday evenings would help people who work during the day. Saturday afternoons would help families and people who cannot come on weekdays. Keeping the current hours avoids the new cost.\n\n" +
      "This advisory vote asks which residents would prefer. The result goes to the {GOVERNING_BODY}.",
    method: "yes_no_unsure",
    options: [
      "Weekday evenings (open until 8 p.m. Monday to Thursday)",
      "Saturday afternoons (open 1 to 5 p.m.)",
      "Keep the current hours",
    ],
    phase: "closed",
    opens_at: -20,
    closes_at: -6,
    ballots: [21, 18, 11],
  },

  // 4 — adapted from seedBetaSlate BRIEF_FARMSTAND (a published outcome).
  {
    key: "outcome_library_hours",
    kind: "outcome",
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -6,
    source: "vote_library_hours",
    published_at: -4,
    headline: "Weekday evenings edged out Saturdays; about a fifth preferred no change",
    summary:
      "The question. Whether the library should add weekday evening hours, add Saturday afternoon hours, or keep its current hours.\n\n" +
      "Result. 50 residents voted over two weeks: 42% weekday evenings, 36% Saturday afternoons, 22% keep the current hours. No option had a majority.",
    sections: [
      {
        heading: "What supporters of weekday evenings said",
        body: "Many work during the library's current hours and can only come after work; evenings would also suit students.",
      },
      {
        heading: "What supporters of Saturday afternoons said",
        body: "Weekends are when families can come together; a single longer block may cost less to staff than several evenings.",
      },
      {
        heading: "What those who preferred no change said",
        body: "Current hours are adequate for them; they would rather the money go to the collection or to other services.",
      },
      {
        heading: "Suggested next step",
        body: "Ask the library for the cost of each option, or try one for a season and compare how many people use it. The vote is advisory; the decision rests with the {GOVERNING_BODY}.",
      },
    ],
    participation_label: "50 residents voted",
    participation_count: 50,
    sent_to: "{GOVERNING_BODY}",
  },

  // 5 — the shape of seedBetaSlate PROP_TOOL_LIBRARY / PROP_FARMSTAND (an open
  //     proposal with endorsements and comments); topic new.
  {
    key: "proposal_repair_list",
    kind: "proposal",
    fits: LOCAL_GOVERNMENT,
    by: "JORDAN",
    at: -9,
    title: "Publish a public priority list for road and sidewalk repairs",
    description:
      "Residents report potholes, broken sidewalks and worn crossings, but it is hard to tell which repairs are planned, which are not, and why. Some roads and sidewalks are maintained locally, some by the state, and some by private owners, which adds to the confusion.\n\n" +
      "The proposal: {JURISDICTION} publishes the repair requests it receives, who is responsible for each one, how requests are ranked, and which repairs are scheduled, and keeps the list up to date. This is not a request for any particular repair or for new spending on repairs.",
    closes_at: 21,
    endorsed_by: ["JORDAN", "ALEX", "CASEY"],
    comments: [
      {
        by: "ALEX",
        at: -8,
        body: "I would use this. I reported a broken curb ramp last year and never found out whether it was on anyone's list.",
      },
      {
        by: "SAM",
        at: -7,
        body: "I'm not against it, but staff time spent keeping a list current is time not spent on repairs. A short update a few times a year might be enough.",
      },
      {
        by: "CASEY",
        at: -5,
        body: "Who maintains it matters. A list that is six months out of date would be worse than no list. I endorsed it, but I'd want that settled before it's adopted.",
      },
      {
        by: "JORDAN",
        at: -4,
        body: "Fair points. Even a simple list updated each quarter, with the responsible office named for each item, would answer most of the questions people ask.",
      },
    ],
  },

  // 6 — adapted from seedData "Short-Term Rental Regulation"
  //     (seed-conv-rentals-001), in the shape of seedBetaSlate CONV_WATER.
  {
    key: "deliberation_rentals",
    kind: "deliberation",
    fits: LOCAL_GOVERNMENT,
    by: "CASEY",
    at: -10,
    topic: "Short-term rentals: what rules, if any, would work here?",
    framing:
      "Short-term rentals, meaning homes or rooms rented by the night through booking sites, bring visitors and income for some owners. For others they raise concerns about housing costs, parking, noise and neighborhood character. Possible rules range from none at all, to registration, to limits on how many rentals there can be or where.\n\n" +
      "React to each statement (agree, disagree or pass) and add your own. This conversation helps the {GOVERNING_BODY} see where residents agree before any rules are drafted.",
    closes_at: 32,
    statements: [
      "Short-term rentals let some homeowners earn income that helps them afford to stay here.",
      "When a whole house becomes a full-time rental, that is one fewer home for someone who lives and works here.",
      "A simple registration requirement is reasonable, so there is someone to contact when a problem comes up.",
      "Noise and parking rules already exist; enforce those rather than adding rules just for rentals.",
      "Renting a room in the home you live in should be treated differently from renting a whole house you don't live in.",
      "Visitors who stay in short-term rentals spend money at local businesses.",
      "Limits on the number of rentals would be unfair to owners who bought a property planning to rent it.",
      "Before writing any rules, we should know how many short-term rentals there are and where they are.",
    ],
    picture: {
      participants: 21,
      groups: [
        // Leans toward owners' freedom to rent, with light-touch rules.
        { size: 11, agree: [0, 3, 5], disagree: [1] },
        // Leans toward protecting housing and neighborhoods.
        { size: 10, agree: [1, 4], disagree: [3, 6] },
      ],
      consensus: [
        { statement: 7, agree_rate: 0.9, votes: 20 },
        { statement: 2, agree_rate: 0.81, votes: 21 },
      ],
    },
  },

  // 7 — adapted from seedBetaSlate KEEP.SKATE_PARK (an active project with
  //     updates), with the trails theme of CONV_RECREATION / KEEP.TRAILS_VOTE.
  {
    key: "project_trail_map",
    kind: "project",
    fits: LOCAL_GOVERNMENT,
    by: "CASEY",
    at: -18,
    title: "Connecting our trails: a community trail map",
    description:
      "A group of residents is making a free map of the public walking and biking trails, sidewalks and paths in {JURISDICTION}: where they are, how long they are, what surface they have, and where the gaps between them are.\n\n" +
      "The finished map will be shared with the {GOVERNING_BODY} and with anyone planning new trails or sidewalks. We are looking for people to walk a segment and note its condition.",
    supported_by: ["JORDAN", "SAM"],
    updates: [
      {
        at: -7,
        body: "Several volunteers have walked a dozen segments so far. The most common gap is a short missing link between a neighborhood and the nearest park or school. Next step: a draft map posted here for comments.",
      },
    ],
    comments: [
      {
        by: "SAM",
        at: -12,
        body: "Please mark clearly which paths cross private land or close for part of the year, so the map doesn't send people where they aren't welcome.",
      },
      {
        by: "ALEX",
        at: -9,
        body: "It would help to note which segments work for wheelchairs and strollers, not just for hiking.",
      },
    ],
  },

  // 8 — new; topic from seedData "FY2027 Budget Priorities".
  {
    key: "announcement_budget_hearing",
    kind: "announcement",
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -2,
    title: "Public hearing on the proposed budget",
    body:
      "The {GOVERNING_BODY} will hold a public hearing on the proposed budget for the coming fiscal year. Residents may speak at the hearing or send written comments beforehand.\n\n" +
      "The proposed budget is available for review before the hearing. The date, time and location will be posted on the official meeting calendar.",
  },

  // 9 — new. Not for school districts: a comprehensive plan is a land-use
  //     document of a general-purpose local government.
  {
    key: "announcement_comprehensive_plan",
    kind: "announcement",
    fits: LOCAL_GOVERNMENT,
    by: "TEAM",
    at: -8,
    title: "Comprehensive plan update: open house and survey",
    body:
      "{JURISDICTION} is updating its comprehensive plan, the long-range guide for land use, housing, transportation, parks and public services.\n\n" +
      "An open house will present draft goals, and a short survey will ask residents what they want to keep, change or add. The results will be shared with the {GOVERNING_BODY} before a draft plan is written.",
  },
];

/**
 * The templates that fit a jurisdiction type. A hub with no type set is
 * treated as "other" (a general-purpose local government). An outcome comes
 * only with its vote.
 */
export function templatesFor(type: JurisdictionType | null | undefined): SampleTemplate[] {
  const t: JurisdictionType = type ?? "other";
  const fitting = SAMPLE_TEMPLATES.filter((x) => x.fits.includes(t));
  const keys = new Set(fitting.map((x) => x.key));
  return fitting.filter((x) => x.kind !== "outcome" || keys.has(x.source));
}

export interface SampleNames {
  HUB_NAME: string;
  JURISDICTION: string;
  GOVERNING_BODY: string;
}

/** Fill the three placeholders. Nothing else is ever substituted. */
export function fillSample(text: string, names: SampleNames): string {
  return text.replace(/\{(HUB_NAME|JURISDICTION|GOVERNING_BODY)\}/g, (_m, k: keyof SampleNames) => names[k]);
}
