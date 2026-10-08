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
//   reads right in (place hubs). The seed skips the rest.

import { JURISDICTION_TYPES, type JurisdictionType } from "../shared/jurisdictionType.js";
import { HUB_KINDS, type HubKind } from "../shared/hubKind.js";
import { fillSampleText } from "../shared/hubCopy.js";

/** Every type a general-purpose local government can be. */
const LOCAL_GOVERNMENT: readonly JurisdictionType[] = ["county", "city", "town", "village", "borough", "other"];
const SCHOOL_DISTRICT: readonly JurisdictionType[] = ["school_district"];
const EVERY_TYPE: readonly JurisdictionType[] = JURISDICTION_TYPES.map((t) => t.id);
const PLACE_ONLY: readonly HubKind[] = ["place"];
// A hub of another kind has no jurisdiction type; `fits` is not read for it.
// "other" takes the organization set (Adam, 2026-10-07).
const ORGANIZATION: readonly HubKind[] = ["organization", "other"];
const ISSUE: readonly HubKind[] = ["issue"];

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
  /**
   * The hub kinds (identity.hub_kind) the template reads right in
   * (2026-09-27). Since 2026-10-07 (review R18) every kind has its own set:
   * local governments, school districts, organizations (and "other"), issue
   * campaigns. Each set has the five a demo hub must always show (an open
   * vote, a vote gathering endorsements, an open proposal, a conversation, a
   * closed vote with its outcome), kept current by sampleRefresh.ts.
   */
  kinds: readonly HubKind[];
  /** Place hubs: the jurisdiction types it reads right in. */
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

/**
 * A published meeting summary (added 2026-10-06, Adam). Written by hand, not
 * by the summarizer: no recording, no minutes, no AI call. Each section has a
 * time into the (absent) meeting so the page shows how a real summary reads;
 * the page says it is a sample with no recording behind it.
 */
export interface SampleMeetingSummary extends Base {
  kind: "meeting_summary";
  /** The meeting's title; may use the three placeholders. */
  meeting_title: string;
  /** Days relative to seeding. */
  meeting_at: number;
  published_at: number;
  blocks: ReadonlyArray<{ title: string; summary: string; at_minute: number; action: string | null }>;
  /**
   * The meeting's minutes as plain text, shown on the page in place of a
   * minutes PDF (review issue #7, 2026-10-07). Paragraphs split on blank lines.
   */
  minutes: string;
}

/**
 * A word cloud with anonymous sample answers (added 2026-10-06, Adam). The
 * answers are rows, not events, like the sample ballots. When the hub has no
 * word cloud chosen (plugin.wordcloud.onboarding_id), this one is chosen.
 */
export interface SampleWordcloud extends Base {
  kind: "wordcloud";
  title: string;
  description: string;
  prompt: string;
  /** Each word and how many sample answers give it. */
  answers: ReadonlyArray<readonly [word: string, count: number]>;
}

export type SampleTemplate =
  | SampleVote
  | SampleOutcome
  | SampleProposal
  | SampleDeliberation
  | SampleProject
  | SampleAnnouncement
  | SampleMeetingSummary
  | SampleWordcloud;

export const SAMPLE_TEMPLATES: readonly SampleTemplate[] = [
  // 1 — adapted from seedBetaSlate VOTE_ENERGY; topic from seedData
  //     "Rural Broadband Expansion Priorities".
  {
    key: "vote_internet",
    kind: "vote",
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

    fits: LOCAL_GOVERNMENT,
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
    kinds: PLACE_ONLY,

    fits: LOCAL_GOVERNMENT,
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
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

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
    kinds: PLACE_ONLY,

    fits: LOCAL_GOVERNMENT,
    by: "TEAM",
    at: -8,
    title: "Comprehensive plan update: open house and survey",
    body:
      "{JURISDICTION} is updating its comprehensive plan, the long-range guide for land use, housing, transportation, parks and public services.\n\n" +
      "An open house will present draft goals, and a short survey will ask residents what they want to keep, change or add. The results will be shared with the {GOVERNING_BODY} before a draft plan is written.",
  },

  // 10 — new (2026-10-06). A meeting of the governing body: so not for
  //      school districts, whose board does not let road contracts.
  {
    key: "meeting_summary_regular",
    kind: "meeting_summary",
    kinds: PLACE_ONLY,

    fits: LOCAL_GOVERNMENT,
    by: "TEAM",
    at: -8,
    meeting_title: "{GOVERNING_BODY} regular meeting",
    meeting_at: -9,
    published_at: -8,
    blocks: [
      {
        title: "Public comment",
        summary:
          "Four residents spoke. Two asked for a crosswalk near an elementary school, one raised flooding on a residential street after heavy rain, and one thanked staff for the library's trial of evening hours.",
        at_minute: 4,
        action: null,
      },
      {
        title: "Library hours trial: first month",
        summary:
          "Staff reported on the first month of weekday evening hours. Members asked for visits by hour and by day before deciding whether to continue the trial, and one asked what Saturday hours would cost by comparison.",
        at_minute: 21,
        action: "Staff to return next month with usage figures and the cost of each option.",
      },
      {
        title: "Road resurfacing contract",
        summary:
          "Members reviewed three bids for this year's resurfacing work. Discussion weighed the lowest price against one bidder's shorter schedule, and whether to add a stretch of road that residents had asked about.",
        at_minute: 43,
        action: "Approved the lowest qualified bid by majority vote.",
      },
      {
        title: "Budget calendar",
        summary:
          "Staff presented the timeline for next year's budget: department requests, a work session, the proposed budget, and a public hearing before adoption.",
        at_minute: 68,
        action: "Set the public hearing for next month's regular meeting.",
      },
    ],
    minutes:
      "Call to order. The chair called the regular meeting of the {GOVERNING_BODY} to order. A quorum was present. The agenda was approved as presented, and the minutes of the previous regular meeting were approved without changes.\n\n" +
      "Public comment. Four residents spoke. Two asked for a marked crosswalk near an elementary school. One described flooding on a residential street after heavy rain and asked whether the drainage could be inspected. One thanked library staff for the trial of evening hours.\n\n" +
      "Library hours trial. Staff reported on the first month of weekday evening hours. Members asked for visits broken down by hour and by day, and one member asked what Saturday afternoon hours would cost by comparison. Staff will return next month with usage figures and the cost of each option.\n\n" +
      "Road resurfacing contract. Members reviewed three bids for this year's resurfacing work. Discussion weighed the lowest price against a competing bid with a shorter schedule, and whether to add a stretch of road residents had asked about. A motion to award the contract to the lowest qualified bidder carried by majority vote.\n\n" +
      "Budget calendar. Staff presented the timeline for next year's budget: department requests, a work session, the proposed budget, and a public hearing before adoption. By consensus, the public hearing was set for next month's regular meeting.\n\n" +
      "Adjournment. There being no further business, the meeting was adjourned.",
  },

  // 11 — new (2026-10-06). Fits every type: every place has things people
  //      value about it. Written to read right in a city and a rural county.
  {
    key: "wordcloud_value",
    kind: "wordcloud",
    kinds: PLACE_ONLY,

    fits: LOCAL_GOVERNMENT,
    by: "TEAM",
    at: -12,
    title: "What do you value most about {JURISDICTION}?",
    description: "One word is enough. Answers appear in the cloud as they come in.",
    prompt: "In one word, what do you value most about {JURISDICTION}?",
    answers: [
      ["neighbors", 6],
      ["community", 5],
      ["parks", 4],
      ["library", 3],
      ["schools", 3],
      ["friendly", 3],
      ["history", 2],
      ["safety", 2],
      ["nature", 2],
      ["events", 2],
    ],
  },

  // ===========================================================================
  // School districts (2026-10-07, review R18; titles approved by Adam). The
  // budget-hearing announcement above fits them too. {JURISDICTION} is the
  // district, {GOVERNING_BODY} its board.
  // ===========================================================================

  {
    key: "sd_vote_start_times",
    kind: "vote",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "JORDAN",
    at: -6,
    title: "Should high schools in {JURISDICTION} start later in the morning?",
    description:
      "Some families and teachers say teenagers would learn better with a later start. Others point out that a later start moves after-school jobs, sports and child care later too, and that bus routes may have to change for every school.\n\n" +
      "This advisory vote asks which way families and residents lean. Pick one. The result goes to the {GOVERNING_BODY}; it does not decide anything by itself.",
    method: "yes_no_unsure",
    options: [
      "Yes, start high schools later",
      "No, keep the current start times",
      "Study the costs and the bus schedule first",
    ],
    phase: "open",
    opens_at: -6,
    closes_at: 8,
    ballots: [11, 8, 9],
  },
  {
    key: "sd_vote_phones",
    kind: "vote",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "SAM",
    at: -5,
    title: "Should {JURISDICTION} limit student phone use during the school day?",
    description:
      "Some parents and teachers want phones put away during class, or for the whole day, to cut distraction. Others want students to be able to reach family, or use phones for schoolwork, and ask who would enforce a limit.\n\n" +
      "This vote opens once enough people endorse it. Endorse it if you think the question should be asked; endorsing does not mean you would vote yes.",
    method: "yes_no_unsure",
    options: ["Yes", "No", "Unsure"],
    phase: "proposed",
    endorsed_by: ["SAM", "ALEX", "CASEY"],
  },
  {
    key: "sd_vote_weather_days",
    kind: "vote",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "ALEX",
    at: -21,
    title: "Weather days: add make-up days in June or use remote learning days?",
    description:
      "When schools close for bad weather, the lost days have to be made up somehow. Adding days at the end of the year keeps learning in the classroom but runs into summer plans. Remote learning days avoid that but depend on every student having a device and a connection at home.\n\n" +
      "This advisory vote asks which families and residents would prefer. The result goes to the {GOVERNING_BODY}.",
    method: "yes_no_unsure",
    options: [
      "Add make-up days at the end of the year",
      "Use remote learning days on bad-weather days",
      "Shorten a holiday break instead",
    ],
    phase: "closed",
    opens_at: -20,
    closes_at: -6,
    ballots: [19, 22, 9],
  },
  {
    key: "sd_outcome_weather_days",
    kind: "outcome",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "TEAM",
    at: -6,
    source: "sd_vote_weather_days",
    published_at: -4,
    headline: "Remote learning days led, with make-up days in June close behind",
    summary:
      "The question. How lost weather days should be made up: extra days at the end of the year, remote learning days, or a shorter holiday break.\n\n" +
      "Result. 50 people voted over two weeks: 44% remote learning days, 38% make-up days at the end of the year, 18% a shorter holiday break. No option had a majority.",
    sections: [
      {
        heading: "What supporters of remote learning days said",
        body: "The school year ends on time, summer jobs and camps are not disrupted, and a day at home with assignments is better than a day lost.",
      },
      {
        heading: "What supporters of make-up days said",
        body: "Students learn more in the classroom, younger students need an adult at home on a remote day, and not every household has a reliable connection.",
      },
      {
        heading: "What supporters of a shorter break said",
        body: "Families can plan around a known change to the calendar more easily than around days added at the last minute.",
      },
      {
        heading: "Suggested next step",
        body: "Ask how many students lack a device or a connection at home before choosing remote days. The vote is advisory; the decision rests with the {GOVERNING_BODY}.",
      },
    ],
    participation_label: "50 people voted",
    participation_count: 50,
    sent_to: "{GOVERNING_BODY}",
  },
  {
    key: "sd_proposal_board_materials",
    kind: "proposal",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "JORDAN",
    at: -9,
    title: "Post school board meeting materials a week before each meeting",
    description:
      "Agendas and the documents behind them are often available only a day or two before the {GOVERNING_BODY} meets, which leaves little time for families to read them or plan to speak.\n\n" +
      "The proposal: {JURISDICTION} posts each meeting's agenda and supporting documents online at least seven days ahead, and marks anything added later. This is not a request about any particular decision.",
    closes_at: 21,
    endorsed_by: ["JORDAN", "ALEX", "CASEY"],
    comments: [
      {
        by: "ALEX",
        at: -8,
        body: "I'd use this. I found out about a curriculum vote the night before and couldn't get the materials in time to read them.",
      },
      {
        by: "SAM",
        at: -7,
        body: "Some items really do come up late, like a contract that needs a quick answer. A week is fine as the rule, but there has to be a way to add urgent items.",
      },
      {
        by: "CASEY",
        at: -5,
        body: "Marking late additions clearly would cover that. I'd also like the documents in a format that opens on a phone.",
      },
    ],
  },
  {
    key: "sd_deliberation_homework",
    kind: "deliberation",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "CASEY",
    at: -10,
    topic: "Homework: how much, and what kind, helps students?",
    framing:
      "Homework can reinforce what was taught in class and build habits. It can also crowd out sleep, family time, jobs and activities, and it lands differently on students with less help or less quiet space at home.\n\n" +
      "React to each statement (agree, disagree or pass) and add your own. This conversation helps the {GOVERNING_BODY} and teachers see where families agree before any guidelines are written.",
    closes_at: 32,
    statements: [
      "Regular practice at home helps students remember what they learned in class.",
      "Younger students should have little or no homework.",
      "Homework should never be the main part of a grade.",
      "Students without help or quiet space at home are at a disadvantage when homework counts heavily.",
      "Teachers in the same grade should coordinate so students don't get several large assignments on the same night.",
      "Reading for pleasure at home is worth more than worksheets.",
      "Without homework, many students would fall behind.",
      "Families should be asked how long homework actually takes.",
    ],
    picture: {
      participants: 22,
      groups: [
        { size: 12, agree: [0, 6], disagree: [1] },
        { size: 10, agree: [1, 3, 5], disagree: [6] },
      ],
      consensus: [
        { statement: 4, agree_rate: 0.91, votes: 22 },
        { statement: 7, agree_rate: 0.82, votes: 21 },
      ],
    },
  },
  {
    key: "sd_project_reading_buddies",
    kind: "project",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "CASEY",
    at: -18,
    title: "Reading buddies: volunteers for early readers",
    description:
      "A group of parents and neighbors is organizing volunteers to read one-on-one with early readers for half an hour a week, during the school day or in an after-school program.\n\n" +
      "We are putting together a short guide for volunteers and a schedule that fits around class time. Volunteers would go through the district's usual volunteer screening.",
    supported_by: ["JORDAN", "SAM"],
    updates: [
      {
        at: -7,
        body: "Fifteen people have signed up so far. Next step: a one-hour training session with a reading teacher, then a pilot in two classrooms.",
      },
    ],
    comments: [
      {
        by: "SAM",
        at: -12,
        body: "Please keep it consistent: the same volunteer with the same child each week matters more than the number of volunteers.",
      },
      {
        by: "ALEX",
        at: -9,
        body: "Could some of it happen after school too? Many working parents can't come during the day but would like to help.",
      },
    ],
  },
  {
    key: "sd_announcement_boundaries",
    kind: "announcement",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "TEAM",
    at: -8,
    title: "Enrollment and attendance-boundary review: community meetings",
    body:
      "{JURISDICTION} is reviewing enrollment projections and the boundaries that decide which school each address attends.\n\n" +
      "Community meetings will present the projections and any draft options, and a short survey will ask families what matters most to them. The results will be shared with the {GOVERNING_BODY} before any change is proposed.",
  },
  {
    key: "sd_meeting_summary_regular",
    kind: "meeting_summary",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "TEAM",
    at: -8,
    meeting_title: "{GOVERNING_BODY} regular meeting",
    meeting_at: -9,
    published_at: -8,
    blocks: [
      {
        title: "Public comment",
        summary:
          "Five people spoke. Two asked about crowding on one bus route, one asked for more after-school tutoring, one raised the condition of a playground, and one student spoke in favor of later start times.",
        at_minute: 5,
        action: null,
      },
      {
        title: "Reading curriculum adoption",
        summary:
          "Staff presented the review committee's recommendation for new elementary reading materials. Members asked about training for teachers and the cost over several years.",
        at_minute: 24,
        action: "Adopted the recommended materials by majority vote.",
      },
      {
        title: "Transportation update",
        summary:
          "Staff reported on driver vacancies and the routes that run late most often. Members asked whether routes could be combined and what the effect on ride times would be.",
        at_minute: 47,
        action: "Staff to bring options for the crowded route to the next meeting.",
      },
      {
        title: "Budget calendar",
        summary:
          "Staff presented the timeline for next year's budget: school requests, a work session, the proposed budget, and a public hearing before adoption.",
        at_minute: 66,
        action: "Set the public hearing for next month's regular meeting.",
      },
    ],
    minutes:
      "Call to order. The board chair called the regular meeting of the {GOVERNING_BODY} to order. A quorum was present. The agenda was approved, and the minutes of the previous regular meeting were approved without changes.\n\n" +
      "Public comment. Five people spoke. Two parents asked about crowding on one bus route. One asked for more after-school tutoring. One raised the condition of a playground. One student spoke in favor of later start times for high schools.\n\n" +
      "Reading curriculum adoption. Staff presented the review committee's recommendation for new elementary reading materials. Members asked about training for teachers and the total cost over several years. A motion to adopt the recommended materials carried by majority vote.\n\n" +
      "Transportation update. Staff reported on driver vacancies and the routes that most often run late. Members asked whether routes could be combined and how that would change ride times. Staff will bring options for the crowded route to the next meeting.\n\n" +
      "Budget calendar. Staff presented the timeline for next year's budget. By consensus, the public hearing was set for next month's regular meeting.\n\n" +
      "Adjournment. There being no further business, the meeting was adjourned.",
  },
  {
    key: "sd_wordcloud_good_school",
    kind: "wordcloud",
    kinds: PLACE_ONLY,
    fits: SCHOOL_DISTRICT,
    by: "TEAM",
    at: -12,
    title: "What makes a good school?",
    description: "One word is enough. Answers appear in the cloud as they come in.",
    prompt: "In one word, what makes a good school?",
    answers: [
      ["teachers", 6],
      ["safety", 5],
      ["kindness", 4],
      ["curiosity", 3],
      ["community", 3],
      ["reading", 3],
      ["arts", 2],
      ["sports", 2],
      ["respect", 2],
      ["challenge", 2],
    ],
  },

  // ===========================================================================
  // Organizations and clubs, and hubs of kind "other" (2026-10-07, review R18).
  // Written in the members' own voice ("we", "our"), so no hub name needs an
  // article; no place, no governing body.
  // ===========================================================================

  {
    key: "org_vote_meeting_times",
    kind: "vote",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "JORDAN",
    at: -6,
    title: "When should our regular meetings be held?",
    description:
      "Our meetings are at a time that suits some members and rules out others. Evenings are hard for people with young children, weekends for people who work them, and online meetings for people who prefer to meet face to face.\n\n" +
      "Pick the option that would let you come most often. The result guides the next meeting schedule.",
    method: "yes_no_unsure",
    options: [
      "Weekday evenings",
      "Saturday mornings",
      "Alternate between the two",
      "Online, at a time we vote on each season",
    ],
    phase: "open",
    opens_at: -6,
    closes_at: 8,
    ballots: [7, 6, 9, 4],
  },
  {
    key: "org_vote_hybrid_annual",
    kind: "vote",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "SAM",
    at: -5,
    title: "Should we hold our annual meeting online as well as in person?",
    description:
      "A meeting people can join online would let members who are away, ill or caring for someone take part. It also costs more to run well, and some members feel discussion is better when everyone is in the room.\n\n" +
      "This vote opens once enough members endorse it. Endorse it if you think members should be asked; endorsing does not mean you would vote yes.",
    method: "yes_no_unsure",
    options: ["Yes", "No", "Unsure"],
    phase: "proposed",
    endorsed_by: ["SAM", "ALEX", "CASEY"],
  },
  {
    key: "org_vote_member_news",
    kind: "vote",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "ALEX",
    at: -21,
    title: "How should we share news with members?",
    description:
      "News reaches members in several ways today, and some people miss things. We want one main channel that most members will actually see.\n\n" +
      "Pick the one you would rely on.",
    method: "yes_no_unsure",
    options: [
      "A monthly email newsletter",
      "Everything posted here on the hub",
      "Short text messages for urgent news, the hub for the rest",
    ],
    phase: "closed",
    opens_at: -20,
    closes_at: -6,
    ballots: [12, 7, 15],
  },
  {
    key: "org_outcome_member_news",
    kind: "outcome",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -6,
    source: "org_vote_member_news",
    published_at: -4,
    headline: "Text messages for urgent news, with the hub for the rest, came first",
    summary:
      "The question. Which one channel members would rely on for news: a monthly email newsletter, the hub, or text messages for urgent news with the hub for the rest.\n\n" +
      "Result. 34 people voted over two weeks: 44% text messages plus the hub, 35% a monthly newsletter, 21% the hub alone. No option had a majority.",
    sections: [
      {
        heading: "What supporters of text messages said",
        body: "Urgent news, like a cancelled meeting, has to reach people the same day; everything else can wait for the hub.",
      },
      {
        heading: "What supporters of a newsletter said",
        body: "One message a month is easy to read and easy to find again, and not everyone wants texts.",
      },
      {
        heading: "What supporters of the hub alone said",
        body: "One place for everything is simplest to keep up to date and keeps members' phone numbers out of it.",
      },
      {
        heading: "Suggested next step",
        body: "Ask members to opt in to text messages, and keep a short monthly roundup for those who prefer email.",
      },
    ],
    participation_label: "34 people voted",
    participation_count: 34,
    sent_to: "the organizers",
  },
  {
    key: "org_proposal_meeting_notes",
    kind: "proposal",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "JORDAN",
    at: -9,
    title: "Publish meeting notes within a week of each meeting",
    description:
      "Members who miss a meeting often don't hear what was decided until the next one. Notes exist, but they are not shared in one place or on any schedule.\n\n" +
      "The proposal: a short set of notes — decisions, who agreed to do what, and open questions — posted here within seven days of every meeting.",
    closes_at: 21,
    endorsed_by: ["JORDAN", "ALEX", "CASEY"],
    comments: [
      {
        by: "ALEX",
        at: -8,
        body: "Yes, please. I missed two meetings in a row and couldn't find out what had been decided.",
      },
      {
        by: "SAM",
        at: -7,
        body: "Fine by me, but someone has to take this on. If it's always the same volunteer it won't last. Could we rotate?",
      },
      {
        by: "CASEY",
        at: -5,
        body: "Rotating works if there's a simple template. A list of decisions and action items would be enough.",
      },
    ],
  },
  {
    key: "org_deliberation_involvement",
    kind: "deliberation",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "CASEY",
    at: -10,
    topic: "Getting more members involved: what would help?",
    framing:
      "A small group of members does most of the work, and many others would like to help but aren't sure how. Some say the time commitment is the problem; others say they are never asked.\n\n" +
      "React to each statement (agree, disagree or pass) and add your own. The organizers will use the results to plan the coming year.",
    closes_at: 32,
    statements: [
      "Small, one-time tasks would bring in people who can't commit to a regular role.",
      "Most people get involved because someone asked them personally.",
      "Our meetings are too long to attract new people.",
      "New members should be paired with someone who has been involved for a while.",
      "We should do fewer things, and do them well, rather than ask more of people.",
      "Social events matter as much as business meetings for keeping people involved.",
      "Roles and their time commitments should be written down so people know what they are signing up for.",
      "The same few people end up doing everything because they never step back.",
    ],
    picture: {
      participants: 19,
      groups: [
        { size: 10, agree: [0, 5, 6], disagree: [2] },
        { size: 9, agree: [2, 4, 7], disagree: [5] },
      ],
      consensus: [
        { statement: 1, agree_rate: 0.89, votes: 19 },
        { statement: 6, agree_rate: 0.84, votes: 19 },
      ],
    },
  },
  {
    key: "org_project_welcome_guide",
    kind: "project",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "CASEY",
    at: -18,
    title: "A welcome guide for new members",
    description:
      "A few members are writing a short guide for people who have just joined: what we do, how decisions are made, when and where we meet, and how to get involved.\n\n" +
      "We'd like help from members who joined recently and remember what they wished they had known.",
    supported_by: ["JORDAN", "SAM"],
    updates: [
      {
        at: -7,
        body: "A first draft is done: four pages, with a one-page summary at the front. Next step: three new members read it and tell us what is missing.",
      },
    ],
    comments: [
      {
        by: "SAM",
        at: -12,
        body: "Please include who to contact for what. That was the hardest thing to find out when I joined.",
      },
      {
        by: "ALEX",
        at: -9,
        body: "Keep it short. A guide nobody reads doesn't help anyone.",
      },
    ],
  },
  {
    key: "org_announcement_annual_meeting",
    kind: "announcement",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -2,
    title: "Annual meeting and election of officers",
    body:
      "Our annual meeting will review the past year, present the budget for the coming one, and elect officers.\n\n" +
      "Any member may stand for an office. Nominations are open until one week before the meeting; the date, time and place will be posted here.",
  },
  {
    key: "org_meeting_summary_members",
    kind: "meeting_summary",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -8,
    meeting_title: "Members' meeting",
    meeting_at: -9,
    published_at: -8,
    blocks: [
      {
        title: "Member comments",
        summary:
          "Three members spoke. One asked for meetings to start on time, one suggested a shared calendar of events, and one thanked the volunteers who ran last month's event.",
        at_minute: 3,
        action: null,
      },
      {
        title: "Treasurer's report",
        summary:
          "The treasurer reported income and spending for the quarter. Members asked how much is held in reserve and whether dues cover regular costs.",
        at_minute: 15,
        action: "Report accepted.",
      },
      {
        title: "Committee updates",
        summary:
          "The events committee proposed two events for the coming season, and the outreach committee reported on a new welcome guide for members.",
        at_minute: 31,
        action: "Both events approved, subject to the budget.",
      },
      {
        title: "Next meeting",
        summary: "Members discussed moving meetings to a time more people can attend, pending the vote on meeting times.",
        at_minute: 52,
        action: "Next meeting date to be set after the vote closes.",
      },
    ],
    minutes:
      "Call to order. The chair opened the meeting. The agenda was approved, and the notes of the previous meeting were accepted.\n\n" +
      "Member comments. Three members spoke. One asked for meetings to start on time. One suggested a shared calendar of events. One thanked the volunteers who ran last month's event.\n\n" +
      "Treasurer's report. The treasurer reported income and spending for the quarter. Members asked how much is held in reserve and whether dues cover regular costs. The report was accepted.\n\n" +
      "Committee updates. The events committee proposed two events for the coming season; both were approved, subject to the budget. The outreach committee reported on a welcome guide for new members.\n\n" +
      "Next meeting. Members discussed moving meetings to a time more people can attend. The date of the next meeting will be set after the vote on meeting times closes.\n\n" +
      "Adjournment. The meeting was adjourned.",
  },
  {
    key: "org_wordcloud_why_join",
    kind: "wordcloud",
    kinds: ORGANIZATION,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -12,
    title: "Why did you join?",
    description: "One word is enough. Answers appear in the cloud as they come in.",
    prompt: "In one word, why did you join?",
    answers: [
      ["friends", 6],
      ["community", 5],
      ["purpose", 4],
      ["learning", 3],
      ["fun", 3],
      ["support", 3],
      ["belonging", 2],
      ["change", 2],
      ["skills", 2],
      ["volunteering", 2],
    ],
  },

  // ===========================================================================
  // Issue campaigns (2026-10-07, review R18). About running a campaign, never
  // about which side of any issue is right; the members' own voice, no place.
  // ===========================================================================

  {
    key: "issue_vote_focus",
    kind: "vote",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "JORDAN",
    at: -6,
    title: "What should the campaign focus on in the next three months?",
    description:
      "We have more ideas than volunteers. Each of these reaches different people, and each takes a different kind of time.\n\n" +
      "Pick the one you think would do the most good in the next three months. The result guides the organizers' plan.",
    method: "yes_no_unsure",
    options: [
      "Talking with neighbors door to door",
      "Meeting with elected officials",
      "Hosting public information sessions",
      "Building our presence online",
    ],
    phase: "open",
    opens_at: -6,
    closes_at: 8,
    ballots: [9, 6, 8, 5],
  },
  {
    key: "issue_vote_chapters",
    kind: "vote",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "SAM",
    at: -5,
    title: "Should we form local chapters?",
    description:
      "Local chapters could reach more people and let volunteers meet near where they live. They also take organizers to run, and could pull the campaign in different directions.\n\n" +
      "This vote opens once enough people endorse it. Endorse it if you think the question should be asked; endorsing does not mean you would vote yes.",
    method: "yes_no_unsure",
    options: ["Yes", "No", "Unsure"],
    phase: "proposed",
    endorsed_by: ["SAM", "ALEX", "CASEY"],
  },
  {
    key: "issue_vote_decisions",
    kind: "vote",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "ALEX",
    at: -21,
    title: "How should the campaign make decisions between meetings?",
    description:
      "Some decisions can't wait a month for the next meeting: a press request, an invitation to speak, a change of plan. Today nobody is sure who may decide.\n\n" +
      "Pick the way you would trust most.",
    method: "yes_no_unsure",
    options: [
      "A small steering committee decides and reports back",
      "A quick poll of participants here on the hub",
      "Wait for the next full meeting unless it is urgent",
    ],
    phase: "closed",
    opens_at: -20,
    closes_at: -6,
    ballots: [11, 16, 7],
  },
  {
    key: "issue_outcome_decisions",
    kind: "outcome",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -6,
    source: "issue_vote_decisions",
    published_at: -4,
    headline: "A quick poll of participants was the most popular choice",
    summary:
      "The question. Who should make the campaign's decisions between meetings: a steering committee, a quick poll here on the hub, or the next full meeting.\n\n" +
      "Result. 34 people voted over two weeks: 47% a quick poll, 32% a steering committee, 21% wait for the next meeting. No option had a majority.",
    sections: [
      {
        heading: "What supporters of a quick poll said",
        body: "Everyone gets a say, and a poll can be done in a day or two.",
      },
      {
        heading: "What supporters of a steering committee said",
        body: "Some decisions need an answer within hours, and a small group that reports back is accountable.",
      },
      {
        heading: "What supporters of waiting said",
        body: "Few decisions are truly urgent, and a full meeting allows real discussion.",
      },
      {
        heading: "Suggested next step",
        body: "Combine them: a steering committee for decisions needed within a day or two, a poll for the rest, and both reported at the next meeting.",
      },
    ],
    participation_label: "34 people voted",
    participation_count: 34,
    sent_to: "the organizers",
  },
  {
    key: "issue_proposal_finances",
    kind: "proposal",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "JORDAN",
    at: -9,
    title: "Publish where the campaign's money comes from and how it is spent",
    description:
      "Supporters and skeptics both ask who funds the campaign. Being open about it would answer the question before it is asked.\n\n" +
      "The proposal: a short report each quarter, posted here, listing income by kind of source and spending by category.",
    closes_at: 21,
    endorsed_by: ["JORDAN", "ALEX", "CASEY"],
    comments: [
      {
        by: "ALEX",
        at: -8,
        body: "This would help when I talk to people. I get asked about funding more than about the issue itself.",
      },
      {
        by: "SAM",
        at: -7,
        body: "Some donors may not want their names public. Kinds of source, not names, seems right.",
      },
      {
        by: "CASEY",
        at: -5,
        body: "Agreed. And we should check what the law already requires us to report, so this lines up with it.",
      },
    ],
  },
  {
    key: "issue_deliberation_disagree",
    kind: "deliberation",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "CASEY",
    at: -10,
    topic: "Reaching people who disagree with us: what works?",
    framing:
      "Most of our conversations are with people who already agree. Persuading others means listening to why they see it differently, and some of us find that easier than others.\n\n" +
      "React to each statement (agree, disagree or pass) and add your own. The organizers will use the results to plan outreach and training.",
    closes_at: 32,
    statements: [
      "Listening first matters more than having the best argument.",
      "Personal stories persuade more people than facts and figures.",
      "We should spend our time on people who are undecided, not on those firmly opposed.",
      "People who disagree often have concerns we should take seriously and address.",
      "Our materials use words that only people already involved understand.",
      "Meeting in person works better than posting online.",
      "We should invite people who disagree to speak at our events.",
      "Volunteers need practice before they talk with strangers.",
    ],
    picture: {
      participants: 20,
      groups: [
        { size: 11, agree: [0, 3, 6], disagree: [2] },
        { size: 9, agree: [1, 2, 5], disagree: [6] },
      ],
      consensus: [
        { statement: 7, agree_rate: 0.9, votes: 20 },
        { statement: 4, agree_rate: 0.8, votes: 20 },
      ],
    },
  },
  {
    key: "issue_project_explainer",
    kind: "project",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "CASEY",
    at: -18,
    title: "A one-page explainer for newcomers",
    description:
      "People who hear about the campaign for the first time ask the same questions. A few volunteers are writing a one-page explainer in plain language: what the issue is, what the campaign is asking for, and how to learn more from several sources.\n\n" +
      "We'd like readers who are new to the issue to tell us what is unclear.",
    supported_by: ["JORDAN", "SAM"],
    updates: [
      {
        at: -7,
        body: "A draft is ready. Next step: five people who are new to the issue read it and mark anything confusing.",
      },
    ],
    comments: [
      {
        by: "SAM",
        at: -12,
        body: "Please include the strongest objections and our answers. People trust a page that admits there is another side.",
      },
      {
        by: "ALEX",
        at: -9,
        body: "A version in other languages spoken here would reach more people.",
      },
    ],
  },
  {
    key: "issue_announcement_training",
    kind: "announcement",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -2,
    title: "Volunteer training session",
    body:
      "A two-hour session for new and returning volunteers: what the campaign is asking for, how to talk with people who see it differently, and how to record what you hear.\n\n" +
      "No experience needed. The date, time and place will be posted here.",
  },
  {
    key: "issue_meeting_summary_organizing",
    kind: "meeting_summary",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -8,
    meeting_title: "Organizing meeting",
    meeting_at: -9,
    published_at: -8,
    blocks: [
      {
        title: "Volunteer report",
        summary:
          "The volunteer coordinator reported on sign-ups since the last meeting and how many people have attended a training session.",
        at_minute: 3,
        action: null,
      },
      {
        title: "Outreach plan",
        summary:
          "Participants discussed where to focus over the next three months, pending the vote, and how to follow up with people met at recent events.",
        at_minute: 14,
        action: "Organizers to draft a plan once the vote closes.",
      },
      {
        title: "Budget",
        summary:
          "The treasurer reported income and spending since the last meeting. Participants asked about the cost of printed materials compared with online outreach.",
        at_minute: 33,
        action: "Report accepted.",
      },
      {
        title: "Next steps",
        summary: "Participants agreed on the next training session and who will prepare the explainer for newcomers.",
        at_minute: 49,
        action: "Training session to be announced on the hub.",
      },
    ],
    minutes:
      "Opening. The facilitator opened the meeting and reviewed the agenda. Notes of the previous meeting were accepted.\n\n" +
      "Volunteer report. The volunteer coordinator reported on sign-ups since the last meeting and on attendance at training sessions.\n\n" +
      "Outreach plan. Participants discussed where to focus over the next three months, pending the vote now open, and how to follow up with people met at recent events. Organizers will draft a plan once the vote closes.\n\n" +
      "Budget. The treasurer reported income and spending since the last meeting. Participants asked about the cost of printed materials compared with online outreach. The report was accepted.\n\n" +
      "Next steps. Participants agreed to hold another training session and named volunteers to prepare the explainer for newcomers.\n\n" +
      "Close. The meeting was closed.",
  },
  {
    key: "issue_wordcloud_why_matters",
    kind: "wordcloud",
    kinds: ISSUE,
    fits: EVERY_TYPE,
    by: "TEAM",
    at: -12,
    title: "Why does this issue matter to you?",
    description: "One word is enough. Answers appear in the cloud as they come in.",
    prompt: "In one word, why does this issue matter to you?",
    answers: [
      ["fairness", 6],
      ["future", 5],
      ["family", 4],
      ["trust", 3],
      ["voice", 3],
      ["community", 3],
      ["accountability", 2],
      ["hope", 2],
      ["children", 2],
      ["respect", 2],
    ],
  },
];

/**
 * The templates that fit a hub: its kind first (unset = place), then, for a
 * place hub, its jurisdiction type (unset = "other", a general-purpose local
 * government). An outcome comes only with its vote. Every kind has a set
 * since 2026-10-07.
 */
export function templatesFor(type: JurisdictionType | null | undefined, kind: HubKind = "place"): SampleTemplate[] {
  const t: JurisdictionType = type ?? "other";
  const fitting = SAMPLE_TEMPLATES.filter((x) => x.kinds.includes(kind) && (kind !== "place" || x.fits.includes(t)));
  const keys = new Set(fitting.map((x) => x.key));
  return fitting.filter((x) => x.kind !== "outcome" || keys.has(x.source));
}

export interface SampleNames {
  HUB_NAME: string;
  JURISDICTION: string;
  GOVERNING_BODY: string;
}

/**
 * Fill the three placeholders. Nothing else is ever substituted. The place
 * takes its article where English wants one (fillSampleText, review R19).
 */
export function fillSample(text: string, names: SampleNames): string {
  return fillSampleText(text, names);
}

/** The hub kinds that have at least one sample template (the create form's checkbox). */
export function kindsWithSamples(): HubKind[] {
  return HUB_KINDS.map((k) => k.id).filter((k) => SAMPLE_TEMPLATES.some((t) => t.kinds.includes(k)));
}

/**
 * The console's create-form preview (2026-10-06): the first line of one
 * sample card, with its placeholders left in for the form to fill from what
 * is typed. Since 2026-10-07 (review R21) it is a card that WILL be seeded
 * for that kind and type of place — an open vote first — keyed
 * "<kind>:<type>" ("place:school_district", "organization:"); null when
 * nothing would be seeded.
 */
export function samplePreview(
  type: JurisdictionType | null | undefined,
  kind: HubKind = "place",
): { pill: string; title: string } | null {
  const fitting = templatesFor(type, kind).filter((x) => x.kind !== "outcome");
  const t = fitting.find((x) => x.kind === "vote") ?? fitting[0];
  if (!t) return null;
  const title = "title" in t && typeof t.title === "string" ? t.title : "";
  return { pill: t.kind === "vote" ? "Vote open" : "Sample", title };
}

/** samplePreview for every kind and type, for the console's config. */
export function samplePreviews(): Record<string, { pill: string; title: string } | null> {
  const out: Record<string, { pill: string; title: string } | null> = {};
  for (const k of HUB_KINDS.map((x) => x.id)) {
    if (k !== "place") {
      out[`${k}:`] = samplePreview(null, k);
      continue;
    }
    for (const t of JURISDICTION_TYPES.map((x) => x.id)) out[`place:${t}`] = samplePreview(t, k);
    out["place:"] = samplePreview(null, k);
  }
  return out;
}
