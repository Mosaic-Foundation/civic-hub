// Feed link health — the check the counters cannot do.
//
// The meeting-summary run that broke two live pages reported complete success:
// discovery worked, summarization worked, every counter read zero. What broke
// was publication STATE — the upgrade pass cleared published_at on already
// published summaries, so their pages 404'd while their feed cards stayed up.
//
// These pin the rule that decides whether a published card still resolves.

import { describe, it, expect } from "vitest";
import { publicationFailure } from "../../src/services/feedHealth.js";
import type { Process } from "../../src/models/process.js";

function proc(over: Partial<Process> = {}): Process {
  return {
    id: "proc_test",
    definition: { type: "civic.meeting_summary", version: "0.1" },
    title: "Meeting summary: 2026-06-09",
    description: "",
    jurisdiction: "us-va-floyd",
    status: "finalized",
    state: { approval_status: "published" },
    hubId: "civic-hub-floyd",
    createdBy: "system:meeting-summary-cron",
    createdAt: "2026-06-25T16:24:00Z",
    updatedAt: "2026-06-25T16:24:00Z",
    ...over,
  } as Process;
}

describe("publicationFailure", () => {
  it("passes a published, publicly-fetchable process", () => {
    expect(publicationFailure(proc())).toBeNull();
  });

  it("catches the unpublish bug — announced published, state says pending", () => {
    // Exactly what the upgrade pass did to Floyd's 2026-06-09 summary.
    const reason = publicationFailure(proc({ state: { approval_status: "pending" } }));
    expect(reason).toContain("pending");
    expect(reason).toContain("404");
  });

  it("catches the transient approved state too", () => {
    expect(publicationFailure(proc({ state: { approval_status: "approved" } }))).not.toBeNull();
  });

  it("catches an archived process whose card is still out there", () => {
    const reason = publicationFailure(proc({ status: "archived" }));
    expect(reason).toContain("archived");
  });

  it("catches a process pulled back into review", () => {
    expect(publicationFailure(proc({ status: "pending_review" }))).not.toBeNull();
  });

  it("catches a process that no longer exists", () => {
    expect(publicationFailure(null)).toContain("no longer exists");
  });

  it("passes a type with no approval gate of its own", () => {
    // Announcements and projects publish without an approval_status in state;
    // the process-level status is the only gate, and it passes.
    expect(
      publicationFailure(
        proc({ definition: { type: "civic.announcement", version: "0.1" }, state: {} }),
      ),
    ).toBeNull();
  });

  it("ignores a non-string approval_status rather than crying wolf", () => {
    expect(publicationFailure(proc({ state: { approval_status: null } }))).toBeNull();
  });
});
