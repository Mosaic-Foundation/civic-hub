import { describe, it, expect } from "vitest";
import type { BriefResponseRecord } from "../../src/modules/civic.brief/responses.js";
import {
  FEED_ANCHOR_WINDOW_MS,
  RESPONSE_BODY_MAX,
  isFeedAnchor,
  normalizeResponseBody,
  respondGate,
  responseExcerpt,
  responseStatus,
  toPublicResponses,
} from "../../src/modules/civic.brief/responses.js";

const OFFICIAL = { type: "board_of_supervisors", title: "Board of Supervisors" };

function state(publication_status: "pending" | "approved" | "published") {
  return { publication_status };
}

function record(over: Partial<BriefResponseRecord> = {}): BriefResponseRecord {
  return {
    id: "bresp_1",
    brief_id: "proc_brief_1",
    responder_id: "user_1",
    official_type: "board_of_supervisors",
    official_title: "Board of Supervisors",
    body: "Thank you for this brief.",
    feed_anchor: true,
    created_at: "2026-08-27T12:00:00.000Z",
    ...over,
  };
}

// --- The gate ---------------------------------------------------------------

describe("respondGate — who may respond, and when", () => {
  it("allows an official on a published brief", () => {
    expect(respondGate(OFFICIAL, state("published"))).toBeNull();
  });

  it("rejects a non-official (resident or plain admin) with 403, even on a published brief", () => {
    const verdict = respondGate(null, state("published"));
    expect(verdict?.status).toBe(403);
    expect(verdict?.error).toMatch(/official role/);
  });

  it("rejects a missing brief with 404, official or not", () => {
    expect(respondGate(OFFICIAL, null)?.status).toBe(404);
    // Non-official + missing brief: the role check comes first, so no
    // probe can distinguish "brief exists" from "you can't" — 403 wins.
    expect(respondGate(null, null)?.status).toBe(403);
  });

  it("rejects unpublished briefs with 409 — the public cannot be responded to about a record it cannot see", () => {
    expect(respondGate(OFFICIAL, state("pending"))?.status).toBe(409);
    expect(respondGate(OFFICIAL, state("approved"))?.status).toBe(409);
  });
});

// --- Body validation --------------------------------------------------------

describe("normalizeResponseBody", () => {
  it("trims and returns a valid body", () => {
    expect(normalizeResponseBody("  We hear you.  ")).toBe("We hear you.");
  });

  it("rejects empty and whitespace-only bodies", () => {
    expect(() => normalizeResponseBody("")).toThrow(/empty/);
    expect(() => normalizeResponseBody("   \n  ")).toThrow(/empty/);
    expect(() => normalizeResponseBody(undefined)).toThrow(/empty/);
    expect(() => normalizeResponseBody(42)).toThrow(/empty/);
  });

  it("accepts exactly the max and rejects one past it", () => {
    expect(normalizeResponseBody("x".repeat(RESPONSE_BODY_MAX))).toHaveLength(
      RESPONSE_BODY_MAX,
    );
    expect(() =>
      normalizeResponseBody("x".repeat(RESPONSE_BODY_MAX + 1)),
    ).toThrow(/5000/);
  });
});

// --- Status derivation ------------------------------------------------------

describe("responseStatus — awaiting → responded", () => {
  it("is awaiting with no responses", () => {
    expect(responseStatus([])).toEqual({
      status: "awaiting",
      responded_at: null,
      response_count: 0,
    });
  });

  it("flips to responded on the first response", () => {
    const s = responseStatus([record()]);
    expect(s.status).toBe("responded");
    expect(s.responded_at).toBe("2026-08-27T12:00:00.000Z");
    expect(s.response_count).toBe(1);
  });

  it("anchors responded_at to the EARLIEST response regardless of input order", () => {
    const s = responseStatus([
      record({ created_at: "2026-08-29T09:00:00.000Z" }),
      record({ created_at: "2026-08-27T12:00:00.000Z" }),
      record({ created_at: "2026-08-28T15:00:00.000Z" }),
    ]);
    expect(s.status).toBe("responded");
    // A follow-up never moves the date the status line renders.
    expect(s.responded_at).toBe("2026-08-27T12:00:00.000Z");
    expect(s.response_count).toBe(3);
  });
});

// --- Feed anchor window -----------------------------------------------------

describe("isFeedAnchor — at most one feed card per brief per 24h", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");

  it("anchors the first response to a brief", () => {
    expect(isFeedAnchor(null, now)).toBe(true);
  });

  it("suppresses a response within 24h of the last anchor", () => {
    expect(isFeedAnchor("2026-08-28T11:00:00.000Z", now)).toBe(false);
    expect(isFeedAnchor("2026-08-27T12:00:00.001Z", now)).toBe(false);
  });

  it("anchors again at and past the 24h boundary", () => {
    expect(isFeedAnchor("2026-08-27T12:00:00.000Z", now)).toBe(true);
    expect(isFeedAnchor("2026-08-26T12:00:00.000Z", now)).toBe(true);
  });

  it("fails open on an unparseable stored timestamp", () => {
    // A corrupt anchor row must not mute the feed forever.
    expect(isFeedAnchor("not-a-date", now)).toBe(true);
  });

  it("window constant is 24 hours", () => {
    expect(FEED_ANCHOR_WINDOW_MS).toBe(86_400_000);
  });
});

// --- Public projection ------------------------------------------------------

describe("toPublicResponses", () => {
  it("sorts oldest first and never exposes the responder's account id", () => {
    const out = toPublicResponses(
      [
        record({ id: "b2", created_at: "2026-08-29T09:00:00.000Z" }),
        record({ id: "b1", created_at: "2026-08-27T12:00:00.000Z" }),
      ],
      () => "Dana Supervisor",
    );
    expect(out.map((r) => r.id)).toEqual(["b1", "b2"]);
    for (const r of out) {
      expect(r).not.toHaveProperty("responder_id");
      expect(r).not.toHaveProperty("feed_anchor");
      expect(r.responder_name).toBe("Dana Supervisor");
    }
  });

  it("carries the office snapshot from the row, not from any live lookup", () => {
    const out = toPublicResponses(
      [record({ official_title: "Supervisor, District 3" })],
      () => "Dana",
    );
    expect(out[0]!.official_title).toBe("Supervisor, District 3");
    expect(out[0]!.official_type).toBe("board_of_supervisors");
  });
});

// --- Feed excerpt -----------------------------------------------------------

describe("responseExcerpt", () => {
  it("passes short bodies through with whitespace collapsed", () => {
    expect(responseExcerpt("Thank  you\n\nall.")).toBe("Thank you all.");
  });

  it("truncates long bodies to the cap with an ellipsis", () => {
    const out = responseExcerpt("word ".repeat(100));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });
});
