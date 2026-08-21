// One card per published process in the feed.
//
// Floyd's 2026-06-23 meeting summary appeared twice in the feed while the
// admin list showed a single record. It had been published in June from the
// agenda, then re-summarized in August when official minutes appeared; the
// upgrade sent it back through review and re-approval emitted a second
// result_published. Both events are true history and the log is append-only,
// but the feed is a projection of current state — the June card pointed at
// content that no longer existed.

import { describe, it, expect } from "vitest";

/** Mirrors the collapse in feedController.ts. */
function collapsePublications<
  T extends { event_type: string; process_id?: string; timestamp: string },
>(events: T[]): T[] {
  const newest = new Map<string, string>();
  for (const e of events) {
    if (e.event_type !== "civic.process.result_published" || !e.process_id) continue;
    const seen = newest.get(e.process_id);
    if (!seen || e.timestamp > seen) newest.set(e.process_id, e.timestamp);
  }
  if (newest.size === 0) return events;
  return events.filter(
    (e) =>
      e.event_type !== "civic.process.result_published" ||
      !e.process_id ||
      newest.get(e.process_id) === e.timestamp,
  );
}

const pub = (process_id: string, timestamp: string) => ({
  event_type: "civic.process.result_published",
  process_id,
  timestamp,
});

describe("feed — superseded publications", () => {
  it("keeps only the newest publication of a re-published process", () => {
    const out = collapsePublications([
      pub("proc_jun23", "2026-08-21T14:00:00Z"),
      pub("proc_jun23", "2026-06-25T10:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe("2026-08-21T14:00:00Z");
  });

  it("is order-independent", () => {
    const out = collapsePublications([
      pub("proc_jun23", "2026-06-25T10:00:00Z"),
      pub("proc_jun23", "2026-08-21T14:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe("2026-08-21T14:00:00Z");
  });

  it("keeps publications of DIFFERENT processes", () => {
    const out = collapsePublications([
      pub("proc_a", "2026-08-21T14:00:00Z"),
      pub("proc_b", "2026-08-21T14:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves non-publication events completely alone", () => {
    // Repeated comments and votes are distinct occurrences, not supersessions.
    const events = [
      { event_type: "civic.process.comment_added", process_id: "p", timestamp: "1" },
      { event_type: "civic.process.comment_added", process_id: "p", timestamp: "2" },
      { event_type: "civic.process.vote_submitted", process_id: "p", timestamp: "3" },
      { event_type: "civic.process.updated", process_id: "p", timestamp: "4" },
    ];
    expect(collapsePublications(events)).toHaveLength(4);
  });

  it("does not disturb a feed with no repeated publication", () => {
    const events = [
      pub("proc_a", "2026-08-21T14:00:00Z"),
      { event_type: "civic.process.created", process_id: "proc_a", timestamp: "2026-08-20T00:00:00Z" },
    ];
    expect(collapsePublications(events)).toHaveLength(2);
  });

  it("passes through publications carrying no process_id", () => {
    const out = collapsePublications([
      { event_type: "civic.process.result_published", timestamp: "1" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("collapses three publications of the same process to one", () => {
    const out = collapsePublications([
      pub("p", "2026-01-01T00:00:00Z"),
      pub("p", "2026-05-01T00:00:00Z"),
      pub("p", "2026-08-21T00:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe("2026-08-21T00:00:00Z");
  });
});
