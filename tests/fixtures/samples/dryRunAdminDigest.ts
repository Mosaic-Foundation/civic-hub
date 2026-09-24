// FIXTURE DATA — stub admin digest payload used by
// scripts/dryRunAdminDigest.ts (--stub) to render the admin digest email
// without hitting the live DB.

import type { AdminDigestPayload } from "../../../src/modules/civic.admin_digest/index.js";

export function buildStubAdminDigestPayload(now: string): AdminDigestPayload {
  return {
    hub_name: "Floyd Civic Hub",
    generated_at: now,
    proposals: {
      count: 2,
      items: [
        { id: "prop_001", title: "Sidewalks on Main Street", created_at: now },
        { id: "prop_002", title: "Dog park near the courthouse", created_at: now },
      ],
      panel_url: "https://example.civic.social/admin/proposals",
    },
    vote_results: {
      count: 1,
      items: [
        { id: "vr_001", title: "Vote results: Flock cameras (April)", created_at: now },
      ],
      panel_url: "https://example.civic.social/admin/vote-results",
    },
    meeting_summaries: {
      count: 7,
      items: [
        { id: "ms_001", title: "BOS Meeting — April 21", created_at: now },
        { id: "ms_002", title: "BOS Meeting — April 14", created_at: now },
        { id: "ms_003", title: "Planning Commission — April 18", created_at: now },
        { id: "ms_004", title: "Budget Workshop — April 10", created_at: now },
        { id: "ms_005", title: "BOS Meeting — April 7", created_at: now },
      ],
      panel_url: "https://example.civic.social/admin/meeting-summaries",
    },
    empty: false,
  };
}
