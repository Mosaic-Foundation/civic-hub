// Email and job reporting, 2026-10-07 (review #34, #36, M1; docs session #4, #5).
//
// On a demo hub (Athens, seeded `demo`):
//   - approving a brief, and publishing vote results, to an official the
//     mail guard holds back publishes (no 500), records the official as held
//     back with the reason, and tells the admin in plain words;
//   - a vote closes and publishes its results with the Briefs plugin off, and
//     keeps today's behaviour (closed, brief pending) with it on;
//   - the admin digest lists submissions waiting in Process reviews and briefs
//     awaiting approval, and leaves the briefs section out while Briefs is off;
//   - the resident digest, with every resident held back, is "ok", not failed;
//   - the feed-health check ignores archived and deleted processes and still
//     reports a result announced as published whose page is not.
//
// The last two run in-process, in the same mode as the server (as
// leakHarness's digest does). Needs the local stack seeded as in CI and a
// server (CIVIC_API_BASE). The server has no RESEND_API_KEY, so nothing is
// sent anywhere; the in-process digest intercepts its own Resend calls.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, localStack, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const CRON_SECRET = process.env.CIVIC_TEST_CRON_SECRET ?? "ci-only-cron-secret";
const DIGEST_SECRET = process.env.CIVIC_TEST_DIGEST_SECRET?.trim() || "ci-only-digest-unsubscribe-secret";
const LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const LOCAL_PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const run = Date.now();
const OFFICIAL = `official+heldback${run}@county.example`;

let admin = "";
let resident = "";
let savedSettings: { brief_recipient_emails: string[]; officials: Array<Record<string, unknown>> } | null = null;
const insertedProcesses: string[] = [];

function ok(res: { status: number; body: unknown }, status = 200): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}

async function setPlugin(id: string, on: boolean): Promise<void> {
  ok(await call("PUT", "/admin/hub/settings", ATHENS, { section: "plugins", values: { [`plugin.${id}.enabled`]: String(on) } }, admin));
}

async function insertProcess(id: string, type: string, status: string, state: Record<string, unknown>, title = id) {
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id,
      hub_id: "athens",
      type,
      title,
      description: "Inserted by tests/api/heldBackAndQueues.test.ts.",
      jurisdiction: "us-test-athens",
      status,
      state,
      created_by: "user:civic-admin",
    }),
  });
  insertedProcesses.push(id);
}

function pendingBriefState(sourceId: string) {
  return {
    type: "civic.brief",
    source_process_id: sourceId,
    source_process_type: "civic.vote",
    publication_status: "pending",
    generated_at: new Date().toISOString(),
    approved_at: null,
    published_at: null,
    content: {
      title: "Held back brief",
      headline: "Where residents landed",
      summary: "A clear result.",
      sections: [],
      participation_label: null,
      participation_count: 3,
      comments: [],
      admin_notes: "",
    },
    delivered_to: [],
  };
}

async function createActiveVote(title: string): Promise<string> {
  const res = await call(
    "POST",
    "/process",
    ATHENS,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title,
      description: title,
      state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
    },
    admin,
  );
  ok(res, 201);
  const id = (res.body.id ?? res.body.process?.id) as string;
  ok(await call("POST", `/process/${id}/action`, ATHENS, { type: "process.activate", payload: {} }, admin));
  insertedProcesses.push(id);
  return id;
}

async function briefsFor(sourceId: string): Promise<Array<{ id: string }>> {
  return (await localRest(
    `processes?select=id&hub_id=eq.athens&type=eq.civic.brief&state->>source_process_id=eq.${sourceId}`,
  )) as Array<{ id: string }>;
}

beforeAll(async () => {
  admin = await mintSession("athens", "admin+athens@example.test");
  resident = await mintSession("athens", `resident+heldback${run}@example.test`);
  const settings = await call("GET", "/admin/settings", ATHENS, undefined, admin);
  ok(settings);
  savedSettings = { brief_recipient_emails: settings.body.brief_recipient_emails, officials: settings.body.officials };
  // An official, who is also the hub-wide brief recipient: on neither the
  // admin roster nor the allow list, so the demo hub holds mail to them.
  ok(
    await call(
      "PATCH",
      "/admin/settings",
      ATHENS,
      {
        officials: [
          ...savedSettings.officials,
          { email: OFFICIAL, official_type: "board_of_supervisors", official_title: "Chair, Board of Supervisors" },
        ],
        brief_recipient_emails: [...savedSettings.brief_recipient_emails, OFFICIAL],
      },
      admin,
    ),
  );
  const config = (await call("GET", "/hub-config", ATHENS)).body;
  expect(config.mode ?? config.hub?.mode ?? "demo").toBe("demo");
}, 30_000);

afterAll(async () => {
  await setPlugin("brief", true);
  if (savedSettings) await call("PATCH", "/admin/settings", ATHENS, savedSettings, admin);
  for (const id of insertedProcesses.reverse()) {
    await localRest(`process_reviews?process_id=eq.${id}`, { method: "DELETE" }).catch(() => undefined);
    await localRest(`processes?id=eq.${id}`, { method: "DELETE" }).catch(() => undefined);
  }
});

describe("held back is not failed (#34)", () => {
  it("approving a brief addressed to an official publishes it and says who was not emailed", async () => {
    const id = `proc_heldback_brief_${run}`;
    await insertProcess(id, "civic.brief", "active", pendingBriefState(`proc_heldback_src_${run}`));
    ok(
      await call(
        "PATCH",
        `/admin/briefs/${id}`,
        ATHENS,
        { recipients: [{ email: OFFICIAL, label: "Board of Supervisors" }] },
        admin,
      ),
    );

    const res = await call("POST", `/admin/briefs/${id}/approve`, ATHENS, {}, admin);
    ok(res);
    expect(res.body.message).toBe("Published. Not emailed to Board of Supervisors because this hub is in demo mode.");
    expect(res.body.brief.publication_status).toBe("published");
    expect(res.body.brief.delivered_to).toEqual([]);
    expect(res.body.brief.held_back).toEqual([{ email: OFFICIAL, reason: "this hub is in demo mode" }]);

    // Public: published, and no "Sent to" receipt, because nothing was sent.
    const pub = await call("GET", `/brief/${id}`, ATHENS);
    ok(pub);
    expect(pub.body.sent_to).toEqual([]);
    expect(JSON.stringify(pub.body)).not.toContain(OFFICIAL);
  });

  it("publishing vote results to the hub's brief recipients publishes, records them held back, no 500", async () => {
    const vote = await createActiveVote(`Held back vote ${run}`);
    ok(await call("POST", `/process/${vote}/action`, ATHENS, { type: "process.close", payload: {} }, admin));
    const id = `proc_heldback_vr_${run}`;
    await insertProcess(id, "civic.vote_results", "active", {
      type: "civic.vote_results",
      source_process_id: vote,
      publication_status: "pending",
      generated_at: new Date().toISOString(),
      approved_at: null,
      published_at: null,
      content: {
        title: "Held back vote",
        participation_count: 0,
        position_breakdown: [],
        comments: [],
        admin_notes: "",
      },
      delivered_to: [],
    });

    const res = await call("POST", `/admin/vote-results/${id}/approve`, ATHENS, {}, admin);
    ok(res);
    expect(res.body.message).toContain(`Not emailed to ${OFFICIAL} because this hub is in demo mode.`);
    expect(res.body.vote_results.publication_status).toBe("published");
    expect(res.body.vote_results.held_back).toContainEqual({ email: OFFICIAL, reason: "this hub is in demo mode" });
    expect(res.body.vote_results.delivered_to).not.toContain(OFFICIAL);
    // The linked vote finished.
    const [row] = (await localRest(`processes?select=status&id=eq.${vote}`)) as Array<{ status: string }>;
    expect(row.status).toBe("finalized");
  });
});

describe("a vote finishes without the Briefs plugin (docs session #4)", () => {
  it("with Briefs off: close publishes the results and the vote is finalized, no brief", async () => {
    await setPlugin("brief", false);
    try {
      const id = await createActiveVote(`No-brief vote ${run}`);
      ok(await call("POST", `/process/${id}/action`, ATHENS, { type: "process.vote", payload: { option: "Yes" } }, resident));
      const closed = await call("POST", `/process/${id}/action`, ATHENS, { type: "process.close", payload: {} }, admin);
      ok(closed);

      const [row] = (await localRest(`processes?select=status,state&id=eq.${id}`)) as Array<{
        status: string;
        state: { result?: { total_votes: number } };
      }>;
      expect(row.status).toBe("finalized");
      expect(row.state.result?.total_votes).toBe(1);
      const published = (await localRest(
        `events?select=id&process_id=eq.${id}&event_type=eq.civic.process.result_published`,
      )) as unknown[];
      expect(published).toHaveLength(1);
      expect(await briefsFor(id)).toEqual([]);

      const read = await call("GET", `/process/${id}`, ATHENS);
      ok(read);
      expect(read.body.status).toBe("finalized");
    } finally {
      await setPlugin("brief", true);
    }
  });

  it("with Briefs on: close leaves the vote closed with a pending brief, as before", async () => {
    const id = await createActiveVote(`Brief vote ${run}`);
    ok(await call("POST", `/process/${id}/action`, ATHENS, { type: "process.close", payload: {} }, admin));
    const [row] = (await localRest(`processes?select=status&id=eq.${id}`)) as Array<{ status: string }>;
    expect(row.status).toBe("closed");
    const briefs = await briefsFor(id);
    expect(briefs).toHaveLength(1);
    insertedProcesses.push(briefs[0].id);
  });
});

describe("the admin digest covers the queues admins need (docs session #5)", () => {
  async function digest(): Promise<{ counts: Record<string, number> }> {
    const res = await call("GET", "/internal/admin-digest/run?hub=athens&force=true", ATHENS, undefined, CRON_SECRET);
    ok(res);
    return res.body.hubs.athens;
  }

  it("lists pending reviews and briefs awaiting approval; no vote-results section", async () => {
    await setPlugin("admin_digest", true);
    const reviewed = `proc_heldback_review_${run}`;
    await insertProcess(reviewed, "civic.vote", "pending_review", { options: ["Yes", "No"] }, `Review me ${run}`);
    await localRest("process_reviews", {
      method: "POST",
      body: JSON.stringify({
        id: `rev_heldback_${run}`,
        hub_id: "athens",
        process_id: reviewed,
        creator_id: "user_heldback",
        creator_name: "Test Resident",
        creator_email: "resident@example.test",
        status: "pending_review",
      }),
    });
    await insertProcess(`proc_heldback_pending_brief_${run}`, "civic.brief", "active", pendingBriefState(reviewed));

    const on = await digest();
    expect(on.counts.reviews).toBeGreaterThanOrEqual(1);
    expect(on.counts.briefs).toBeGreaterThanOrEqual(1);
    expect(on.counts).not.toHaveProperty("vote_results");

    await setPlugin("brief", false);
    try {
      const off = await digest();
      expect(off.counts.briefs).toBe(0);
      expect(off.counts.reviews).toBe(on.counts.reviews);
    } finally {
      await setPlugin("brief", true);
    }
  });
});

// ---------------------------------------------------------------------------
// In-process, in the same mode as the server.

const resendCalls = vi.hoisted(() => [] as string[]);

async function inProcess() {
  const { url, key } = localStack();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.DIGEST_UNSUBSCRIBE_SECRET = DIGEST_SECRET;
  if (process.env.CIVIC_EXPECT_HUB_DB_MODE?.trim() === "hub_token") {
    process.env.CIVIC_HUB_MINTED_TOKEN = "true";
    process.env.CIVIC_HUB_SIGNING_KEY ??= LOCAL_JWT_SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY ??= LOCAL_PUBLISHABLE_KEY;
  } else {
    process.env.CIVIC_HUB_MINTED_TOKEN = "false";
  }
  const { getHubBySlug } = await import("../../src/db/hubs.js");
  const { fetchHubSettings } = await import("../../src/db/hubSettingsStore.js");
  const { runWithHub } = await import("../../src/config/hubContext.js");
  const hub = (await getHubBySlug("athens"))!;
  const settings = await fetchHubSettings("athens");
  return <T>(fn: () => Promise<T>) => runWithHub(hub, settings, fn);
}

describe("the resident digest with every resident held back (#36)", () => {
  it("counts them as held back, and the job reads ok", async () => {
    // A subscriber who is neither an admin nor on the allow list, due a digest.
    const [me] = (await localRest(
      `users?select=id&hub_id=eq.athens&email=eq.${encodeURIComponent(`resident+heldback${run}@example.test`)}`,
    )) as Array<{ id: string }>;
    await localRest(`users?id=eq.${me.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        digest_frequency_days: 1,
        last_digest_sent_at: null,
        created_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    });

    // A mail key, so the run takes the real send path; Resend itself is
    // intercepted, everything else (the database) goes through.
    process.env.RESEND_API_KEY = "re_test_held_back_only";
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.resend.com/")) {
        resendCalls.push(...(JSON.parse(String(init?.body)).to as string[]));
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      return realFetch(input, init);
    });
    try {
      const within = await inProcess();
      const { runDigestForHub } = await import("../../src/controllers/digestController.js");
      const { describeJobRun } = await import("../../src/jobs/describe.js");
      const outcome = await within(() => runDigestForHub({ now: new Date(), force: true }));
      expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
      expect(outcome.body.failed_count).toBe(0);
      expect(outcome.body.held_back_count).toBeGreaterThanOrEqual(1);
      expect(outcome.body.held_back_reason).toBe("this hub is in demo mode");
      expect(resendCalls).not.toContain(`resident+heldback${run}@example.test`);

      const described = describeJobRun("digest", outcome);
      expect(described?.status).toBe("ok");
      expect(described?.problems).toEqual([]);
      expect(described?.summary).toMatch(/held back from \d+ because this hub is in demo mode/);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.RESEND_API_KEY;
    }
  }, 60_000);
});

describe("feed health (M1)", () => {
  it("ignores archived and deleted processes, and still reports a genuinely broken one", async () => {
    const archived = `proc_heldback_fh_archived_${run}`;
    const deleted = `proc_heldback_fh_deleted_${run}`;
    const broken = `proc_heldback_fh_broken_${run}`;
    const fine = `proc_heldback_fh_fine_${run}`;
    await insertProcess(archived, "civic.meeting_summary", "archived", { approval_status: "published" });
    await insertProcess(deleted, "civic.meeting_summary", "finalized", { approval_status: "published" });
    await insertProcess(broken, "civic.meeting_summary", "finalized", { approval_status: "pending" }, `Broken ${run}`);
    await insertProcess(fine, "civic.meeting_summary", "finalized", { approval_status: "published" });

    const within = await inProcess();
    const { emitEvent } = await import("../../src/events/eventEmitter.js");
    const { findBrokenPublications } = await import("../../src/services/feedHealth.js");
    await within(async () => {
      for (const id of [archived, deleted, broken, fine]) {
        await emitEvent({
          event_type: "civic.process.result_published",
          actor: "system:test",
          process_id: id,
          jurisdiction: "us-test-athens",
          processType: "civic.meeting_summary",
          data: {},
        });
      }
    });
    await localRest(`processes?id=eq.${deleted}`, { method: "DELETE" });

    const found = (await within(() => findBrokenPublications())).filter((b) =>
      [archived, deleted, broken, fine].includes(b.process_id),
    );
    expect(found).toEqual([
      expect.objectContaining({
        process_id: broken,
        process_type: "civic.meeting_summary",
        title: `Broken ${run}`,
        reason: 'its approval is "pending", so its page shows "not found"',
      }),
    ]);
  }, 30_000);
});
