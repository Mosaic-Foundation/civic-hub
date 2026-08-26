import { describe, it, expect } from "vitest";
import {
  availableSourceTypes,
  availableYears,
  filterIndex,
  toIndexEntry,
  type BriefIndexEntry,
} from "../../src/modules/civic.brief/index.js";
import type { BriefProcessState } from "../../src/modules/civic.brief/index.js";

function state(over: Partial<BriefProcessState> = {}): BriefProcessState {
  return {
    type: "civic.brief",
    source_process_id: "proc_src",
    source_process_type: "civic.vote",
    publication_status: "published",
    generated_at: "2026-03-01T00:00:00.000Z",
    approved_at: "2026-03-02T00:00:00.000Z",
    published_at: "2026-03-14T12:00:00.000Z",
    delivered_to: [],
    content: {
      title: "A vote",
      headline: "The community has voted",
      summary: "",
      sections: [],
      comments: [],
      admin_notes: "",
      participation_label: "42 votes cast",
      participation_count: 42,
      image_url: null,
      image_alt: null,
    },
    ...over,
  } as BriefProcessState;
}

function entry(over: Partial<BriefIndexEntry> = {}): BriefIndexEntry {
  return {
    id: "b1",
    title: "A vote",
    source_process_id: "proc_src",
    source_process_type: "civic.vote",
    headline: "The community has voted",
    participation_label: "42 votes cast",
    published_at: "2026-03-14T12:00:00.000Z",
    related_count: 0,
    ...over,
  };
}

describe("toIndexEntry — only published outcomes reach the index", () => {
  /**
   * The publication gate lives in this projection, not in the caller's query.
   * A pending brief is an admin's draft of a public record; it must not become
   * reachable because someone later writes a query without thinking about it.
   */
  it("returns null for a pending brief", () => {
    expect(toIndexEntry(state({ publication_status: "pending" }), { id: "b1", title: "x" })).toBeNull();
  });

  it("returns null for approved-but-not-published", () => {
    expect(toIndexEntry(state({ publication_status: "approved" }), { id: "b1", title: "x" })).toBeNull();
  });

  it("returns null when published_at is missing, however the status reads", () => {
    // A row claiming "published" with no timestamp is corrupt; the index sorts
    // and buckets by date, so admitting it would poison both.
    expect(toIndexEntry(state({ published_at: null }), { id: "b1", title: "x" })).toBeNull();
  });

  it("projects a published brief", () => {
    const e = toIndexEntry(state(), { id: "b1", title: "A vote" }, 3);
    expect(e).not.toBeNull();
    expect(e!.id).toBe("b1");
    expect(e!.source_process_type).toBe("civic.vote");
    expect(e!.related_count).toBe(3);
  });

  it("carries no section, comment or admin-note payload — an index is not the thing", () => {
    const e = toIndexEntry(state(), { id: "b1", title: "A vote" })!;
    expect(e).not.toHaveProperty("sections");
    expect(e).not.toHaveProperty("comments");
    expect(e).not.toHaveProperty("admin_notes");
  });
});

describe("filterIndex", () => {
  const all = [
    entry({ id: "a", source_process_type: "civic.proposal", published_at: "2026-08-26T00:00:00.000Z" }),
    entry({ id: "b", source_process_type: "civic.vote", published_at: "2026-03-14T00:00:00.000Z" }),
    entry({ id: "c", source_process_type: "civic.polis_deliberation", published_at: "2025-11-02T00:00:00.000Z" }),
  ];

  it("returns everything, newest first, with no filters", () => {
    expect(filterIndex(all).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts oldest first on request", () => {
    expect(filterIndex(all, { sort: "oldest" }).map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("filters by a single source type", () => {
    expect(filterIndex(all, { sourceTypes: ["civic.vote"] }).map((e) => e.id)).toEqual(["b"]);
  });

  it("treats multiple source types as OR", () => {
    const ids = filterIndex(all, { sourceTypes: ["civic.vote", "civic.proposal"] }).map((e) => e.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("filters by year", () => {
    expect(filterIndex(all, { year: 2025 }).map((e) => e.id)).toEqual(["c"]);
  });

  it("combines type and year", () => {
    expect(filterIndex(all, { sourceTypes: ["civic.vote"], year: 2026 }).map((e) => e.id)).toEqual(["b"]);
    expect(filterIndex(all, { sourceTypes: ["civic.vote"], year: 2025 })).toEqual([]);
  });

  it("treats an empty type list as no filter, not as 'match nothing'", () => {
    // The UI sends [] when every chip is off, which means "show everything".
    expect(filterIndex(all, { sourceTypes: [] })).toHaveLength(3);
  });

  it("returns empty for a year with no outcomes, without throwing", () => {
    expect(filterIndex(all, { year: 1999 })).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...all];
    filterIndex(input, { sort: "oldest" });
    expect(input.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("filter options are derived from what exists, not hardcoded", () => {
  const all = [
    entry({ source_process_type: "civic.vote", published_at: "2026-03-14T00:00:00.000Z" }),
    entry({ source_process_type: "civic.proposal", published_at: "2026-08-26T00:00:00.000Z" }),
    entry({ source_process_type: "civic.vote", published_at: "2025-01-05T00:00:00.000Z" }),
  ];

  it("lists each source type once", () => {
    expect(availableSourceTypes(all)).toEqual(["civic.proposal", "civic.vote"]);
  });

  /**
   * A process type registered in the future must appear in the filters the
   * first time one of its briefs publishes — with no change here. That is why
   * the options are derived rather than enumerated.
   */
  it("includes a process type nobody has heard of yet", () => {
    const withNew = [...all, entry({ source_process_type: "civic.participatory_budget" })];
    expect(availableSourceTypes(withNew)).toContain("civic.participatory_budget");
  });

  it("lists years newest first, deduplicated", () => {
    expect(availableYears(all)).toEqual([2026, 2025]);
  });

  it("handles an empty index", () => {
    expect(availableSourceTypes([])).toEqual([]);
    expect(availableYears([])).toEqual([]);
  });
});
