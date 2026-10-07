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
    reviews: emptyQueue("https://hub.example/admin/reviews"),
    briefs: emptyQueue("https://hub.example/admin/briefs"),
    meeting_summaries: emptyQueue("https://hub.example/admin/meeting-summaries"),
    feedback: emptyQueue("https://hub.example/admin/feedback"),
    job_problems: { count: 0, items: [], panel_url: "https://hub.example/admin/settings/plugins" },
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

// 2026-10-07 (docs session #5): the queues an admin acts on. The dead
// "Vote results awaiting approval" section (civic.vote_results, which votes
// no longer create) is gone.
describe("admin digest — Process reviews and briefs", () => {
  const reviews: QueueSnapshot = {
    count: 1,
    items: [{ id: "rev_1", title: "Should the library open on Sundays?", created_at: "2026-10-07T09:00:00.000Z" }],
    panel_url: "https://hub.example/admin/reviews",
  };
  const briefs: QueueSnapshot = {
    count: 2,
    items: [
      { id: "proc_b1", title: "Speed cameras", created_at: "2026-10-07T08:00:00.000Z" },
      { id: "proc_b2", title: "Park hours", created_at: "2026-10-06T08:00:00.000Z" },
    ],
    panel_url: "https://hub.example/admin/briefs",
  };

  it("names both queues in the subject and links each item to its page", () => {
    const { subject, html, text } = renderAdminDigestEmail(payload({ reviews, briefs, empty: false }));
    expect(subject).toBe("[Floyd Civic Hub] Admin queue: 1 submission to review, 2 briefs to approve");
    expect(html).toContain("Submissions waiting in Process reviews — 1 submission");
    expect(html).toContain("/admin/reviews/rev_1");
    expect(html).toContain("Open Process reviews panel");
    expect(html).toContain("Briefs awaiting approval — 2 briefs");
    expect(html).toContain("/admin/briefs/proc_b1");
    expect(text).toContain("Briefs awaiting approval: 2");
  });

  it("has no vote-results section any more", () => {
    const { html, text } = renderAdminDigestEmail(payload({ reviews, briefs, empty: false }));
    expect(html).not.toMatch(/Vote results/i);
    expect(text).not.toMatch(/Vote results/i);
  });
});
