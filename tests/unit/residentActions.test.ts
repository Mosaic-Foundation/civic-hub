// Residents can only call resident actions (audit A3, 2026-10-11). Since
// 2026-10-12 the list is each type's descriptor (callers include "resident").
//
// POST /process/:id/action is open to residents, and admin-only actions used
// to be a four-item denylist in the controller: a resident could call the
// Polis handler's start, close, poll_state and regenerate_summary (close a
// live conversation, restart it, loop paid summaries). Now every handler
// declares the actions residents may call, and executeAction refuses the
// rest for a resident caller. These tests pin each type's list; the API test
// (tests/api/residentActions.test.ts) proves the refusal end to end.

import { describe, it, expect } from "vitest";
import { getRegisteredTypes, residentActionsOf } from "../../src/processes/registry.js";
import { createPolisDeliberationHandler } from "../../src/shared/polis_deliberation/handler.js";

/** What each type opens to residents. A new type must be added here on purpose. */
const EXPECTED: Record<string, string[]> = {
  "civic.vote": ["process.support", "process.unsupport", "process.vote"],
  "civic.wordcloud": ["process.submit"],
  // Proposals and projects moved onto the shared action path (2026-10-12):
  // support and sentiment are resident actions now, as votes' are.
  "civic.proposal": ["process.support", "process.unsupport"],
  "civic.project": ["process.sentiment"],
  "civic.vote_results": [],
  "civic.brief": [],
  "civic.announcement": [],
  "civic.meeting_summary": [],
  "civic.polis_deliberation": [],
};

/** Lifecycle control and paid work: never a resident's, on any type. */
const NEVER_RESIDENT = [
  "process.activate",
  "process.close",
  "process.propose",
  "process.snapshot",
  "process.complete",
  "start",
  "close",
  "poll_state",
  "regenerate_summary",
];

describe("each handler declares its resident actions", () => {
  it("covers every registered type, and no more", () => {
    expect(getRegisteredTypes().sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [type, actions] of Object.entries(EXPECTED)) {
    it(`${type}: ${actions.length ? actions.join(", ") : "none"}`, () => {
      expect(residentActionsOf(type).sort()).toEqual([...actions].sort());
    });
  }

  it("no type opens a lifecycle action to residents", () => {
    for (const type of getRegisteredTypes()) {
      const open = residentActionsOf(type);
      for (const action of NEVER_RESIDENT) expect(open).not.toContain(action);
    }
  });
});

describe("a conversation's actions each run from one status", () => {
  const calls: string[] = [];
  const handler = createPolisDeliberationHandler({
    adapter: {
      async createDeliberation() {
        calls.push("create");
        return { conversation_id: "polis_test_2" };
      },
      async closeDeliberation() {
        calls.push("close");
      },
      async pullClusterState() {
        calls.push("pull");
        return { math_tick: 1, participant_count: 0, groups: [], consensus: { agree: [], disagree: [] } };
      },
    } as never,
    summarize: async () => {
      calls.push("summarize");
      return { summary_text: "s" } as never;
    },
    host: {
      async emitEvent() {},
      generateId: (p?: string) => `${p ?? "id"}_test`,
      async writeOutcomeDelivery() {
        return { id: "o", delivery_timestamp: new Date().toISOString() };
      },
      async getResponseById() {
        return null;
      },
    },
    polisBaseUrl: "https://polis.example",
  });
  const run = (type: string, status: string) =>
    handler.handleAction(
      { id: "p1", status, state: handler.initializeState({ topic: "t", framing: "f" }) },
      { type, actor: "user:a", payload: {} },
    );

  it("start only from draft: a second start would orphan the first conversation", async () => {
    calls.length = 0;
    for (const status of ["active", "closed"]) {
      await expect(run("start", status)).rejects.toThrow(/Cannot start/);
    }
    expect(calls).toEqual([]);
    await expect(run("start", "draft")).resolves.toBeDefined();
    expect(calls).toEqual(["create"]);
  });

  it("close and poll_state only while active", async () => {
    calls.length = 0;
    await expect(run("close", "draft")).rejects.toThrow(/Cannot close/);
    await expect(run("close", "closed")).rejects.toThrow(/Cannot close/);
    await expect(run("poll_state", "closed")).rejects.toThrow(/Cannot poll_state/);
    expect(calls).toEqual([]);
  });

  it("regenerate_summary only once closed: no paid summary for a live conversation", async () => {
    calls.length = 0;
    await expect(run("regenerate_summary", "active")).rejects.toThrow(/Cannot regenerate_summary/);
    expect(calls).toEqual([]);
    await expect(run("regenerate_summary", "closed")).resolves.toBeDefined();
    expect(calls).toEqual(["summarize"]);
  });
});
