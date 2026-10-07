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

  it("meeting summaries: zero discovered is nothing new, not a failure (M7)", () => {
    expect(describeJobRun("meeting_summary", { status: 200, body: { discovered: 0, created: 0 } })).toEqual({
      status: "ok",
      summary: "Nothing new: the meeting source listed no meetings",
      problems: [],
    });
  });

  it("meeting summaries: a discovery that threw fails on its error", () => {
    // The controller's failRun answers 500 with the error.
    const r = describeJobRun("meeting_summary", {
      status: 500,
      body: { error: "fetch failed: ENOTFOUND", discovered: 0 },
    });
    expect(r).toEqual({ status: "failed", summary: "The run did not complete", problems: ["fetch failed: ENOTFOUND"] });
  });

  it("meeting summaries: each broken feed item is named with what is wrong (M4)", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: {
        discovered: 4,
        created: 0,
        broken_links: [
          {
            process_id: "proc_1",
            process_type: "civic.meeting_summary",
            title: "Meeting summary: 2026-06-09",
            reason: 'its approval is "pending", so its page shows "not found"',
          },
          {
            process_id: "proc_2",
            process_type: "civic.announcement",
            title: "Road closure",
            reason: 'it is back in review ("pending_review"), so its page is hidden from the public',
          },
        ],
      },
    });
    expect(r?.status).toBe("failed");
    expect(r?.problems).toEqual([
      '"Meeting summary: 2026-06-09" (meeting summary) is announced on the feed as published, but its approval is "pending", so its page shows "not found".',
      '"Road closure" (announcement) is announced on the feed as published, but it is back in review ("pending_review"), so its page is hidden from the public.',
    ]);
  });

  it("meeting summaries: an older row's bare count still reads for any type, not as 'summary links'", () => {
    const r = describeJobRun("meeting_summary", { status: 200, body: { discovered: 4, broken_links: 2 } });
    expect(r?.problems).toEqual(["2 items are announced on the feed as published, but their pages are not public."]);
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

  it("digest: residents the hub's mode held back are not a failure (#36)", () => {
    expect(
      describeJobRun("digest", {
        status: 200,
        body: { sent_count: 2, failed_count: 0, held_back_count: 26, held_back_reason: "this hub is in beta mode" },
      }),
    ).toEqual({
      status: "ok",
      summary: "Sent to 2 residents; held back from 26 because this hub is in beta mode",
      problems: [],
    });
    // A real failure alongside still fails, and counts only the real ones.
    const mixed = describeJobRun("digest", {
      status: 200,
      body: { sent_count: 0, failed_count: 1, held_back_count: 5, held_back_reason: "this hub is in demo mode" },
    });
    expect(mixed?.status).toBe("failed");
    expect(mixed?.problems).toEqual(["The digest could not be sent to 1 resident."]);
  });
});

// A quiet source (Adam, 2026-10-07): "nothing new" is fine, but no new
// meeting in 45 days asks for a check, flagged, never failed.
describe("describeJobRun — meeting source gone quiet", () => {
  const base = { discovered: 0, created: 0 };

  it("flags when the newest meeting is more than 45 days old", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: { ...base, newest_meeting_date: "2026-08-18", days_since_newest_meeting: 50 },
    });
    expect(r?.status).toBe("flagged");
    expect(r?.problems).toEqual([
      "No new meetings found since 2026-08-18 (50 days). Check that the meeting source still works.",
    ]);
  });

  it("is ok at 45 days or fewer", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: { ...base, newest_meeting_date: "2026-08-23", days_since_newest_meeting: 45 },
    });
    expect(r?.status).toBe("ok");
  });

  it("flags a source that has never listed a meeting", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: { ...base, newest_meeting_date: null, days_since_newest_meeting: null },
    });
    expect(r?.status).toBe("flagged");
    expect(r?.problems).toEqual([
      "The meeting source has not listed any meetings yet. Check that it is set up correctly.",
    ]);
  });

  it("a per-meeting failure still fails the run alongside it", () => {
    const r = describeJobRun("meeting_summary", {
      status: 200,
      body: {
        discovered: 3,
        created: 0,
        failures: [{ source_id: "m1", error: "PDF too large" }],
        newest_meeting_date: "2026-10-01",
        days_since_newest_meeting: 6,
      },
    });
    expect(r?.status).toBe("failed");
  });
});

describe("newestMeetingDate", () => {
  it("takes the newest valid date, ignoring blanks", async () => {
    const { newestMeetingDate } = await import("../../src/modules/civic.meeting_summary/readiness.js");
    expect(newestMeetingDate(["2026-08-01", null, "2026-09-22", "", undefined, "2026-09-01"])).toBe("2026-09-22");
    expect(newestMeetingDate([])).toBeNull();
  });
});
