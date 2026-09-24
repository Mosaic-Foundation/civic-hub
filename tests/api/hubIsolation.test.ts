// An Athens session cannot read a Floyd process, vote, receipt or user by id
// (Phase 2a acceptance).
//
// Everything Floyd-side is created through Floyd's own API as Floyd's admin —
// a real vote, activated and voted on — so the rows are exactly what the app
// writes. Then the same ids are tried from Athens. Each "refused" has a
// positive control on Floyd, because "always 404" is also what a broken read
// path looks like.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE). Admin
// and resident sessions are written by tests/fixtures/adminSession.ts, which
// refuses any database that is not on this machine. node:http rather than
// fetch, because the hostname is the variable under test.

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession, mintSessionForUser } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const FLOYD = "floyd.civic.social";
/** On Floyd's roster: CI seeds people.admin_emails from CIVIC_ADMIN_EMAILS. */
const FLOYD_ADMIN = "admin@example.test";

const run = Date.now();
let floydAdmin = "";
let athensResident = "";
let floydProcessId = "";
let floydReceipt = "";
let floydAdminUserId = "";
const OPTIONS = ["Yes", "No"];

async function participationRows(processId: string): Promise<number> {
  const rows = (await localRest(
    `vote_participation?select=user_id&process_id=eq.${encodeURIComponent(processId)}`,
  )) as unknown[];
  return rows.length;
}

beforeAll(async () => {
  floydAdmin = await mintSession("floyd", FLOYD_ADMIN);
  athensResident = await mintSession("athens", `resident-iso-${run}@example.test`);

  const created = await call(
    "POST",
    "/process",
    FLOYD,
    {
      definition: { type: "civic.vote", version: "0.1" },
      title: `Isolation vote ${run}`,
      description: "A Floyd vote that Athens must not reach.",
      state: {
        options: OPTIONS,
        voting_duration_ms: 24 * 60 * 60 * 1000,
        activation_mode: "direct",
      },
    },
    floydAdmin,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  floydProcessId = created.body.id ?? created.body.process?.id;
  expect(floydProcessId).toBeTruthy();

  const activated = await call(
    "POST",
    `/process/${floydProcessId}/action`,
    FLOYD,
    { type: "process.activate", payload: {} },
    floydAdmin,
  );
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);

  const voted = await call(
    "POST",
    `/process/${floydProcessId}/action`,
    FLOYD,
    { type: "process.vote", payload: { option: "Yes" } },
    floydAdmin,
  );
  expect(voted.status, JSON.stringify(voted.body)).toBe(200);
  floydReceipt = voted.body.result?.receipt_id ?? voted.body.receipt_id;
  expect(floydReceipt, JSON.stringify(voted.body)).toBeTruthy();

  const [admin] = (await localRest(
    `users?select=id&hub_id=eq.floyd&email=eq.${encodeURIComponent(FLOYD_ADMIN)}`,
  )) as Array<{ id: string }>;
  floydAdminUserId = admin.id;
});

describe("an Athens session cannot read a Floyd process", () => {
  it("by id", async () => {
    const control = await call("GET", `/process/${floydProcessId}`, FLOYD, undefined, floydAdmin);
    expect(control.status).toBe(200);
    const res = await call("GET", `/process/${floydProcessId}`, ATHENS, undefined, athensResident);
    expect(res.status).toBe(404);
  });

  it("by its state read model", async () => {
    const control = await call("GET", `/process/${floydProcessId}/state`, FLOYD, undefined, floydAdmin);
    expect(control.status).toBe(200);
    const res = await call("GET", `/process/${floydProcessId}/state`, ATHENS, undefined, athensResident);
    expect(res.status).toBe(404);
  });

  it("in the process list or the event feed", async () => {
    const list = await call("GET", "/process", ATHENS, undefined, athensResident);
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).map((p) => p.id)).not.toContain(floydProcessId);

    const feed = await call("GET", "/events?limit=100", ATHENS, undefined, athensResident);
    expect(feed.status).toBe(200);
    const events = (feed.body.events ?? feed.body.orderedItems ?? feed.body) as unknown[];
    expect(JSON.stringify(events)).not.toContain(floydProcessId);
  });
});

describe("an Athens session cannot vote on, or read the votes of, a Floyd process", () => {
  it("cannot cast a ballot on it", async () => {
    const before = await participationRows(floydProcessId);
    const res = await call(
      "POST",
      `/process/${floydProcessId}/action`,
      ATHENS,
      { type: "process.vote", payload: { option: "No" } },
      athensResident,
    );
    expect(res.status).toBe(404);
    expect(await participationRows(floydProcessId)).toBe(before);
  });

  it("cannot read its vote log", async () => {
    const control = await call("GET", `/votes/${floydProcessId}/log`, FLOYD, undefined, floydAdmin);
    expect(control.status).not.toBe(404);
    const res = await call("GET", `/votes/${floydProcessId}/log`, ATHENS, undefined, athensResident);
    expect(res.status).toBe(404);
  });
});

describe("an Athens session cannot verify a Floyd receipt", () => {
  it("by receipt id", async () => {
    const control = await call(
      "GET",
      `/votes/${floydProcessId}/verify?receipt=${floydReceipt}`,
      FLOYD,
      undefined,
      floydAdmin,
    );
    expect(control.status).toBe(200);
    const res = await call(
      "GET",
      `/votes/${floydProcessId}/verify?receipt=${floydReceipt}`,
      ATHENS,
      undefined,
      athensResident,
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Yes");
  });
});

describe("an Athens session cannot read a Floyd user", () => {
  it("a Floyd session presented to Athens is nobody", async () => {
    const control = await call("GET", "/auth/me", FLOYD, undefined, floydAdmin);
    expect(control.status).toBe(200);
    expect(control.body.user?.email ?? control.body.email).toBe(FLOYD_ADMIN);
    const res = await call("GET", "/auth/me", ATHENS, undefined, floydAdmin);
    expect(res.status).toBe(401);
  });

  it("an Athens session row naming a Floyd user id cannot be written", async () => {
    // Phase 2a made such a row authenticate nobody; since 2b's composite
    // foreign keys the database refuses to hold it at all.
    await expect(mintSessionForUser("athens", floydAdminUserId)).rejects.toThrow(/"23503"/);
  });
});
