import { describe, expect, it } from "vitest";
import { closesWords, closingShownIn, withClosing } from "./closingSoon";
import type { ClosingSoonRow } from "../services/api";

const NY = "America/New_York";
// Monday 2026-11-09, 10:00 AM in New York.
const NOW = Date.parse("2026-11-09T15:00:00Z");
const h = (n: number) => new Date(NOW + n * 3_600_000).toISOString();

function row(id: string, closes: string, since: string): ClosingSoonRow {
  return { process_id: id, type: "civic.vote", title: id, closes_at: closes, since, url: `/process/${id}` };
}

describe("closing soon words (Events 4)", () => {
  it("says today, tomorrow or in 2 days by the calendar in the hub's zone", () => {
    expect(closesWords("2026-11-09T22:00:00Z", NOW, NY)).toBe("Closes today at 5:00 PM");
    expect(closesWords("2026-11-10T22:00:00Z", NOW, NY)).toBe("Closes tomorrow at 5:00 PM");
    expect(closesWords("2026-11-11T14:00:00Z", NOW, NY)).toBe("Closes in 2 days");
    // 11:30 PM Monday in New York is already Tuesday in UTC: the hub's zone decides.
    expect(closesWords("2026-11-10T04:30:00Z", NOW, NY)).toBe("Closes today at 11:30 PM");
  });

  it("shows in All and Activity only", () => {
    expect(closingShownIn(undefined)).toBe(true);
    expect(closingShownIn("activity")).toBe(true);
    expect(closingShownIn("announcement")).toBe(false);
    expect(closingShownIn("meeting_summary")).toBe(false);
  });
});

describe("closing cards in the feed (Events 4)", () => {
  const posts = [h(-1), h(-5), h(-30)].map((at, i) => ({ post: `p${i}`, at }));

  it("sets each card in by when it entered the window, newest first", () => {
    const out = withClosing(posts, [row("a", h(40), h(-8)), row("b", h(47), h(-1 + 0.5))], { now: NOW, hasMore: false });
    expect(out.map((r) => (r.kind === "post" ? r.post : `closing:${r.row.process_id}`))).toEqual([
      "closing:b",
      "p0",
      "p1",
      "closing:a",
      "p2",
    ]);
  });

  it("leaves out what has closed, and holds back an older card while older pages remain", () => {
    const closing = [row("gone", h(-0.1), h(-48)), row("old", h(5), h(-43))];
    expect(withClosing(posts, closing, { now: NOW, hasMore: true }).filter((r) => r.kind === "closing")).toEqual([]);
    const all = withClosing(posts, closing, { now: NOW, hasMore: false });
    expect(all.map((r) => (r.kind === "post" ? r.post : r.row.process_id))).toEqual(["p0", "p1", "p2", "old"]);
  });

  it("is the cards alone on an empty feed", () => {
    expect(withClosing([], [row("a", h(3), h(-45))], { now: NOW, hasMore: false })).toHaveLength(1);
  });
});
