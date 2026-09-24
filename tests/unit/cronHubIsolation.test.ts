import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One cron pass, two hubs: each reads its own sources and nobody else's.
 *
 * The resolver tests (newsSync.test.ts, meetingSummaryHubConfig.test.ts) prove
 * a hub's configuration is its own. This proves the CRON uses it that way end
 * to end: the handler enters each hub's scope in turn, fetches only that hub's
 * feed and meetings page, stamps that hub's jurisdiction and author on what it
 * creates, and sends a failure alert to that hub's admins — not Floyd's, which
 * before 2026-09-24 was where every one of those values came from.
 *
 * Network, database, model and mail are stubbed; nothing leaves the process.
 */

import {
  ATHENS_HUB,
  ATHENS_MEETINGS_URL,
  ATHENS_NEWS_FEED_URL,
  ATHENS_SETTINGS,
  FLOYD_HUB,
  FLOYD_MEETINGS_URL,
  FLOYD_NEWS_FEED_URL,
  FLOYD_SETTINGS,
  PLUGIN_ENV_FALLBACKS,
} from "../fixtures/hubs/index.js";
import { wixBlogFeed } from "../fixtures/hubs/wix-blog-feed.js";

const ATHENS_ADMIN = "admin@athens.example";
const FLOYD_ADMIN = "admin@floyd.example";

const SETTINGS: Record<string, Record<string, string>> = {
  floyd: { ...FLOYD_SETTINGS, "people.admin_emails": JSON.stringify([FLOYD_ADMIN]) },
  athens: { ...ATHENS_SETTINGS, "people.admin_emails": JSON.stringify([ATHENS_ADMIN]) },
};

const fetched: string[] = [];
const created: Array<Record<string, unknown>> = [];
const mail: Array<{ to: string | string[]; subject: string }> = [];

vi.mock("../../src/db/hubs.js", () => ({
  listActiveHubs: async () => [FLOYD_HUB, ATHENS_HUB],
  getHubBySlug: async (slug: string) =>
    ({ floyd: FLOYD_HUB, athens: ATHENS_HUB } as Record<string, unknown>)[slug] ?? null,
}));

vi.mock("../../src/db/hubSettingsStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/hubSettingsStore.js")>()),
  fetchHubSettings: async (hubId: string) => SETTINGS[hubId] ?? {},
}));

vi.mock("../../src/utils/http.js", () => {
  const record = (url: string) => {
    fetched.push(url);
  };
  return {
    fetchXml: async (url: string) => {
      record(url);
      return wixBlogFeed(new URL(url).origin);
    },
    // Every meeting source is unreachable here, so discovery comes back empty
    // and the run raises its "found no meetings" alert — which is what lets
    // this test see who the alert goes to.
    fetchHtml: async (url: string) => {
      record(url);
      throw new Error("stubbed: no network");
    },
    fetchJson: async (url: string) => {
      record(url);
      throw new Error("stubbed: no network");
    },
    fetchPdf: async () => {
      throw new Error("stubbed: no network");
    },
  };
});

vi.mock("../../src/utils/email.js", () => ({
  sendEmail: async (input: { to: string | string[]; subject: string }) => {
    mail.push({ to: input.to, subject: input.subject });
    return { ok: true };
  },
}));

vi.mock("../../src/utils/anthropic.js", () => ({
  DEFAULT_MODEL: "stub-model",
  callClaude: async () => ({ text: "A stub paraphrase.", model: "stub-model" }),
}));

vi.mock("../../src/services/processService.js", () => ({
  getAllProcesses: async () => [],
  getProcess: async () => null,
  archiveProcess: async () => undefined,
  saveProcessState: async () => undefined,
  createProcess: async (input: Record<string, unknown>) => {
    created.push(input);
    return {
      ...input,
      id: `proc_${created.length}`,
      hubId: "civic-hub-local",
      jurisdiction: input.jurisdiction ?? "local",
      status: "active",
    };
  },
}));

vi.mock("../../src/events/eventEmitter.js", () => ({
  emitEvent: async () => ({}),
}));

vi.mock("../../src/services/feedHealth.js", () => ({
  findBrokenPublications: async () => [],
}));

const { handleRunNewsSync } = await import("../../src/controllers/newsSyncController.js");
const { handleRunMeetingSummary } = await import("../../src/controllers/meetingSummaryController.js");

function cronRequest(query: Record<string, string> = {}) {
  return {
    headers: { authorization: "Bearer test-cron-secret" },
    query,
  } as unknown as import("express").Request;
}

function capture() {
  const out: { status: number; body: unknown } = { status: 0, body: null };
  const res = {
    status(code: number) {
      out.status = code;
      return { json: (body: unknown) => (out.body = body) };
    },
  } as unknown as import("express").Response;
  return { res, out };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.ANTHROPIC_API_KEY = "stub-key";
  for (const name of PLUGIN_ENV_FALLBACKS) delete process.env[name];
  fetched.length = 0;
  created.length = 0;
  mail.length = 0;
});

describe("news sync — one pass, each hub its own feed", () => {
  it("fetches each hub's feed once, and files each post under its own hub", async () => {
    const { res, out } = capture();
    await handleRunNewsSync(cronRequest(), res);

    expect(out.status).toBe(200);
    expect(fetched).toEqual([FLOYD_NEWS_FEED_URL, ATHENS_NEWS_FEED_URL]);

    const athens = created.filter((c) =>
      String((c.state as { source?: { share_url?: string } }).source?.share_url).includes("athens.example"),
    );
    const floyd = created.filter((c) =>
      String((c.state as { source?: { share_url?: string } }).source?.share_url).includes("floydcova.gov"),
    );
    expect(athens).toHaveLength(2);
    expect(floyd).toHaveLength(2);

    for (const c of athens) {
      expect(c.jurisdiction).toBe("us-va-athens");
      expect((c.state as { author_role: string }).author_role).toBe("Town of Athens Government");
      expect(JSON.stringify(c)).not.toMatch(/floyd/i);
    }
    for (const c of floyd) {
      expect(c.jurisdiction).toBe("us-va-floyd");
      expect((c.state as { author_role: string }).author_role).toBe("Floyd County Government");
    }
  });

  it("runs only the named hub with ?hub=", async () => {
    const { res, out } = capture();
    await handleRunNewsSync(cronRequest({ hub: "athens" }), res);
    expect(out.status).toBe(200);
    expect(fetched).toEqual([ATHENS_NEWS_FEED_URL]);
    expect(Object.keys((out.body as { hubs: object }).hubs)).toEqual(["athens"]);
  });
});

describe("meeting summaries — one pass, each hub its own source and admins", () => {
  it("reads only Athens's page for Athens, and alerts Athens's admins alone", async () => {
    const { res } = capture();
    await handleRunMeetingSummary(cronRequest({ hub: "athens" }), res);
    await new Promise((r) => setTimeout(r, 0)); // the alert is sent after the response

    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(url.startsWith(new URL(ATHENS_MEETINGS_URL).origin)).toBe(true);
    }
    expect(fetched.join()).not.toMatch(/floyd/i);

    expect(mail).toHaveLength(1);
    expect([mail[0].to].flat()).toEqual([ATHENS_ADMIN]);
  });

  it("gives each hub its own run in a full pass", async () => {
    const { res, out } = capture();
    await handleRunMeetingSummary(cronRequest(), res);
    await new Promise((r) => setTimeout(r, 0));

    const floydFetches = fetched.filter((u) => u.startsWith(new URL(FLOYD_MEETINGS_URL).origin));
    const athensFetches = fetched.filter((u) => u.startsWith(new URL(ATHENS_MEETINGS_URL).origin));
    expect(floydFetches.length).toBeGreaterThan(0);
    expect(athensFetches.length).toBeGreaterThan(0);
    expect(Object.keys((out.body as { hubs: object }).hubs).sort()).toEqual(["athens", "floyd"]);

    const recipients = mail.map((m) => [m.to].flat().join(","));
    expect(recipients.sort()).toEqual([ATHENS_ADMIN, FLOYD_ADMIN].sort());
  });
});
