// Conversations: duration-based deadlines anchored at start, and the
// seed-statement passthrough fix. The shared Polis handler is constructed
// with stub deps — initializeState is pure, and "start" only touches the
// adapter's createDeliberation.

import { describe, it, expect } from "vitest";
import { createPolisDeliberationHandler } from "../../src/shared/polis_deliberation/handler.js";
import type { PolisDeliberationState } from "../../src/shared/polis_deliberation/types.js";

function makeHandler(created: Array<Record<string, unknown>> = []) {
  return createPolisDeliberationHandler({
    adapter: {
      async createDeliberation(input: Record<string, unknown>) {
        created.push(input);
        return { conversation_id: "polis_test_1" };
      },
      async closeDeliberation() {},
      async pullClusterState() {
        throw new Error("not used");
      },
    } as never,
    summarize: async () => {
      throw new Error("not used");
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
}

const SIX_WEEKS = 42 * 24 * 60 * 60 * 1000;

describe("deliberation initializeState", () => {
  it("carries duration_ms, seed_statements, and assistant_helped onto state", () => {
    const state = makeHandler().initializeState({
      topic: "T",
      framing: "F",
      duration_ms: SIX_WEEKS,
      seed_statements: ["a", "b"],
      assistant_helped: true,
    }) as unknown as PolisDeliberationState;

    expect(state.duration_ms).toBe(SIX_WEEKS);
    // Regression pin: before 2026-08-28 initializeState DROPPED the seeds,
    // so review-path conversations silently lost them.
    expect(state.seed_statements).toEqual(["a", "b"]);
    expect(state.assistant_helped).toBe(true);
    expect(state.deadline).toBeNull();
  });

  it("defaults the new fields when absent", () => {
    const state = makeHandler().initializeState({
      topic: "T",
      framing: "F",
    }) as unknown as PolisDeliberationState;

    expect(state.duration_ms).toBeNull();
    expect(state.seed_statements).toBeNull();
    expect(state.assistant_helped).toBe(false);
  });
});

describe("deliberation start — deadline anchored at start", () => {
  it("computes deadline = start time + duration_ms", async () => {
    const handler = makeHandler();
    const state = handler.initializeState({
      topic: "T",
      framing: "F",
      duration_ms: SIX_WEEKS,
    });
    const process = { id: "p1", status: "draft", state };

    const before = Date.now();
    await handler.handleAction(process, { type: "start", actor: "u", payload: {} });
    const after = Date.now();

    const s = state as unknown as PolisDeliberationState;
    expect(process.status).toBe("active");
    const deadline = new Date(s.deadline as string).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + SIX_WEEKS);
    expect(deadline).toBeLessThanOrEqual(after + SIX_WEEKS);
  });

  it("an explicit deadline wins over duration_ms", async () => {
    const handler = makeHandler();
    const explicit = new Date(Date.now() + 1000000).toISOString();
    const state = handler.initializeState({
      topic: "T",
      framing: "F",
      deadline: explicit,
      duration_ms: SIX_WEEKS,
    });
    const process = { id: "p1", status: "draft", state };

    await handler.handleAction(process, { type: "start", actor: "u", payload: {} });
    expect((state as unknown as PolisDeliberationState).deadline).toBe(explicit);
  });

  it("passes seed statements through to the Polis adapter", async () => {
    const created: Array<Record<string, unknown>> = [];
    const handler = makeHandler(created);
    const state = handler.initializeState({
      topic: "T",
      framing: "F",
      seed_statements: ["one", "two"],
    });

    await handler.handleAction(
      { id: "p1", status: "draft", state },
      { type: "start", actor: "u", payload: {} },
    );

    expect(created).toHaveLength(1);
    expect(created[0].seed_statements).toEqual(["one", "two"]);
  });
});
