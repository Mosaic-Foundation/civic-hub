// Feedback moved from "an email per submission" to "an archive plus a daily
// digest line" on 2026-08-27. Two things have to hold for that to be safe:
//
//   1. Moderation flags keep their immediate email. Every other category
//      lost it, which is the point; moderation losing it would be a
//      regression that no one notices until a flag sits for a day.
//   2. The digest can be sent for feedback alone. Feedback is the only
//      digest section that is not a review queue, so it is the only one
//      that can be the sole reason an email goes out — the subject and
//      body must still read correctly in that case.

import { describe, it, expect } from "vitest";
import { sendsImmediateEmail } from "../../src/modules/civic.feedback/index.js";
import { renderAdminDigestEmail } from "../../src/modules/civic.admin_digest/index.js";
import type {
  AdminDigestPayload,
  QueueSnapshot,
} from "../../src/modules/civic.admin_digest/index.js";

const emptyQueue = (panel: string): QueueSnapshot => ({
  count: 0,
  items: [],
  panel_url: panel,
});

function payload(over: Partial<AdminDigestPayload> = {}): AdminDigestPayload {
  return {
    hub_name: "Floyd Civic Hub",
    generated_at: "2026-08-27T12:00:00.000Z",
    proposals: emptyQueue("https://hub.example/propose"),
    vote_results: emptyQueue("https://hub.example/admin/vote-results"),
    meeting_summaries: emptyQueue("https://hub.example/admin/meeting-summaries"),
    feedback: emptyQueue("https://hub.example/admin/feedback"),
    empty: true,
    ...over,
  };
}

const feedbackQueue: QueueSnapshot = {
  count: 3,
  items: [
    {
      id: "fb_abc123",
      title: "topic — Broadband access in the eastern part of the county",
      created_at: "2026-08-27T09:00:00.000Z",
    },
    {
      id: "fb_def456",
      title: "bug — The vote page scrolls sideways on my phone",
      created_at: "2026-08-27T08:00:00.000Z",
    },
  ],
  panel_url: "https://hub.example/admin/feedback",
};

describe("immediate-email policy", () => {
  it("keeps the push for moderation only", () => {
    expect(sendsImmediateEmail("moderation")).toBe(true);
  });

  it("drops it for everything the admin panel now collects", () => {
    for (const c of ["idea", "topic", "bug", "general"] as const) {
      expect(sendsImmediateEmail(c)).toBe(false);
    }
  });
});

describe("admin digest — feedback section", () => {
  it("renders nothing when there is no new feedback", () => {
    const { html, text } = renderAdminDigestEmail(payload());
    expect(html).not.toContain("New feedback");
    expect(text).not.toContain("New feedback");
  });

  it("carries a readable subject when feedback is the only reason to send", () => {
    const { subject } = renderAdminDigestEmail(
      payload({ feedback: feedbackQueue, empty: false }),
    );
    expect(subject).toBe("[Floyd Civic Hub] Admin queue: 3 feedback submissions");
  });

  it("singularizes a lone submission", () => {
    const { subject } = renderAdminDigestEmail(
      payload({
        feedback: { ...feedbackQueue, count: 1, items: [feedbackQueue.items[0]] },
        empty: false,
      }),
    );
    expect(subject).toContain("1 feedback submission");
    expect(subject).not.toContain("submissions");
  });

  it("deep-links each item to its row in the archive, not to a detail page", () => {
    // Feedback has no per-submission page. The digest links to an anchor on
    // the list, which AdminFeedback.tsx renders as the <li> id.
    //
    // Asserted on the path, not the origin: item hrefs are built from
    // uiBaseUrl() (env-dependent) while panel_url comes from the payload.
    const { html } = renderAdminDigestEmail(
      payload({ feedback: feedbackQueue, empty: false }),
    );
    expect(html).toContain("/admin/feedback#fb_abc123");
    expect(html).not.toContain("/admin/feedback/fb_abc123");
    expect(html).toContain("Open feedback panel");
  });

  it("reports overflow past the display cap", () => {
    const { html, text } = renderAdminDigestEmail(
      payload({ feedback: feedbackQueue, empty: false }),
    );
    // count 3, items 2 — one beyond the cap.
    expect(html).toContain("+ 1 more");
    expect(text).toContain("+ 1 more");
  });

  it("leaves the review queues untouched when they have items", () => {
    const { subject } = renderAdminDigestEmail(
      payload({
        meeting_summaries: {
          count: 2,
          items: [
            { id: "p1", title: "Aug 4 BOS", created_at: "2026-08-27T07:00:00.000Z" },
          ],
          panel_url: "https://hub.example/admin/meeting-summaries",
        },
        feedback: feedbackQueue,
        empty: false,
      }),
    );
    expect(subject).toBe(
      "[Floyd Civic Hub] Admin queue: 2 meeting summaries, 3 feedback submissions",
    );
  });
});
