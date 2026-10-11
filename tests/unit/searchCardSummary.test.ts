// A search card's summary never reads admin-only text (audit A2, 2026-10-11).
// It used to fall back to `state.content.admin_notes` when a hit had no
// description.

import { describe, it, expect } from "vitest";
import { formatHit } from "../../src/modules/civic.search/index.js";

const row = (state: Record<string, unknown>, description = "") => ({
  id: "proc_1",
  type: "civic.brief",
  title: "A brief",
  description,
  status: "active",
  state,
  created_at: "2026-10-11T00:00:00Z",
  rank: 1,
});

describe("search card summary", () => {
  it("does not fall back to admin notes", () => {
    const hit = formatHit(row({ content: { admin_notes: "Internal: call the clerk first" } }));
    expect(hit.description).toBe("");
  });

  it("still uses the description, then a public body", () => {
    expect(formatHit(row({}, "The **public** summary")).description).toBe("The public summary");
    expect(formatHit(row({ content: { body: "Announcement body" } })).description).toBe("Announcement body");
  });

  it("never carries state to the client", () => {
    expect(Object.keys(formatHit(row({ secret: 1 })))).not.toContain("state");
  });
});
