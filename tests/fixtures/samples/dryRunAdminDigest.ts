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
    reviews: {
      count: 1,
      items: [{ id: "rev_001", title: "Should the library open on Sundays?", created_at: now }],
      panel_url: "https://example.civic.social/admin/reviews",
    },
    briefs: {
      count: 1,
      items: [{ id: "brief_001", title: "Speed cameras (April)", created_at: now }],
      panel_url: "https://example.civic.social/admin/briefs",
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
    feedback: { count: 0, items: [], panel_url: "https://example.civic.social/admin/feedback" },
    job_problems: { count: 0, items: [], panel_url: "https://example.civic.social/admin/settings/plugins" },
    empty: false,
  };
}
