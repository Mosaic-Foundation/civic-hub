import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2c: every job runs once per hub, with that hub's own settings.
 *
 * The digest is due only in the hub's send hour, read in the hub's time zone;
 * a plugin a hub switched off is skipped for that hub and no other; the admin
 * digest goes to each hub's own admins; one hub's failure is its own. The
 * digest and admin digest ran as the migration-default hub until now, so a
 * second hub was never mailed at all.
 *
 * Hubs, settings, users and mail are stubbed; no database is touched.
 */

import { ATHENS_HUB, FLOYD_HUB } from "../fixtures/hubs/index.js";

const SETTINGS: Record<string, Record<string, string>> = {};
const subscribedLookups: string[] = [];
const adminDigestRecipients: Record<string, string[]> = {};

vi.mock("../../src/db/hubs.js", () => ({
  listActiveHubs: async () => [FLOYD_HUB, ATHENS_HUB],
  getHubBySlug: async (slug: string) =>
    ({ floyd: FLOYD_HUB, athens: ATHENS_HUB } as Record<string, unknown>)[slug] ?? null,
}));

vi.mock("../../src/db/hubSettingsStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/db/hubSettingsStore.js")>()),
  fetchHubSettings: async (hubId: string) => SETTINGS[hubId] ?? {},
}));

vi.mock("../../src/modules/civic.auth/index.js", async (orig) => ({
  ...(await orig<typeof import("../../src/modules/civic.auth/index.js")>()),
  listSubscribedUsers: async (hubId: string) => {
    subscribedLookups.push(hubId);
    return [];
  },
}));

vi.mock("../../src/modules/civic.admin_digest/index.js", async () => {
  const { currentHubId } = await import("../../src/config/hubContext.js");
  return {
    runAdminDigest: async (recipients: string[]) => {
      adminDigestRecipients[currentHubId()] = recipients;
      return { total: recipients.length, sent: recipients.length, skipped: 0, failed: 0, empty: false, generated_at: "" };
    },
  };
});

const { jobById } = await import("../../src/jobs/registry.js");
const { JOB_RUNNERS } = await import("../../src/jobs/runners.js");
const { runJobAcrossHubs } = await import("../../src/jobs/runJob.js");

async function run(id: string, now: Date, opts: { force?: boolean; onlyHub?: string | null } = {}) {
  const report = await runJobAcrossHubs(jobById(id)!, JOB_RUNNERS[id], {
    now,
    force: opts.force ?? false,
    onlyHub: opts.onlyHub ?? null,
  });
  if ("error" in report) throw new Error(report.error);
  return report;
}

beforeEach(() => {
  process.env.DIGEST_UNSUBSCRIBE_SECRET = "a-test-secret-of-sixteen-plus";
  delete process.env.DIGEST_ENABLED;
  delete process.env.ADMIN_DIGEST_ENABLED;
  for (const k of Object.keys(SETTINGS)) delete SETTINGS[k];
  for (const k of Object.keys(adminDigestRecipients)) delete adminDigestRecipients[k];
  subscribedLookups.length = 0;
  SETTINGS.floyd = { "people.admin_emails": JSON.stringify(["admin@floyd.example"]) };
  SETTINGS.athens = {
    "people.admin_emails": JSON.stringify(["admin@athens.example"]),
    "plugin.digest.send_hour": "9",
    "identity.timezone": "America/New_York",
  };
});

describe("digest: each hub in its own send hour and time zone", () => {
  it("13:00 UTC in September is Floyd's default hour and Athens's 09:00 EDT: both due", async () => {
    const report = await run("digest", new Date("2026-09-24T13:00:00Z"));
    expect(subscribedLookups).toEqual(["floyd", "athens"]);
    expect(report.hubs.floyd).toMatchObject({ processed_users: 0 });
    expect(report.hubs.athens).toMatchObject({ processed_users: 0 });
  });

  it("an hour later in September, neither is due", async () => {
    const report = await run("digest", new Date("2026-09-24T14:00:00Z"));
    expect(subscribedLookups).toEqual([]);
    expect(report.hubs.athens).toMatchObject({
      skipped: true,
      reason: "not the send hour",
      send_hour: 9,
      time_zone: "America/New_York",
      local_hour: 10,
    });
  });

  it("mails Athens at its 09:00 in winter (14:00 UTC), and not Floyd", async () => {
    const report = await run("digest", new Date("2026-12-01T14:00:00Z"));
    expect(subscribedLookups).toEqual(["athens"]);
    expect(report.hubs.floyd).toMatchObject({ skipped: true, send_hour: 13, time_zone: "UTC", local_hour: 14 });
  });

  it("skips a hub whose digest is off, and only that hub", async () => {
    SETTINGS.floyd["plugin.digest.enabled"] = "false";
    const report = await run("digest", new Date("2026-12-01T13:00:00Z"), { force: true });
    expect(subscribedLookups).toEqual(["athens"]);
    expect(report.hubs.floyd).toEqual({ skipped: true, reason: "plugin.digest.enabled is off" });
  });

  it("force skips the hour check but never the plugin switch", async () => {
    SETTINGS.athens["plugin.digest.enabled"] = "false";
    await run("digest", new Date("2026-12-01T03:00:00Z"), { force: true });
    expect(subscribedLookups).toEqual(["floyd"]);
  });

  it("an unknown time zone reads as UTC rather than failing the hub", async () => {
    SETTINGS.athens["identity.timezone"] = "Mars/Olympus_Mons";
    const report = await run("digest", new Date("2026-12-01T09:00:00Z"));
    expect(subscribedLookups).toEqual(["athens"]);
    expect(report.hubs.floyd).toMatchObject({ skipped: true });
  });
});

describe("admin digest: each hub's own admins", () => {
  it("sends Floyd's queue to Floyd's admins and Athens's to Athens's", async () => {
    const report = await run("admin_digest", new Date());
    expect(report.status).toBe(200);
    expect(adminDigestRecipients).toEqual({
      floyd: ["admin@floyd.example"],
      athens: ["admin@athens.example"],
    });
  });

  it("skips a hub with the admin digest off", async () => {
    SETTINGS.athens["plugin.admin_digest.enabled"] = "false";
    const report = await run("admin_digest", new Date());
    expect(Object.keys(adminDigestRecipients)).toEqual(["floyd"]);
    expect(report.hubs.athens).toMatchObject({ skipped: true });
  });

  it("runs only the named hub", async () => {
    const report = await run("admin_digest", new Date(), { onlyHub: "athens" });
    expect(Object.keys(report.hubs)).toEqual(["athens"]);
  });
});

describe("one hub's failure is its own", () => {
  it("reports the throw for that hub, runs the next, and fails the cron", async () => {
    const report = await runJobAcrossHubs(
      jobById("admin_digest")!,
      async () => {
        const { currentHubId } = await import("../../src/config/hubContext.js");
        if (currentHubId() === "floyd") throw new Error("floyd's source is down");
        return { status: 200, body: { ok: true } };
      },
      { now: new Date(), force: false, onlyHub: null },
    );
    expect(report.status).toBe(500);
    if ("error" in report) throw new Error("unexpected");
    expect(report.hubs).toEqual({ floyd: { error: "floyd's source is down" }, athens: { ok: true } });
  });
});
