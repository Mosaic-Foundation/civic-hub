import { describe, it, expect } from "vitest";
import {
  assembleDigestForUser,
  isDigestRenderable,
  classifyItemKind,
} from "../../src/modules/civic.digest/index.js";
import type {
  DigestEvent,
  DigestAssemblyInput,
} from "../../src/modules/civic.digest/index.js";

function ev(
  event_type: string,
  data: Record<string, unknown> = {},
  overrides: Partial<DigestEvent> = {},
): DigestEvent {
  return {
    id: `evt_${Math.round((data.__i as number) ?? 0)}`,
    event_type,
    timestamp: "2026-06-26T10:00:00.000Z",
    process_id: "proc_1",
    action_url: "https://hub.example/process/proc_1",
    data,
    ...overrides,
  };
}

const HUB = {
  hub_name: "Floyd Civic Hub",
  ui_base_url: "https://hub.example",
  postal_address: "Floyd, VA",
  unsubscribe_url: "https://hub.example/u",
  manage_subscriptions_url: "https://hub.example/settings",
};

function assemble(events: DigestEvent[], titles: Record<string, string> = {}) {
  const input: DigestAssemblyInput = {
    user: { id: "u1", email: "u@e.com", created_at: "2026-01-01T00:00:00Z", last_digest_sent_at: null },
    events,
    hub: HUB,
    since: "2026-06-01T00:00:00Z",
    process_titles: titles,
  };
  return assembleDigestForUser(input);
}

describe("digest ↔ feed parity (Phase 3)", () => {
  it("wordcloud started is no longer mislabeled as a vote", () => {
    // Before Phase 3, filter.ts returned 'vote_opened' for every started event.
    expect(
      classifyItemKind(ev("civic.process.started", { process: { type: "civic.wordcloud" } })),
    ).toBe("wordcloud");
    expect(
      classifyItemKind(ev("civic.process.started", { process: { type: "civic.vote" } })),
    ).toBe("vote-open");
  });

  it("includes proposals, projects, and conversations (were absent from the digest)", () => {
    expect(isDigestRenderable(ev("civic.proposal.submitted", { proposal: { title: "T" } }))).toBe(true);
    expect(isDigestRenderable(ev("civic.project.created", { project: { title: "P" } }))).toBe(true);
    expect(
      isDigestRenderable(ev("civic.process.created", { process: { type: "civic.polis_deliberation", title: "C" } })),
    ).toBe(true);
  });

  /**
   * PARITY IS THE POINT HERE. The digest does not classify anything itself —
   * filter.ts delegates to the same classifyActivity the web feed uses — so
   * silencing the proposal-closed feed card on 2026-08-26 dropped it from the
   * digest in the same commit, with no digest code touched. This test failing
   * was how that was confirmed rather than assumed.
   */
  it("drops proposal-closed from the digest in lockstep with the feed", () => {
    expect(classifyItemKind(ev("civic.proposal.closed", { proposal: {} }))).toBeNull();
    expect(isDigestRenderable(ev("civic.proposal.closed", { proposal: {} }))).toBe(false);
  });

  it("still includes conversation results", () => {
    expect(
      classifyItemKind(ev("civic.outcome_delivered", { originating_process_id: "proc_x" })),
    ).toBe("conversation-results");
  });

  it("still excludes non-feed-worthy events from the digest", () => {
    expect(isDigestRenderable(ev("civic.process.comment_added", { process: { type: "civic.vote" } }))).toBe(false);
    expect(isDigestRenderable(ev("civic.process.created", { process: { type: "civic.vote" } }))).toBe(false);
    expect(isDigestRenderable(ev("civic.review.submitted"))).toBe(false);
    // Raw vote close stays out — vote-results covers it (no double item).
    expect(isDigestRenderable(ev("civic.process.result_published", { result: { total_votes: 3 } }))).toBe(false);
  });

  it("assembles an email spanning all the new sections with correct links + pills", () => {
    const events = [
      ev("civic.process.started", { process: { type: "civic.vote" } }, { id: "e1", process_id: "vote_1" }),
      ev("civic.process.started", { process: { type: "civic.wordcloud" } }, { id: "e2", process_id: "wc_1" }),
      ev("civic.proposal.submitted", { proposal: { title: "Bike lanes" } }, { id: "e3", process_id: "prop_1" }),
      ev("civic.project.created", { project: { title: "Trail cleanup" } }, { id: "e4", process_id: "proj_1" }),
      ev("civic.process.created", { process: { type: "civic.polis_deliberation", title: "Zoning chat" } }, { id: "e5", process_id: "conv_1" }),
      ev("civic.outcome_delivered", { originating_process_id: "conv_1" }, { id: "e6", process_id: "conv_1" }),
    ];
    const digest = assemble(events, { vote_1: "Park funding" });
    expect(digest).not.toBeNull();
    expect(digest!.item_count).toBe(6);

    // Wordcloud links to its dedicated page (was /process/:id before), absolutized.
    expect(digest!.text).toContain("https://hub.example/wordcloud/wc_1");
    // Proposal + conversation custom pages, absolutized against the hub UI base.
    expect(digest!.text).toContain("https://hub.example/proposal/prop_1");
    expect(digest!.text).toContain("https://hub.example/deliberation/conv_1");

    // Section headers + pills present for the formerly-absent types.
    expect(digest!.html).toContain("Proposals");
    expect(digest!.html).toContain("Projects");
    expect(digest!.html).toContain("Conversations");
    expect(digest!.html).toContain("New proposal");
    expect(digest!.html).toContain("Word cloud");
    expect(digest!.html).toContain("Bike lanes");
    expect(digest!.html).toContain("Park funding"); // vote title via process_titles map
  });

  it("returns null when nothing is feed-worthy", () => {
    expect(assemble([ev("civic.process.comment_added"), ev("civic.review.approved")])).toBeNull();
  });
});
