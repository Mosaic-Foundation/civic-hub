// Mock data for seeded deliberation conversations.
// When a conversation ID starts with "seed-", the deliberation controller
// returns this data instead of calling the real Polis API. This lets us
// demo the full UI without a running Polis instance.

interface MockStatement {
  id: number;
  text: string;
  is_seed: boolean;
  created: string;
}

interface MockClusterState {
  participant_count: number;
  statement_count: number;
  math_tick: number;
  groups: {
    id: number;
    size: number;
    representative_statements: {
      text: string;
      direction: "agree" | "disagree";
      repness: number;
    }[];
  }[];
  consensus: {
    agree: {
      statement_id: number;
      text: string;
      agree_rate: number;
      vote_count: number;
    }[];
    disagree: {
      statement_id: number;
      text: string;
      agree_rate: number;
      vote_count: number;
    }[];
  };
}

interface MockConversation {
  statements: MockStatement[];
  clusters: MockClusterState;
}

// ---------- Broadband conversation ----------

const BROADBAND_STATEMENTS: MockStatement[] = [
  {
    id: 1,
    text: "The county should prioritize fiber-optic infrastructure over satellite internet — it's more reliable and future-proof.",
    is_seed: true,
    created: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    text: "Starlink already works well enough for most people here. The county shouldn't spend millions on redundant infrastructure.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    text: "Schools and the library should be the first priority — kids can't do homework without reliable internet.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    text: "A county-owned broadband co-op would keep costs down and profits local.",
    is_seed: false,
    created: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 5,
    text: "We should partner with an existing ISP rather than trying to build and manage our own network.",
    is_seed: false,
    created: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 6,
    text: "Telehealth depends on broadband. People in remote hollows are driving 45 minutes for basic doctor visits.",
    is_seed: false,
    created: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 7,
    text: "The grant money from the federal broadband program won't last forever — we need to act now or miss out.",
    is_seed: false,
    created: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 8,
    text: "I run a small business from home and lose customers every time the internet goes down. This is an economic issue, not just convenience.",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 9,
    text: "Fixed wireless could serve the hardest-to-reach areas faster and cheaper than burying fiber on every road.",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 10,
    text: "Whatever we build should be publicly owned so we're not locked into one company that can raise prices later.",
    is_seed: false,
    created: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 11,
    text: "My road has 8 houses on it and no provider will serve us because the density is too low. That's exactly the gap the county should fill.",
    is_seed: false,
    created: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 12,
    text: "We should survey which roads and areas have zero coverage first before deciding on technology.",
    is_seed: false,
    created: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

const BROADBAND_CLUSTERS: MockClusterState = {
  participant_count: 42,
  statement_count: 12,
  math_tick: 12,
  groups: [
    {
      id: 1,
      size: 18,
      representative_statements: [
        {
          text: "A county-owned broadband co-op would keep costs down and profits local.",
          direction: "agree",
          repness: 0.92,
        },
        {
          text: "Whatever we build should be publicly owned so we're not locked into one company that can raise prices later.",
          direction: "agree",
          repness: 0.88,
        },
        {
          text: "We should partner with an existing ISP rather than trying to build and manage our own network.",
          direction: "disagree",
          repness: 0.79,
        },
      ],
    },
    {
      id: 2,
      size: 14,
      representative_statements: [
        {
          text: "We should partner with an existing ISP rather than trying to build and manage our own network.",
          direction: "agree",
          repness: 0.87,
        },
        {
          text: "Fixed wireless could serve the hardest-to-reach areas faster and cheaper than burying fiber on every road.",
          direction: "agree",
          repness: 0.82,
        },
        {
          text: "A county-owned broadband co-op would keep costs down and profits local.",
          direction: "disagree",
          repness: 0.74,
        },
      ],
    },
    {
      id: 3,
      size: 10,
      representative_statements: [
        {
          text: "Schools and the library should be the first priority — kids can't do homework without reliable internet.",
          direction: "agree",
          repness: 0.95,
        },
        {
          text: "Telehealth depends on broadband. People in remote hollows are driving 45 minutes for basic doctor visits.",
          direction: "agree",
          repness: 0.9,
        },
        {
          text: "Starlink already works well enough for most people here. The county shouldn't spend millions on redundant infrastructure.",
          direction: "disagree",
          repness: 0.85,
        },
      ],
    },
  ],
  consensus: {
    agree: [
      {
        statement_id: 3,
        text: "Schools and the library should be the first priority — kids can't do homework without reliable internet.",
        agree_rate: 0.91,
        vote_count: 38,
      },
      {
        statement_id: 7,
        text: "The grant money from the federal broadband program won't last forever — we need to act now or miss out.",
        agree_rate: 0.86,
        vote_count: 36,
      },
      {
        statement_id: 12,
        text: "We should survey which roads and areas have zero coverage first before deciding on technology.",
        agree_rate: 0.83,
        vote_count: 35,
      },
    ],
    disagree: [],
  },
};

// ---------- Budget conversation ----------

const BUDGET_STATEMENTS: MockStatement[] = [
  {
    id: 1,
    text: "Road maintenance should be the top priority — some secondary roads are barely passable after a hard rain.",
    is_seed: true,
    created: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    text: "The county should fund a full-time economic development position to attract small businesses.",
    is_seed: true,
    created: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    text: "We need more investment in the public schools — teacher salaries here are below the state average.",
    is_seed: false,
    created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    text: "The recreation department needs a real budget. There's almost nothing for kids to do here outside of school.",
    is_seed: false,
    created: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 5,
    text: "Property taxes are already too high. The county should find savings before asking for more money.",
    is_seed: false,
    created: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 6,
    text: "Mental health and substance abuse services are severely underfunded. People are dying because there's no local access to treatment.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 7,
    text: "The library is one of the most-used public services in the county and it's running on a shoestring. Fund it properly.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 8,
    text: "Volunteer fire departments need county support for equipment. They're running 20-year-old trucks.",
    is_seed: false,
    created: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 9,
    text: "We should invest in tourism infrastructure — trails, signage, a visitor center. Tourism is our growth engine.",
    is_seed: false,
    created: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 10,
    text: "The county should set aside a reserve fund for emergencies rather than spending every dollar each year.",
    is_seed: false,
    created: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 11,
    text: "Affordable housing should be a budget priority. Young families can't afford to stay here.",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 12,
    text: "Stop funding things the private sector can handle and focus on core government services — roads, schools, public safety.",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 13,
    text: "The county website and online services are embarrassingly outdated. Budget for a modern platform residents can actually use.",
    is_seed: false,
    created: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 14,
    text: "Senior services need expansion — transportation, meals, and in-home care support for our aging population.",
    is_seed: false,
    created: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

const BUDGET_CLUSTERS: MockClusterState = {
  participant_count: 67,
  statement_count: 14,
  math_tick: 8,
  groups: [
    {
      id: 1,
      size: 22,
      representative_statements: [
        {
          text: "We need more investment in the public schools — teacher salaries here are below the state average.",
          direction: "agree",
          repness: 0.93,
        },
        {
          text: "Mental health and substance abuse services are severely underfunded. People are dying because there's no local access to treatment.",
          direction: "agree",
          repness: 0.89,
        },
        {
          text: "Property taxes are already too high. The county should find savings before asking for more money.",
          direction: "disagree",
          repness: 0.76,
        },
      ],
    },
    {
      id: 2,
      size: 19,
      representative_statements: [
        {
          text: "Property taxes are already too high. The county should find savings before asking for more money.",
          direction: "agree",
          repness: 0.91,
        },
        {
          text: "Stop funding things the private sector can handle and focus on core government services — roads, schools, public safety.",
          direction: "agree",
          repness: 0.86,
        },
        {
          text: "The county should fund a full-time economic development position to attract small businesses.",
          direction: "disagree",
          repness: 0.72,
        },
      ],
    },
    {
      id: 3,
      size: 15,
      representative_statements: [
        {
          text: "We should invest in tourism infrastructure — trails, signage, a visitor center. Tourism is our growth engine.",
          direction: "agree",
          repness: 0.94,
        },
        {
          text: "The county should fund a full-time economic development position to attract small businesses.",
          direction: "agree",
          repness: 0.88,
        },
        {
          text: "Stop funding things the private sector can handle and focus on core government services — roads, schools, public safety.",
          direction: "disagree",
          repness: 0.81,
        },
      ],
    },
    {
      id: 4,
      size: 11,
      representative_statements: [
        {
          text: "Senior services need expansion — transportation, meals, and in-home care support for our aging population.",
          direction: "agree",
          repness: 0.96,
        },
        {
          text: "Volunteer fire departments need county support for equipment. They're running 20-year-old trucks.",
          direction: "agree",
          repness: 0.91,
        },
        {
          text: "We should invest in tourism infrastructure — trails, signage, a visitor center. Tourism is our growth engine.",
          direction: "disagree",
          repness: 0.68,
        },
      ],
    },
  ],
  consensus: {
    agree: [
      {
        statement_id: 1,
        text: "Road maintenance should be the top priority — some secondary roads are barely passable after a hard rain.",
        agree_rate: 0.88,
        vote_count: 59,
      },
      {
        statement_id: 8,
        text: "Volunteer fire departments need county support for equipment. They're running 20-year-old trucks.",
        agree_rate: 0.85,
        vote_count: 57,
      },
      {
        statement_id: 10,
        text: "The county should set aside a reserve fund for emergencies rather than spending every dollar each year.",
        agree_rate: 0.82,
        vote_count: 55,
      },
      {
        statement_id: 7,
        text: "The library is one of the most-used public services in the county and it's running on a shoestring. Fund it properly.",
        agree_rate: 0.79,
        vote_count: 53,
      },
    ],
    disagree: [],
  },
};

// ---------- Flock Camera conversation (production demo) ----------

const FLOCK_STATEMENTS: MockStatement[] = [
  {
    id: 1,
    text: "These cameras helped recover my neighbor's stolen truck within 24 hours. They clearly work for solving property crimes.",
    is_seed: true,
    created: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    text: "I don't want the government tracking where I drive every day. This is rural Virginia, not a police state.",
    is_seed: true,
    created: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    text: "There should be a publicly accessible policy that says exactly how long plate data is kept and who can access it.",
    is_seed: false,
    created: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    text: "If the cameras are only reading plates on public roads, there's no reasonable expectation of privacy. You're in public.",
    is_seed: false,
    created: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 5,
    text: "The Sheriff's office should have to publish an annual report on how many times camera data was used, what for, and what the outcomes were.",
    is_seed: false,
    created: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 6,
    text: "Flock is a private company. We're handing law enforcement data to a corporation with its own profit motives.",
    is_seed: false,
    created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 7,
    text: "I'd feel safer knowing there are cameras at key intersections. Drug traffic through the county is a real problem.",
    is_seed: false,
    created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 8,
    text: "The issue isn't the cameras — it's the lack of oversight. We need a civilian review board with access to audit logs.",
    is_seed: false,
    created: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 9,
    text: "Most people didn't even know these cameras were installed. The lack of public notice is the real problem.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 10,
    text: "Law enforcement in a small county like ours is stretched thin. Tools like this help them do more with less.",
    is_seed: false,
    created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 11,
    text: "If we allow this, what's next? Facial recognition? Drones? You have to draw a line somewhere.",
    is_seed: false,
    created: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 12,
    text: "I support the cameras but only with a strict 30-day data retention limit and no sharing with federal agencies.",
    is_seed: false,
    created: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 13,
    text: "The board should have voted on this publicly before the cameras were installed, not after.",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 14,
    text: "Can we see the actual contract with Flock Safety? How much is this costing taxpayers?",
    is_seed: false,
    created: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 15,
    text: "Other rural counties in Virginia have these and crime clearance rates went up. The data supports keeping them.",
    is_seed: false,
    created: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 16,
    text: "Transparency and oversight would address most of my concerns. I'm not against the technology — I'm against unchecked surveillance.",
    is_seed: false,
    created: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

const FLOCK_CLUSTERS: MockClusterState = {
  participant_count: 58,
  statement_count: 16,
  math_tick: 15,
  groups: [
    {
      id: 1,
      size: 21,
      representative_statements: [
        {
          text: "These cameras helped recover my neighbor's stolen truck within 24 hours. They clearly work for solving property crimes.",
          direction: "agree",
          repness: 0.94,
        },
        {
          text: "Law enforcement in a small county like ours is stretched thin. Tools like this help them do more with less.",
          direction: "agree",
          repness: 0.89,
        },
        {
          text: "I don't want the government tracking where I drive every day. This is rural Virginia, not a police state.",
          direction: "disagree",
          repness: 0.78,
        },
      ],
    },
    {
      id: 2,
      size: 17,
      representative_statements: [
        {
          text: "I don't want the government tracking where I drive every day. This is rural Virginia, not a police state.",
          direction: "agree",
          repness: 0.93,
        },
        {
          text: "If we allow this, what's next? Facial recognition? Drones? You have to draw a line somewhere.",
          direction: "agree",
          repness: 0.87,
        },
        {
          text: "If the cameras are only reading plates on public roads, there's no reasonable expectation of privacy. You're in public.",
          direction: "disagree",
          repness: 0.81,
        },
      ],
    },
    {
      id: 3,
      size: 20,
      representative_statements: [
        {
          text: "The issue isn't the cameras — it's the lack of oversight. We need a civilian review board with access to audit logs.",
          direction: "agree",
          repness: 0.96,
        },
        {
          text: "I support the cameras but only with a strict 30-day data retention limit and no sharing with federal agencies.",
          direction: "agree",
          repness: 0.91,
        },
        {
          text: "Transparency and oversight would address most of my concerns. I'm not against the technology — I'm against unchecked surveillance.",
          direction: "agree",
          repness: 0.88,
        },
      ],
    },
  ],
  consensus: {
    agree: [
      {
        statement_id: 3,
        text: "There should be a publicly accessible policy that says exactly how long plate data is kept and who can access it.",
        agree_rate: 0.93,
        vote_count: 54,
      },
      {
        statement_id: 5,
        text: "The Sheriff's office should have to publish an annual report on how many times camera data was used, what for, and what the outcomes were.",
        agree_rate: 0.88,
        vote_count: 51,
      },
      {
        statement_id: 9,
        text: "Most people didn't even know these cameras were installed. The lack of public notice is the real problem.",
        agree_rate: 0.84,
        vote_count: 49,
      },
      {
        statement_id: 13,
        text: "The board should have voted on this publicly before the cameras were installed, not after.",
        agree_rate: 0.81,
        vote_count: 47,
      },
    ],
    disagree: [],
  },
};

// ---------- Lookup ----------

const MOCK_CONVERSATIONS: Record<string, MockConversation> = {
  "seed-conv-broadband-001": {
    statements: BROADBAND_STATEMENTS,
    clusters: BROADBAND_CLUSTERS,
  },
  "seed-conv-budget-001": {
    statements: BUDGET_STATEMENTS,
    clusters: BUDGET_CLUSTERS,
  },
  "seed-conv-flock-001": {
    statements: FLOCK_STATEMENTS,
    clusters: FLOCK_CLUSTERS,
  },
};

/**
 * Returns true if the conversation ID belongs to a seed/demo conversation.
 */
export function isSeedConversation(conversationId: string): boolean {
  return conversationId.startsWith("seed-");
}

/**
 * Get mock cluster state for a seed conversation.
 */
export function getMockClusters(
  conversationId: string,
): MockClusterState | null {
  return MOCK_CONVERSATIONS[conversationId]?.clusters ?? null;
}

/**
 * Get the next unvoted statement for a seed conversation.
 * Uses a simple rotating index tracked per user in memory.
 */
const userStatementIndex = new Map<string, number>();

export function getMockNextStatement(
  conversationId: string,
  userId: string,
): MockStatement | null {
  const conv = MOCK_CONVERSATIONS[conversationId];
  if (!conv || conv.statements.length === 0) return null;

  const key = `${conversationId}:${userId}`;
  const idx = userStatementIndex.get(key) ?? 0;

  if (idx >= conv.statements.length) return null; // all voted

  const stmt = conv.statements[idx];
  return stmt;
}

/**
 * Advance the statement pointer (called after a vote).
 */
export function advanceMockStatement(
  conversationId: string,
  userId: string,
): void {
  const key = `${conversationId}:${userId}`;
  const idx = userStatementIndex.get(key) ?? 0;
  userStatementIndex.set(key, idx + 1);
}

/**
 * Add a user-submitted statement to the mock conversation.
 */
export function addMockStatement(
  conversationId: string,
  text: string,
): MockStatement | null {
  const conv = MOCK_CONVERSATIONS[conversationId];
  if (!conv) return null;

  const stmt: MockStatement = {
    id: conv.statements.length + 1,
    text,
    is_seed: false,
    created: new Date().toISOString(),
  };
  conv.statements.push(stmt);
  return stmt;
}
