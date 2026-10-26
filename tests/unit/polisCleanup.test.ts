// The Polis findings (the cleanup slice, 2026-10-16):
//   - a close that loses a race makes no Polis call and no paid summary;
//   - the Polis address is the hub's own setting, read per call;
//   - a Polis outage answers 503, not the generic 500.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolisDeliberationHandler } from "../../packages/civic.polis_deliberation/handler.js";
import type { PolisDeliberationState } from "../../packages/civic.polis_deliberation/types.js";

const created: string[] = [];
vi.mock("../../packages/civic.polis_deliberation/adapter/polisAdapter.js", () => ({
  createPolisAdapter: (cfg: { baseUrl: string }) => ({
    async createDeliberation() {
      created.push(cfg.baseUrl);
      return { conversation_id: "c1" };
    },
    async closeDeliberation() {},
    async pullClusterState() {
      const err = new Error("Polis API 502: /api/v3/math/pca2") as Error & { status: number };
      err.status = 502;
      throw err;
    },
    async getStatements() {
      const err = new Error("Polis API 409: /api/v3/comments") as Error & { status: number };
      err.status = 409;
      throw err;
    },
    async submitStatement() {
      throw new Error("Polis API timeout: /api/v3/comments");
    },
    async recordVote() {},
    async getNextStatement() {
      return null;
    },
  }),
}));

function closeHandler(calls: string[], queued: Array<() => Promise<void>>, withHooks: boolean) {
  return createPolisDeliberationHandler({
    adapter: {
      async closeDeliberation() {
        calls.push("polis.close");
      },
    } as never,
    summarize: async () => {
      calls.push("summarize");
      return { participation_stats: null } as never;
    },
    host: {
      async emitEvent() {},
      generateId: (p?: string) => `${p ?? "id"}_t`,
      async writeOutcomeDelivery() {
        return { id: "o", delivery_timestamp: new Date().toISOString() };
      },
      async getResponseById() {
        return null;
      },
    },
    polisBaseUrl: "https://polis.example",
    ...(withHooks
      ? {
          afterCommit: async (fn: () => Promise<void>) => {
            queued.push(fn);
          },
          summarizeLater: async () => {
            calls.push("summarizeLater");
          },
        }
      : {}),
  });
}

function activeConversation() {
  return {
    id: "proc_1",
    status: "active",
    state: { polis_conversation_id: "c1", topic: "T", summary: null, summary_status: "pending" } as unknown as PolisDeliberationState,
  };
}

describe("a conversation's close", () => {
  it("calls Polis and summarizes only after its write has won", async () => {
    const calls: string[] = [];
    const queued: Array<() => Promise<void>> = [];
    const proc = activeConversation();
    await closeHandler(calls, queued, true).handleAction(proc as never, { type: "close", actor: "system", payload: {} } as never);
    expect(proc.status).toBe("closed");
    expect((proc.state as unknown as PolisDeliberationState).summary_status).toBe("generating");
    // A close that lost its race never has its after-commit work run: nothing went out.
    expect(calls).toEqual([]);
    // The winner's does: Polis first, then the summary through the action path.
    for (const fn of queued) await fn();
    expect(calls).toEqual(["polis.close", "summarizeLater"]);
  });

  it("without the host's hooks, closes and summarizes inline as before", async () => {
    const calls: string[] = [];
    const proc = activeConversation();
    await closeHandler(calls, [], false).handleAction(proc as never, { type: "close", actor: "system", payload: {} } as never);
    expect(calls).toEqual(["polis.close", "summarize"]);
    expect((proc.state as unknown as PolisDeliberationState).summary_status).toBe("complete");
  });
});

describe("the hub's Polis", () => {
  beforeEach(() => {
    created.length = 0;
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("is the hub's own setting, read for the hub in scope on each call", async () => {
    // The real deliberation service (the suite's default is the fake Polis,
    // whose address is fixed); its adapter is mocked above.
    const { installAdapters } = await import("../../src/adapters/index.js");
    const { polisService } = await import("../../src/hosting/polis.js");
    installAdapters({ deliberation: polisService });
    // Through the registry, whose first use loads the packages and boots it
    // (importing the boot file first is a cycle).
    (await import("../../src/processes/registry.js")).getAllHandlers();
    const { getPolisAdapter } = await import("../../packages/civic.polis_deliberation/boot.js");
    const { withHubScope } = await import("../../src/config/hubContext.js");
    const hub = (id: string) => ({ id, name: id }) as never;
    await withHubScope(hub("a"), { "plugin.conversation.polis_url": "https://polis.a.example" }, () =>
      getPolisAdapter().createDeliberation({ topic: "t", description: "d" } as never),
    );
    await withHubScope(hub("b"), { "plugin.conversation.polis_url": "https://polis.b.example" }, () =>
      getPolisAdapter().createDeliberation({ topic: "t", description: "d" } as never),
    );
    await withHubScope(hub("c"), {}, () => getPolisAdapter().createDeliberation({ topic: "t", description: "d" } as never));
    expect(created[0]).toBe("https://polis.a.example");
    expect(created[1]).toBe("https://polis.b.example");
    expect(created[2]).toMatch(/^https:\/\//);
    expect(created[2]).not.toMatch(/polis\.(a|b)\.example/);
  });

  it("down, slow or failing answers 503; a refusal stays what it was", async () => {
    (await import("../../src/processes/registry.js")).getAllHandlers();
    const { getPolisAdapter, PolisUnavailableError } = await import("../../packages/civic.polis_deliberation/boot.js");
    const { withHubScope } = await import("../../src/config/hubContext.js");
    await withHubScope({ id: "a", name: "a" } as never, {}, async () => {
      const a = getPolisAdapter();
      await expect(a.pullClusterState("c1")).rejects.toBeInstanceOf(PolisUnavailableError);
      await expect(a.pullClusterState("c1")).rejects.toMatchObject({ status: 503, code: "polis_unavailable" });
      await expect(a.submitStatement("c1", "xid", "a statement")).rejects.toBeInstanceOf(PolisUnavailableError);
      await expect(a.getStatements("c1")).rejects.toMatchObject({ status: 409 });
    });
  });
});
