// Heartbeats (operations shell): each scheduled job pings Healthchecks.io
// when it finishes, /fail when it failed, and only on the scheduled run for
// every hub. The network is a fake throughout.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const runJobAcrossHubs = vi.fn();
vi.mock("../../src/jobs/runJob.js", () => ({ runJobAcrossHubs: (...a: unknown[]) => runJobAcrossHubs(...a) }));

const { heartbeatSlug, heartbeatUrl, pingHeartbeat } = await import("../../src/utils/heartbeat.js");
const { jobRouter } = await import("../../src/routes/jobRoutes.js");
const { JOBS } = await import("../../src/jobs/registry.js");

const KEY = "ping-key-for-tests";
const pings: string[] = [];

beforeEach(() => {
  pings.length = 0;
  vi.stubEnv("CIVIC_HEARTBEAT_PING_KEY", KEY);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("CIVIC_ERROR_DSN", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      pings.push(String(url));
      return new Response("OK", { status: 200 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  runJobAcrossHubs.mockReset();
});

/** Call the job's route the way Vercel Cron does, and wait for its answer. */
async function runCron(path: string, query: Record<string, string> = {}): Promise<number> {
  const layer = (jobRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === path)!;
  let status = 0;
  const res = {
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
    setHeader() {},
    end() {},
  } as unknown as Response;
  const req = { headers: { authorization: "Bearer cron-secret" }, query, method: "GET", route: { path }, baseUrl: "" } as unknown as Request;
  await layer.route!.stack[0].handle(req, res, () => undefined);
  return status;
}

const hubJob = JOBS.find((j) => j.id === "vote_close")!;

describe("the ping", () => {
  it("goes to hc-ping.com/<key>/<job slug>, with /fail for a failed run", () => {
    expect(heartbeatSlug("admin_digest")).toBe("admin-digest");
    expect(heartbeatUrl("vote_close", true)).toBe(`https://hc-ping.com/${KEY}/vote-close`);
    expect(heartbeatUrl("vote_close", false)).toBe(`https://hc-ping.com/${KEY}/vote-close/fail`);
  });

  it("is off without a ping key", async () => {
    vi.stubEnv("CIVIC_HEARTBEAT_PING_KEY", "");
    await pingHeartbeat("vote_close", true);
    expect(pings).toEqual([]);
  });

  it("never throws when Healthchecks.io is down, and never logs the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(pingHeartbeat("vote_close", true)).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(KEY);
  });

  it("every job in the registry has a distinct slug", () => {
    const slugs = JOBS.map((j) => heartbeatSlug(j.id));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("a scheduled run", () => {
  it("pings success when every hub ran", async () => {
    runJobAcrossHubs.mockResolvedValue({ status: 200, hubs: [] });
    expect(await runCron(hubJob.path)).toBe(200);
    expect(pings).toEqual([`https://hc-ping.com/${KEY}/vote-close`]);
  });

  it("pings /fail when any hub failed", async () => {
    runJobAcrossHubs.mockResolvedValue({ status: 500, hubs: [] });
    expect(await runCron(hubJob.path)).toBe(500);
    expect(pings).toEqual([`https://hc-ping.com/${KEY}/vote-close/fail`]);
  });

  it("pings /fail when the run threw", async () => {
    runJobAcrossHubs.mockRejectedValue(new Error("database gone"));
    expect(await runCron(hubJob.path)).toBe(500);
    expect(pings).toEqual([`https://hc-ping.com/${KEY}/vote-close/fail`]);
  });

  it("does not ping for a run of one hub by hand (?hub=)", async () => {
    runJobAcrossHubs.mockResolvedValue({ status: 200, hubs: [] });
    expect(await runCron(hubJob.path, { hub: "athens" })).toBe(200);
    expect(pings).toEqual([]);
  });

  it("does not ping when the cron credential is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "another");
    expect(await runCron(hubJob.path)).toBe(401);
    expect(pings).toEqual([]);
  });
});
