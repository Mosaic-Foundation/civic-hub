// FIXTURE DATA — stub admin digest payload used by
// scripts/dryRunAdminDigest.ts (--stub) to render the admin digest email
// without hitting the live DB. The tally shape since 2026-10-15.

import type { AdminDigestPayload } from "../../../src/modules/civic.admin_digest/index.js";

export function buildStubAdminDigestPayload(now: string): AdminDigestPayload {
  const ui = "https://example.civic.social";
  const lines: AdminDigestPayload["lines"] = [
    { id: "job_problems", noun: { one: "scheduled job problem", many: "scheduled job problems" }, new_count: 1, waiting: null, flagged: 0, url: `${ui}/admin/settings/plugins` },
    { id: "reviews", noun: { one: "process review", many: "process reviews" }, new_count: 3, waiting: 8, flagged: 1, flagged_by: "the Code of Conduct check", url: `${ui}/admin/reviews` },
    { id: "briefs", noun: { one: "brief to approve", many: "briefs to approve" }, new_count: 0, waiting: 2, flagged: 0, url: `${ui}/admin/briefs` },
    { id: "meeting_summaries", noun: { one: "meeting summary", many: "meeting summaries" }, new_count: 6, waiting: 6, flagged: 0, flagged_by: "its quality check", url: `${ui}/admin/meeting-summaries` },
    { id: "feedback", noun: { one: "feedback message", many: "feedback messages" }, new_count: 2, waiting: null, flagged: 0, url: `${ui}/admin/feedback` },
    { id: "edits", noun: { one: "edit to a live process", many: "edits to live processes" }, new_count: 0, waiting: null, flagged: 0, url: `${ui}/admin/edits` },
    { id: "waitlist", noun: { one: "person on the waitlist", many: "people on the waitlist" }, new_count: 1, waiting: 4, flagged: 0, url: `${ui}/admin/settings/mode#waitlist` },
  ];
  const new_total = lines.reduce((s, l) => s + l.new_count, 0);
  return {
    hub_name: "Example Civic Hub",
    since: new Date(Date.parse(now) - 86_400_000).toISOString(),
    until: now,
    lines,
    new_total,
    empty: new_total === 0,
  };
}
