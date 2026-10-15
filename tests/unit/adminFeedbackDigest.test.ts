// Feedback moved from "an email per submission" to "an archive plus a daily
// digest line" on 2026-08-27, and moderation flags must keep their immediate
// email (below).
//
// The admin digest's body became a tally on 2026-10-15 (leaving-demo slice):
// one line per category, new since the last email and waiting beside it, each
// a link to its queue, no item lists. Nothing is sent when nothing is new; the
// rule that decides "new" is tested against the database in
// tests/api/adminDigestTally.test.ts.

import { describe, it, expect } from "vitest";
import { sendsImmediateEmail } from "../../src/modules/civic.feedback/index.js";
import { digestLineText, renderAdminDigestEmail, shownLines } from "../../src/modules/civic.admin_digest/index.js";
import type { AdminDigestPayload, DigestLine } from "../../src/modules/civic.admin_digest/index.js";

function line(over: Partial<DigestLine> & Pick<DigestLine, "id">): DigestLine {
  return {
    noun: { one: "process review", many: "process reviews" },
    new_count: 0,
    waiting: null,
    flagged: 0,
    url: `https://hub.example/admin/${over.id}`,
    ...over,
  };
}

function payload(lines: DigestLine[]): AdminDigestPayload {
  const new_total = lines.reduce((s, l) => s + l.new_count, 0);
  return {
    hub_name: "Example Civic Hub",
    since: "2026-10-14T13:30:00.000Z",
    until: "2026-10-15T13:30:00.000Z",
    lines,
    new_total,
    empty: new_total === 0,
  };
}

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

describe("admin digest — one line per category", () => {
  it("says new, then waiting, then flagged", () => {
    expect(
      digestLineText(
        line({ id: "reviews", new_count: 3, waiting: 8, flagged: 1, flagged_by: "the Code of Conduct check" }),
      ),
    ).toBe("3 new process reviews (8 waiting, 1 flagged by the Code of Conduct check)");
  });

  it("singularizes one", () => {
    expect(digestLineText(line({ id: "reviews", new_count: 1, waiting: 1 }))).toBe("1 new process review (1 waiting)");
  });

  it("shows the backlog on a line with nothing new", () => {
    expect(
      digestLineText(line({ id: "briefs", noun: { one: "brief to approve", many: "briefs to approve" }, waiting: 4 })),
    ).toBe("No new briefs to approve (4 waiting)");
  });

  it("has no waiting for a category without a queue", () => {
    expect(
      digestLineText(
        line({ id: "feedback", noun: { one: "feedback message", many: "feedback messages" }, new_count: 2 }),
      ),
    ).toBe("2 new feedback messages");
  });
});

describe("admin digest — the email", () => {
  const p = payload([
    line({ id: "job_problems", noun: { one: "scheduled job problem", many: "scheduled job problems" } }),
    line({ id: "reviews", new_count: 3, waiting: 8 }),
    line({ id: "briefs", noun: { one: "brief to approve", many: "briefs to approve" }, waiting: 4 }),
    line({ id: "meeting_summaries", noun: { one: "meeting summary", many: "meeting summaries" }, waiting: 0 }),
    line({ id: "feedback", noun: { one: "feedback message", many: "feedback messages" }, new_count: 2 }),
  ]);

  it("names the hub and the total in the subject, and only what is new", () => {
    expect(renderAdminDigestEmail(p).subject).toBe(
      "[Example Civic Hub] 5 new for admins: 3 process reviews, 2 feedback messages",
    );
  });

  it("shows lines with something new or waiting, and leaves out empty ones", () => {
    expect(shownLines(p).map((l) => l.id)).toEqual(["reviews", "briefs", "feedback"]);
    const { text } = renderAdminDigestEmail(p);
    expect(text).toContain("- 3 new process reviews (8 waiting)");
    expect(text).toContain("- No new briefs to approve (4 waiting)");
    expect(text).not.toContain("meeting summaries");
    expect(text).not.toContain("scheduled job");
  });

  it("links each line to its queue and lists no items", () => {
    const { html } = renderAdminDigestEmail(p);
    expect(html).toContain('href="https://hub.example/admin/reviews"');
    expect(html).toContain('href="https://hub.example/admin/briefs"');
    expect((html.match(/<li /g) ?? []).length).toBe(3);
  });

  it("is empty, and so not sent, when nothing is new, whatever is waiting", () => {
    expect(payload([line({ id: "reviews", waiting: 8 })]).empty).toBe(true);
  });

  it("no longer has open proposals or vote results", () => {
    const { text, html } = renderAdminDigestEmail(p);
    for (const out of [text, html]) {
      expect(out).not.toMatch(/open proposals/i);
      expect(out).not.toMatch(/vote results/i);
    }
  });
});
