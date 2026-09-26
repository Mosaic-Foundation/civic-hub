// Phase 5 part two, fix 6: the digest's window is judged by when an event was
// RECORDED, not by its own (possibly backdated) timestamp. A vote closed on a
// quiet hub a day after its deadline is stamped with the deadline; by that
// stamp it would sit before the resident's cursor and never be mailed.

import { describe, expect, it } from "vitest";
import { recordedAfter } from "../../src/controllers/digestController.js";

const since = "2026-09-20T13:00:00.000Z"; // the resident's last digest

describe("digest window", () => {
  it("includes a close stamped before the cursor but recorded after it", () => {
    const events = [
      { id: "old", timestamp: "2026-09-19T12:00:00.000Z", recorded_at: "2026-09-19T12:00:00.000Z" },
      { id: "late-close", timestamp: "2026-09-19T18:00:00.000Z", recorded_at: "2026-09-21T09:05:00.000Z" },
      { id: "new", timestamp: "2026-09-21T10:00:00.000Z", recorded_at: "2026-09-21T10:00:00.000Z" },
    ];
    expect(recordedAfter(events, since).map((e) => e.id)).toEqual(["late-close", "new"]);
  });

  it("excludes an event recorded before the cursor even if stamped after it", () => {
    const events = [{ id: "future-stamped", timestamp: "2026-09-22T00:00:00.000Z", recorded_at: "2026-09-19T00:00:00.000Z" }];
    expect(recordedAfter(events, since)).toEqual([]);
  });
});
