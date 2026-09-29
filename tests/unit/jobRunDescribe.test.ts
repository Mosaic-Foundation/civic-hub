// What each scheduled job's outcome means to an admin (src/jobs/describe.ts):
// the status and reason that reach the "last run" line and the admin digest.

import { describe, it, expect } from "vitest";
import { describeJobRun } from "../../src/jobs/describe.js";

describe("describeJobRun", () => {
  it("records nothing for a run that did nothing (not the send hour, not configured)", () => {
    expect(describeJobRun("digest", { status: 200, body: { skipped: true, reason: "not the send hour" } })).toBeNull();
    expect(describeJobRun("meeting_summary", { status: 200, body: { skipped: true } })).toBeNull();
    expect(describeJobRun("vote_close", { status: 200, body: { checked: 4, closed: [], failed: [] } })).toBeNull();
  });

  it("a thrown run is a failure with its message", () => {
    const r = describeJobRun("news_sync", null, "connection reset");
    expect(r).toEqual({ status: "failed", summary: "The run did not complete", problems: ["connection reset"] });
  });

  it("any job's error body is a failure with the error as the reason", () => {
    const r = describeJobRun("digest", { status: 500, body: { error: "DIGEST_UNSUBSCRIBE_SECRET must be set" } });
    expect(r?.status).toBe("failed");
    expect(r?.problems).toEqual(["DIGEST_UNSUBSCRIBE_SECRET must be set"]);
  });

  it("meeting summaries: a clean run summarizes what it produced", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: { discovered: 12, created: 1, upgraded: 1, failures: [], flagged: [], waiting: [{ days_since_meeting: 1 }] },
    });
    expect(r).toEqual({
      status: "ok",
      summary: "1 summary written, 1 updated, 1 waiting for a recording or minutes",
      problems: [],
    });
  });

  it("meeting summaries: a per-meeting failure fails the run and names the meeting", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: { discovered: 12, created: 0, failures: [{ source_id: "wix:2026-09-22:regular", error: "PDF too large" }] },
    });
    expect(r?.status).toBe("failed");
    expect(r?.problems[0]).toMatch(/wix:2026-09-22:regular: PDF too large/);
  });

  it("meeting summaries: zero discovered is a failure, not a quiet day", () => {
    expect(describeJobRun("meeting_summary", { status: 200, body: { discovered: 0 } })?.status).toBe("failed");
  });

  it("meeting summaries: a meeting waiting past the grace period is flagged", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: {
        discovered: 3,
        waiting: [{ meeting_date: "2026-09-01", meeting_title: "Regular Meeting", reason: "no captions", days_since_meeting: 20 }],
      },
    });
    expect(r?.status).toBe("flagged");
    expect(r?.problems[0]).toMatch(/2026-09-01 Regular Meeting has waited 20 days: no captions/);
  });

  it("news sync and the digests report partial send failures", () => {
    expect(describeJobRun("news_sync", { status: 200, body: { discovered: 5, created: 2, failed: 1 } })).toEqual({
      status: "failed",
      summary: "2 new announcements from 5 posts",
      problems: ["1 news post could not be imported."],
    });
    expect(describeJobRun("digest", { status: 200, body: { sent_count: 40, failed_count: 0 } })?.summary).toBe(
      "Sent to 40 residents",
    );
    expect(describeJobRun("admin_digest", { status: 200, body: { empty: true, sent: 0, failed: 0 } })?.summary).toBe(
      "Nothing to report; no email sent",
    );
  });
});
