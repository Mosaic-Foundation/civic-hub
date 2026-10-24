// The ai adapter's gate (src/adapters/ai.ts, ADR-012): every caller gets the
// jobs' daily ceiling, the usage record and the usage-limit report, whatever
// the provider. The ledger (src/services/aiBudget.ts) is stubbed; the
// provider is the fake.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  jobTokens: 0,
  limit: 1_000,
  recorded: [] as Array<{ purpose: string; model: string; usage?: unknown; webSearches?: number }>,
  reported: [] as Array<{ code: string; details: Record<string, unknown> }>,
}));

vi.mock("../../src/services/aiBudget.js", () => ({
  JOB_PURPOSES: ["job.meeting_summary", "job.news_sync", "job.deliberation_summary"],
  jobTokensToday: async () => ledger.jobTokens,
  currentAiLimits: () => ({ job_daily_tokens: ledger.limit }),
  recordAiUsage: async (e: (typeof ledger.recorded)[number]) => {
    ledger.recorded.push(e);
  },
}));
vi.mock("../../src/utils/reportError.js", () => ({
  reportError: (code: string, _message: string, details: Record<string, unknown>) => ledger.reported.push({ code, details }),
}));

const { aiComplete, aiConverse, AiJobBudgetError, resetAiGateForTests } = await import("../../src/adapters/ai.js");
const { installAdapters } = await import("../../src/adapters/index.js");
const { fakeAi, FAKE_AI_DOWN, FAKE_AI_USAGE_LIMIT } = await import("../../src/adapters/fakes/ai.js");
const { runWithHub } = await import("../../src/config/hubContext.js");
const { ATHENS_HUB } = await import("../fixtures/hubs/index.js");

const inHub = <T>(fn: () => Promise<T>) => runWithHub(ATHENS_HUB, {}, fn);
const single = (text = "hello") => ({ model: "m", userText: text });

let ai = fakeAi();
beforeEach(() => {
  ai = fakeAi();
  installAdapters({ ai });
  ledger.jobTokens = 0;
  ledger.limit = 1_000;
  ledger.recorded = [];
  ledger.reported = [];
  resetAiGateForTests();
});

describe("the jobs' daily ceiling", () => {
  it("lets a job call through under the ceiling, and records it under its purpose", async () => {
    ledger.jobTokens = 999;
    await inHub(() => aiComplete("job.meeting_summary", single()));
    expect(ai.calls).toHaveLength(1);
    expect(ledger.recorded).toEqual([
      { purpose: "job.meeting_summary", model: "m", usage: { input_tokens: 10, output_tokens: 5 }, webSearches: 0 },
    ]);
  });

  it("pauses job calls at the ceiling: refused before the provider is asked, reported once", async () => {
    ledger.jobTokens = 1_000;
    await expect(inHub(() => aiComplete("job.news_sync", single()))).rejects.toBeInstanceOf(AiJobBudgetError);
    await expect(inHub(() => aiComplete("job.deliberation_summary", single()))).rejects.toMatchObject({
      code: "ai_job_budget_spent",
      status: 429,
    });
    expect(ai.calls).toHaveLength(0);
    expect(ledger.recorded).toHaveLength(0);
    expect(ledger.reported.map((r) => r.code)).toEqual(["ai.job_budget"]);
    expect(ledger.reported[0].details).toMatchObject({ hub: "athens", spent: 1_000, limit: 1_000 });
  });

  it("does not touch residents: an assistant call goes through when the jobs are spent", async () => {
    ledger.jobTokens = 5_000_000;
    const out = await inHub(() =>
      aiConverse("assistant.message", { model: "m", messages: [{ role: "user", content: "hi" }], responseTool: "respond" }),
    );
    expect(out.structured).toMatchObject({ suggestions: [] });
    expect(ledger.recorded.map((r) => r.purpose)).toEqual(["assistant.message"]);
    expect(ledger.reported).toEqual([]);
  });

  it("is per hub, and a job outside any hub is not counted", async () => {
    ledger.jobTokens = 5_000_000;
    await aiComplete("job.meeting_summary", single());
    expect(ai.calls).toHaveLength(1);
  });
});

describe("failures", () => {
  it("answers ai_not_configured when no provider is set up, without asking it", async () => {
    const off = fakeAi({ configured: false });
    installAdapters({ ai: off });
    await expect(inHub(() => aiComplete("job.meeting_summary", single()))).rejects.toMatchObject({ code: "ai_not_configured" });
    expect(off.calls).toHaveLength(0);
  });

  it("reports the provider account's usage limit, for every caller", async () => {
    await expect(inHub(() => aiComplete("job.meeting_summary", single(FAKE_AI_USAGE_LIMIT)))).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    await expect(
      inHub(() => aiConverse("assistant.review", { model: "m", messages: [{ role: "user", content: FAKE_AI_USAGE_LIMIT }] })),
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(ledger.reported.map((r) => r.code)).toEqual(["ai.usage_limit", "ai.usage_limit"]);
    expect(ledger.recorded).toEqual([]);
  });

  it("does not report an ordinary outage", async () => {
    await expect(inHub(() => aiComplete("job.news_sync", single(FAKE_AI_DOWN)))).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(ledger.reported).toEqual([]);
  });
});
