import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { consoleCall, mintConsoleSession } from "../fixtures/consoleCall.js";
import { COC_FLAG } from "../fixtures/codeOfConduct.js";

/**
 * The admin digest's rule (leaving-demo slice, 2026-10-15), run through the
 * real job on a fresh beta hub: each email counts only what is new since the
 * last one, never an item twice; "waiting" sits beside it but never sends;
 * nothing goes out when nothing is new; flagged items are counted on their
 * own line. Reads the job's per-hub result (`counts`, `empty`), which is what
 * the email is rendered from (renderAdminDigestEmail, tests/unit/
 * adminFeedbackDigest.test.ts for the body).
 *
 * Needs the server's CRON_SECRET (CIVIC_TEST_CRON_SECRET, as pluginToggles),
 * CIVIC_COC_FAKE=on, and no RESEND_API_KEY (keyless "sends" count as
 * delivered, so the mark moves).
 */

const CRON = process.env.CIVIC_TEST_CRON_SECRET?.trim() || "ci-only-cron-secret";
const run = Date.now().toString(36);
const HUB = `adt-${run}`;
const HOST = `${HUB}.localhost`;
const ADMIN = `adt-admin-${run}@example.test`;

let admin = "";
let resident = "";

type Counts = Record<string, { new: number; waiting: number | null; flagged: number }>;

async function digest(): Promise<{ empty: boolean; counts: Counts; since: string; until: string; already_covered?: boolean }> {
  const res = await call("GET", `/internal/admin-digest/run?hub=${HUB}`, HOST, undefined, CRON);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.hubs[HUB];
}

async function submitProposal(title: string, description: string, extra: Record<string, unknown> = {}): Promise<void> {
  const draft = await call("POST", "/proposals/drafts", HOST, { category: "idea" }, resident);
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  await call("PATCH", `/proposals/drafts/${draft.body.id}`, HOST, { title, description }, resident);
  const sub = await call("POST", `/proposals/drafts/${draft.body.id}/submit`, HOST, extra, resident);
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  expect(sub.body.auto_approved).toBe(false);
}

beforeAll(async () => {
  const cookie = await mintConsoleSession();
  const res = await consoleCall("POST", "/control/hubs", {
    cookie,
    body: { slug: HUB, name: `Digest Tally ${run}`, hostname: HOST, admin_email: ADMIN, hub_kind: "organization", mode: "beta" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  admin = await mintSession(HUB, ADMIN);
  resident = await mintSession(HUB, `adt-resident-${run}@example.test`);
});

describe("the admin digest counts what is new since the last one", () => {
  it("a hub with nothing new sends nothing, and sets its mark", async () => {
    const first = await digest();
    expect(first.empty).toBe(true);
    const [mark] = (await localRest(`admin_digest_marks?hub_id=eq.${HUB}&select=covered_until`)) as Array<{ covered_until: string }>;
    expect(Date.parse(mark.covered_until)).toBe(Date.parse(first.until));
  });

  it("counts each new item once, with what is waiting", async () => {
    await submitProposal(`A resident's idea ${run}`, "An ordinary submission.");
    const fb = await call("POST", "/feedback", HOST, { category: "idea", message: `More benches, please (${run}).` }, resident);
    expect(fb.status, JSON.stringify(fb.body)).toBeLessThan(300);
    const wait = await call("POST", "/waitlist", HOST, { email: `adt-wait-${run}@example.test` });
    expect(wait.status, JSON.stringify(wait.body)).toBe(200);

    const d = await digest();
    expect(d.empty).toBe(false);
    expect(d.counts.reviews).toEqual({ new: 1, waiting: 1, flagged: 0 });
    expect(d.counts.feedback.new).toBe(1);
    expect(d.counts.waitlist).toMatchObject({ new: 1, waiting: 1 });
    expect(d.counts.edits.new).toBe(0);
  });

  it("never counts the same item again: the next run has nothing new and sends nothing, whatever is waiting", async () => {
    const d = await digest();
    expect(d.empty).toBe(true);
    expect(d.counts.reviews).toEqual({ new: 0, waiting: 1, flagged: 0 });
    expect(d.counts.feedback.new).toBe(0);
    expect(d.counts.waitlist).toMatchObject({ new: 0, waiting: 1 });
  });

  it("counts a submission the check flagged on its own line", async () => {
    await submitProposal(`A flagged idea ${run}`, `Something the check flags. ${COC_FLAG}`, { tell_admins: true });
    const d = await digest();
    expect(d.empty).toBe(false);
    expect(d.counts.reviews).toEqual({ new: 1, waiting: 2, flagged: 1 });
  });

  it("picks up what arrived while a run was missed", async () => {
    // Two items, then one run: both are new in it, and neither in the next.
    const fb1 = await call("POST", "/feedback", HOST, { category: "bug", message: `First (${run}).` }, resident);
    const fb2 = await call("POST", "/feedback", HOST, { category: "bug", message: `Second (${run}).` }, resident);
    expect(fb1.status).toBeLessThan(300);
    expect(fb2.status).toBeLessThan(300);
    expect((await digest()).counts.feedback.new).toBe(2);
    expect((await digest()).counts.feedback.new).toBe(0);
  });

  it("leaves out a switched-off plugin's line", async () => {
    const off = await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values: { "plugin.feedback.enabled": "false" } }, admin);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const d = await digest();
    expect(d.counts.feedback).toBeUndefined();
    await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values: { "plugin.feedback.enabled": "true" } }, admin);
  });
});
