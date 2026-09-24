// FIXTURE DATA — sample hub context and stub events used by
// scripts/dryRunUserDigest.ts to render a user digest without a live DB.

import type {
  DigestEvent,
  DigestHubContext,
} from "../../../src/modules/civic.digest/index.js";

export const DRY_RUN_USER_DIGEST_HUB: DigestHubContext = {
  hub_name: "Floyd Civic Hub",
  ui_base_url: "https://floyd.civic.social",
  postal_address: "Floyd, VA",
  unsubscribe_url: "https://floyd.civic.social/unsubscribe/digest?token=stub",
  manage_subscriptions_url: "https://floyd.civic.social/settings",
};

export const DRY_RUN_USER_DIGEST_SINCE = "2026-04-28T13:00:00Z";

export const DRY_RUN_USER_DIGEST_EVENTS: DigestEvent[] = [
  // 1. announcement (civic.announcement → result_published)
  {
    id: "evt_001",
    event_type: "civic.process.result_published",
    timestamp: "2026-04-29T02:18:27Z",
    process_id: "proc_announcement",
    action_url: "https://floyd.civic.social/announcement/proc_announcement",
    data: {
      announcement: {
        id: "proc_announcement",
        title: "Lawn Care Bid",
        author_role: "Floyd County Government",
      },
    },
  },
  // 2. vote open (civic.vote → started)
  {
    id: "evt_002",
    event_type: "civic.process.started",
    timestamp: "2026-04-29T03:00:00Z",
    process_id: "proc_vote",
    action_url: "https://floyd.civic.social/process/proc_vote",
    data: {
      vote: { title: "Add More Secure Dumpster (Green Box) Sites" },
    },
  },
  // 3. vote results (civic.vote_results → result_published)
  {
    id: "evt_003",
    event_type: "civic.process.result_published",
    timestamp: "2026-04-29T04:00:00Z",
    process_id: "proc_results",
    action_url: "https://floyd.civic.social/vote-results/proc_results",
    data: {
      results_id: "proc_results",
      title: "Vote results: Flock cameras",
    },
  },
  // 4. meeting summary (civic.meeting_summary → result_published)
  {
    id: "evt_004",
    event_type: "civic.process.result_published",
    timestamp: "2026-04-29T05:00:00Z",
    process_id: "proc_meeting",
    action_url: "https://floyd.civic.social/meeting-summary/proc_meeting",
    data: {
      meeting_summary: {
        meeting_title: "BOS Meeting — April 21",
      },
      summary_id: "proc_meeting",
    },
  },
];

export const DRY_RUN_USER_DIGEST_PROCESS_TITLES: Record<string, string> = {
  proc_announcement: "Lawn Care Bid",
  proc_vote: "Add More Secure Dumpster (Green Box) Sites",
  proc_results: "Vote results: Flock cameras",
  proc_meeting: "BOS Meeting — April 21",
};
