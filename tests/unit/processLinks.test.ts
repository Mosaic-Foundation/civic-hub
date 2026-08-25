import { describe, it, expect } from "vitest";
import {
  LinkValidationError,
  MAX_LINKS_PER_PROCESS,
  RELATION_LABELS,
  RELATIONS,
  renderLinks,
  suggestionSeed,
  validateLink,
  validateLinkSet,
} from "../../src/modules/civic.process_links/index.js";
import { isPubliclyFetchable } from "../../src/services/processLifecycle.js";
import type {
  LinkPeer,
  ProcessLinkEdge,
} from "../../src/modules/civic.process_links/index.js";

// --- helpers ---------------------------------------------------------------

function edge(over: Partial<ProcessLinkEdge> = {}): ProcessLinkEdge {
  return {
    id: "plink_1",
    from_id: "proc_a",
    to_id: "proc_b",
    relation: "continues",
    created_by: "user_1",
    created_at: "2026-08-25T10:00:00.000Z",
    ...over,
  };
}

function peer(id: string, over: Partial<LinkPeer> = {}): LinkPeer {
  return {
    id,
    type: "civic.vote",
    title: `Title ${id}`,
    status: "active",
    href: `/process/${id}`,
    ...over,
  };
}

function peerMap(...peers: LinkPeer[]): Map<string, LinkPeer> {
  return new Map(peers.map((p) => [p.id, p]));
}

// --- edge storage ----------------------------------------------------------

describe("edge storage — validation", () => {
  it("accepts every relation in the vocabulary", () => {
    for (const relation of RELATIONS) {
      expect(validateLink("proc_a", { to_id: "proc_b", relation })).toEqual({
        to_id: "proc_b",
        relation,
      });
    }
  });

  it("rejects a relation outside the vocabulary", () => {
    expect(() => validateLink("proc_a", { to_id: "proc_b", relation: "supersedes" }))
      .toThrow(LinkValidationError);
    try {
      validateLink("proc_a", { to_id: "proc_b", relation: "supersedes" });
    } catch (err) {
      expect((err as LinkValidationError).code).toBe("unknown_relation");
    }
  });

  it("rejects a self-link", () => {
    try {
      validateLink("proc_a", { to_id: "proc_a", relation: "references" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LinkValidationError);
      expect((err as LinkValidationError).code).toBe("self_link");
    }
  });

  it("rejects a missing or blank target", () => {
    for (const to_id of [undefined, "", "   ", null]) {
      expect(() => validateLink("proc_a", { to_id, relation: "references" }))
        .toThrow(LinkValidationError);
    }
  });

  it("trims whitespace around the target id", () => {
    expect(validateLink("proc_a", { to_id: "  proc_b  ", relation: "references" }))
      .toEqual({ to_id: "proc_b", relation: "references" });
  });
});

describe("edge storage — the edge is stored exactly ONCE", () => {
  it("collapses a duplicate assertion instead of storing it twice", () => {
    const set = validateLinkSet("proc_a", [
      { to_id: "proc_b", relation: "continues" },
      { to_id: "proc_b", relation: "continues" },
    ]);
    expect(set).toHaveLength(1);
  });

  it("keeps two DIFFERENT relations to the same target as separate edges", () => {
    const set = validateLinkSet("proc_a", [
      { to_id: "proc_b", relation: "continues" },
      { to_id: "proc_b", relation: "references" },
    ]);
    expect(set).toHaveLength(2);
  });

  it("never produces an inverse row — the backlink is derived, not stored", () => {
    const set = validateLinkSet("proc_a", [{ to_id: "proc_b", relation: "continues" }]);
    expect(set).toEqual([{ to_id: "proc_b", relation: "continues" }]);
    // Nothing in the validated set points back from B to A.
    expect(set.some((l) => l.to_id === "proc_a")).toBe(false);
  });

  it("treats an absent link list as no links", () => {
    expect(validateLinkSet("proc_a", undefined)).toEqual([]);
    expect(validateLinkSet("proc_a", null)).toEqual([]);
    expect(validateLinkSet("proc_a", [])).toEqual([]);
  });

  it("rejects a non-array link list", () => {
    expect(() => validateLinkSet("proc_a", "proc_b")).toThrow(LinkValidationError);
  });

  it("caps the number of links on one process", () => {
    const many = Array.from({ length: MAX_LINKS_PER_PROCESS + 1 }, (_, i) => ({
      to_id: `proc_${i}`,
      relation: "references" as const,
    }));
    try {
      validateLinkSet("proc_a", many);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LinkValidationError).code).toBe("too_many");
    }
  });
});

// --- both-direction render -------------------------------------------------

describe("both-direction render — one stored edge, two renderings", () => {
  const stored = edge({ from_id: "proc_a", to_id: "proc_b", relation: "continues" });

  it("renders as OUTGOING with the forward label on the authoring process", () => {
    const out = renderLinks("proc_a", [stored], peerMap(peer("proc_b")));
    expect(out.outgoing).toHaveLength(1);
    expect(out.incoming).toHaveLength(0);
    expect(out.outgoing[0]?.direction).toBe("outgoing");
    expect(out.outgoing[0]?.label).toBe(RELATION_LABELS.continues.forward);
    expect(out.outgoing[0]?.peer.id).toBe("proc_b");
  });

  it("renders THE SAME edge as INCOMING with the back label on the target", () => {
    const out = renderLinks("proc_b", [stored], peerMap(peer("proc_a")));
    expect(out.incoming).toHaveLength(1);
    expect(out.outgoing).toHaveLength(0);
    expect(out.incoming[0]?.direction).toBe("incoming");
    expect(out.incoming[0]?.label).toBe(RELATION_LABELS.continues.back);
    expect(out.incoming[0]?.peer.id).toBe("proc_a");
  });

  it("gives both ends the SAME link id — proving one row backs both views", () => {
    const fromA = renderLinks("proc_a", [stored], peerMap(peer("proc_b")));
    const fromB = renderLinks("proc_b", [stored], peerMap(peer("proc_a")));
    expect(fromA.outgoing[0]?.id).toBe(fromB.incoming[0]?.id);
    expect(fromA.outgoing[0]?.relation).toBe(fromB.incoming[0]?.relation);
  });

  it("uses the right inverse label for every relation in the vocabulary", () => {
    for (const relation of RELATIONS) {
      const e = edge({ relation });
      expect(renderLinks("proc_a", [e], peerMap(peer("proc_b"))).outgoing[0]?.label)
        .toBe(RELATION_LABELS[relation].forward);
      expect(renderLinks("proc_b", [e], peerMap(peer("proc_a"))).incoming[0]?.label)
        .toBe(RELATION_LABELS[relation].back);
    }
  });

  it("renders a process that has both a forward link and a backlink", () => {
    const authored = edge({ id: "l1", from_id: "proc_b", to_id: "proc_c", relation: "implements" });
    const received = edge({ id: "l2", from_id: "proc_a", to_id: "proc_b", relation: "continues" });
    const out = renderLinks("proc_b", [authored, received], peerMap(peer("proc_a"), peer("proc_c")));
    expect(out.outgoing.map((l) => l.peer.id)).toEqual(["proc_c"]);
    expect(out.incoming.map((l) => l.peer.id)).toEqual(["proc_a"]);
  });

  it("renders nothing for a process with no edges", () => {
    expect(renderLinks("proc_z", [], new Map())).toEqual({ outgoing: [], incoming: [] });
  });

  it("drops an edge whose peer was withheld (non-public or removed)", () => {
    // An empty peer map is how the caller signals "you may not see this one".
    const out = renderLinks("proc_a", [stored], new Map());
    expect(out).toEqual({ outgoing: [], incoming: [] });
  });

  it("ignores an edge that touches neither end of this process", () => {
    const unrelated = edge({ from_id: "proc_x", to_id: "proc_y" });
    const out = renderLinks("proc_a", [unrelated], peerMap(peer("proc_x"), peer("proc_y")));
    expect(out).toEqual({ outgoing: [], incoming: [] });
  });

  it("refuses to double-render a self-link that somehow slipped past the schema", () => {
    const self = edge({ from_id: "proc_a", to_id: "proc_a" });
    const out = renderLinks("proc_a", [self], peerMap(peer("proc_a")));
    expect(out.outgoing).toHaveLength(0);
    expect(out.incoming).toHaveLength(0);
  });

  it("carries the peer's route through so link cards point at the real page", () => {
    const out = renderLinks(
      "proc_a",
      [stored],
      peerMap(peer("proc_b", { type: "civic.project", href: "/project/proc_b" })),
    );
    expect(out.outgoing[0]?.peer.href).toBe("/project/proc_b");
  });

  it("orders each direction newest-first", () => {
    const older = edge({ id: "l1", to_id: "proc_b", created_at: "2026-08-01T00:00:00.000Z" });
    const newer = edge({ id: "l2", to_id: "proc_c", created_at: "2026-08-20T00:00:00.000Z" });
    const out = renderLinks("proc_a", [older, newer], peerMap(peer("proc_b"), peer("proc_c")));
    expect(out.outgoing.map((l) => l.id)).toEqual(["l2", "l1"]);
  });
});

// --- visibility ------------------------------------------------------------

describe("visibility inheritance", () => {
  // Pinned against the CANONICAL helper in processLifecycle.ts. The linking
  // module deliberately owns no status list of its own.
  it("treats a pending_review process as not publicly linkable", () => {
    // This is what keeps a resident's proposed links private until an admin
    // approves the submission.
    expect(isPubliclyFetchable("pending_review")).toBe(false);
  });

  it("hides archived processes too", () => {
    expect(isPubliclyFetchable("archived")).toBe(false);
  });

  it("shows live and completed processes", () => {
    for (const status of ["active", "closed", "finalized", "proposed", "threshold_met"]) {
      expect(isPubliclyFetchable(status)).toBe(true);
    }
  });
});

// --- auto-suggestion seed --------------------------------------------------

describe("suggestionSeed", () => {
  /** The terms the seed actually asks Postgres to match. */
  const terms = (seed: string) => seed.split(" OR ").filter((t) => t.length > 0);

  it("keeps the distinctive words and drops stopwords", () => {
    const seed = suggestionSeed("Should the county extend the Jacksonville trail?");
    expect(terms(seed)).toContain("extend");
    expect(terms(seed)).toContain("jacksonville");
    expect(terms(seed)).toContain("trail");
    expect(terms(seed)).not.toContain("the");
    expect(terms(seed)).not.toContain("county");
  });

  /**
   * REGRESSION — websearch_to_tsquery ANDs bare space-separated terms, so a
   * multi-word seed joined by spaces demands every word co-occur and matches
   * essentially nothing. The auto-suggestion feature shipped dead because of
   * exactly that, and was caught only by a smoke test against a real
   * database. This pins the OR.
   */
  it("joins terms with explicit OR, not bare spaces", () => {
    const seed = suggestionSeed("Add recycling to the new green box dumpster sites");
    expect(seed).toContain(" OR ");
    expect(terms(seed).length).toBeGreaterThan(1);
    // No term may itself contain a space — that would be an AND in disguise.
    for (const t of terms(seed)) expect(t).not.toContain(" ");
  });

  it("does not emit a dangling OR for a single-term seed", () => {
    const seed = suggestionSeed("Jacksonville");
    expect(seed).toBe("jacksonville");
    expect(seed).not.toContain("OR");
  });

  it("deduplicates repeated words", () => {
    const seed = suggestionSeed("Trail trail trail extension");
    expect(terms(seed).filter((w) => w === "trail")).toHaveLength(1);
  });

  it("caps the seed so one long description can't become the whole query", () => {
    const seed = suggestionSeed("alpha bravo charlie delta echo foxtrot golf hotel india");
    expect(terms(seed).length).toBeLessThanOrEqual(6);
  });

  it("returns empty for input with nothing distinctive in it", () => {
    expect(suggestionSeed("the and of to")).toBe("");
    expect(suggestionSeed("")).toBe("");
  });
});
