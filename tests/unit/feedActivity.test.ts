import { describe, it, expect } from "vitest";
import {
  classifyActivity,
  type ClassifierEvent,
} from "../../src/shared/feedActivity.js";

// Helper — build a minimal classifier event. `data` defaults to {}.
function ev(
  event_type: string,
  data: Record<string, unknown> = {},
  overrides: Partial<ClassifierEvent> = {},
): ClassifierEvent {
  return {
    event_type,
    process_id: "proc_1",
    action_url: "https://hub.example/process/proc_1",
    data,
    ...overrides,
  };
}

// Shorthand for the canonical discriminator emitEvent now stamps.
function withType(type: string, rest: Record<string, unknown> = {}) {
  return { process: { type, ...rest } };
}

describe("classifyActivity — gate (allowlist, default-closed)", () => {
  it("excludes review-lifecycle events regardless of viewer", () => {
    expect(classifyActivity(ev("civic.review.submitted"))).toBeNull();
    expect(classifyActivity(ev("civic.review.approved"))).toBeNull();
  });

  it("excludes non-feed-worthy lifecycle events even when they carry process.type", () => {
    // These now carry data.process.type for backend uniformity but must NOT
    // surface in the feed — the allowlist, not the field, decides visibility.
    for (const t of [
      "civic.process.updated",
      "civic.process.ended",
      "civic.process.vote_submitted",
      "civic.process.comment_added",
      "civic.process.aggregation_completed",
      "civic.process.outcome_recorded",
      "civic.process.proposed",
      "civic.process.threshold_met",
      "civic.process.submission_received",
      "civic.proposal.supported",
      "civic.proposal.endorsed",
      "civic.project.archived",
      "civic.project.comment_added",
      "civic.project.sentiment_changed",
    ]) {
      expect(classifyActivity(ev(t, withType("civic.vote")))).toBeNull();
    }
  });

  it("returns null for an unknown event type (default-closed, no bland Activity)", () => {
    expect(classifyActivity(ev("civic.something.new"))).toBeNull();
  });
});

describe("classifyActivity — started", () => {
  it("classifies a vote open via data.process.type", () => {
    const a = classifyActivity(ev("civic.process.started", withType("civic.vote")));
    expect(a).toMatchObject({ surface: "activity", kind: "vote-open", pill: "Vote open" });
    expect(a?.href).toBe("https://hub.example/process/proc_1"); // action_url verbatim
  });

  it("classifies a legacy vote open (no process.type) as vote-open", () => {
    const a = classifyActivity(ev("civic.process.started"));
    expect(a?.kind).toBe("vote-open");
  });

  it("classifies a wordcloud open via process.type and links to /wordcloud/:id", () => {
    const a = classifyActivity(ev("civic.process.started", withType("civic.wordcloud")));
    expect(a).toMatchObject({ surface: "activity", kind: "wordcloud", pill: "Word cloud" });
    expect(a?.href).toBe("/wordcloud/proc_1");
  });

  it("excludes a deliberation start (it posts on created, not started)", () => {
    expect(
      classifyActivity(ev("civic.process.started", withType("civic.polis_deliberation"))),
    ).toBeNull();
    // Legacy Polis flat field is honored too.
    expect(
      classifyActivity(ev("civic.process.started", { process_type: "civic.polis_deliberation" })),
    ).toBeNull();
  });
});

describe("classifyActivity — result_published discrimination", () => {
  it("vote-results via process.type", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", withType("civic.vote_results")),
    );
    expect(a).toMatchObject({ surface: "activity", kind: "vote-results", pill: "Vote results" });
  });

  it("vote-results via legacy results_id / brief_id shape", () => {
    expect(
      classifyActivity(ev("civic.process.result_published", { results_id: "proc_1" }))?.kind,
    ).toBe("vote-results");
    expect(
      classifyActivity(ev("civic.process.result_published", { brief_id: "b1" }))?.kind,
    ).toBe("vote-results");
  });

  it("universal brief → 'brief' kind with a per-source-type pill, linking to /brief/:id", () => {
    const cases: Array<[string, string]> = [
      ["civic.polis_deliberation", "Conversation results"],
      ["civic.vote", "Vote results"],
      ["civic.proposal", "Proposal results"],
      ["civic.project", "Project completed"],
      ["civic.unknown_future", "Civic Brief"],
    ];
    for (const [srcType, pill] of cases) {
      const a = classifyActivity(
        ev("civic.process.result_published", {
          process: { type: "civic.brief" },
          brief: { source_process_type: srcType },
        }),
      );
      expect(a).toMatchObject({ surface: "activity", kind: "brief", pill });
      expect(a?.href).toBe("/brief/proc_1");
    }
  });

  it("a civic.brief is classified by processType first (never mistaken for vote-results)", () => {
    // Even if a stray brief_id-like field were present, processType wins.
    const a = classifyActivity(
      ev("civic.process.result_published", {
        process: { type: "civic.brief" },
        brief: { source_process_type: "civic.vote" },
      }),
    );
    expect(a?.kind).toBe("brief");
  });

  it("announcement (admin) → announcement pill+kind under the announcement surface", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", { announcement: { author_role: "admin" } }),
    );
    expect(a).toMatchObject({ surface: "announcement", kind: "announcement", pill: "Admin" });
  });

  it("announcement (board) → announcement-author kind, 'Board member' pill", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", { announcement: { author_role: "board" } }),
    );
    expect(a).toMatchObject({ kind: "announcement-author", pill: "Board member" });
  });

  it("announcement abbreviates Government → Gov", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", {
        announcement: { author_role: "Floyd County Government" },
      }),
    );
    expect(a?.pill).toBe("Floyd County Gov");
    expect(a?.kind).toBe("announcement-author");
  });

  it("synced announcement reuses the admin palette (announcement kind)", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", {
        announcement: { author_role: "Floyd County Government", source: { origin: "floyd-news" } },
      }),
    );
    expect(a?.kind).toBe("announcement");
  });

  it("meeting summary via process.type → meeting_summary surface", () => {
    const a = classifyActivity(
      ev("civic.process.result_published", withType("civic.meeting_summary")),
    );
    expect(a).toMatchObject({ surface: "meeting_summary", kind: "meeting", pill: "Meeting summary" });
  });

  it("meeting summary via legacy summary_id shape", () => {
    expect(
      classifyActivity(ev("civic.process.result_published", { summary_id: "s1" }))?.kind,
    ).toBe("meeting");
  });

  it("wordcloud result via legacy wordcloud_snapshot shape", () => {
    expect(
      classifyActivity(ev("civic.process.result_published", { wordcloud_snapshot: {} }))?.kind,
    ).toBe("wordcloud");
  });

  it("excludes the raw vote result_published (process.type) — no double-post", () => {
    expect(
      classifyActivity(ev("civic.process.result_published", withType("civic.vote"))),
    ).toBeNull();
  });

  it("excludes the raw vote result_published (legacy data.result shape)", () => {
    expect(
      classifyActivity(ev("civic.process.result_published", { result: { total_votes: 3 } })),
    ).toBeNull();
  });

  it("returns null for an unknown result_published shape (no bland Activity)", () => {
    expect(classifyActivity(ev("civic.process.result_published", {}))).toBeNull();
  });
});

describe("classifyActivity — created / proposal / project / outcome", () => {
  it("conversation created → conversation card to /deliberation/:id", () => {
    const a = classifyActivity(
      ev("civic.process.created", withType("civic.polis_deliberation")),
    );
    expect(a).toMatchObject({ surface: "activity", kind: "conversation", pill: "New conversation" });
    expect(a?.href).toBe("/deliberation/proc_1");
  });

  it("non-conversation created → null (votes/results/announcements post elsewhere)", () => {
    expect(classifyActivity(ev("civic.process.created", withType("civic.vote")))).toBeNull();
    expect(
      classifyActivity(ev("civic.process.created", withType("civic.vote_results"))),
    ).toBeNull();
  });

  it("proposal submitted → proposal card to /proposal/:id", () => {
    const a = classifyActivity(ev("civic.proposal.submitted", { proposal: { title: "X" } }));
    expect(a).toMatchObject({ surface: "activity", kind: "proposal", pill: "New proposal" });
    expect(a?.href).toBe("/proposal/proc_1");
  });

  /**
   * CHANGED 2026-08-26 (Adam). A closing proposal used to post its own card,
   * and then its published brief posted another — one proposal, two cards
   * saying much the same thing. The brief is the better of the two: the
   * "closed" card sent a reader to a finished proposal with no outcome on it
   * yet. Silencing this makes all three process types behave alike; a closing
   * vote has never posted a card, and conversations dropped theirs for the
   * same reason.
   *
   * The EVENT still fires and is still on the wire — only the feed card is
   * withheld. The `proposal-closed` kind stays defined throughout the feed and
   * digest renderers because proposals closed before this change keep their
   * cards: the feed is a projection of an append-only log.
   */
  it("proposal closed → no feed card; the published brief is the announcement", () => {
    expect(classifyActivity(ev("civic.proposal.closed", { proposal: { support_count: 2 } }))).toBeNull();
  });

  it("project created/updated → project cards via action_url", () => {
    expect(classifyActivity(ev("civic.project.created"))?.kind).toBe("project-created");
    expect(classifyActivity(ev("civic.project.updated"))?.kind).toBe("project-updated");
  });

  it("outcome_delivered → conversation-results card to /deliberation/:originating (Part C)", () => {
    const a = classifyActivity(
      ev("civic.outcome_delivered", { originating_process_id: "proc_orig" }),
    );
    expect(a).toMatchObject({ kind: "conversation-results", pill: "Conversation results" });
    expect(a?.href).toBe("/deliberation/proc_orig");
  });
});
