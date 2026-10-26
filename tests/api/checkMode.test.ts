// The receipt check's two modes (Actions slice, 2026-10-13, Adam).
//
// With everything public after close (the vote log and the check's answer),
// a receipt code reveals its ballot's choice on a "show the choice" vote,
// and nothing about it on a "counted only" vote. Before close, the check
// says only that the vote is still open. A vote's mode comes from its draft
// (the hub's default unless the creator picks the other), shows in the
// review queue, and is fixed from approval on.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { localRest } from "../fixtures/adminSession.js";
import { act, admin, BETA, resident } from "../../kit/conformance/src/driver.js";
import { FAKE_COC_DOWN } from "../../src/debug/fakeCodeOfConduct.js";

// Option labels no title or code contains, so a hit can only be a choice.
const PICK = `Zebracorn${Date.now().toString(36)}`;
const OTHER = `Quokkafish${Date.now().toString(36)}`;

async function voteIn(mode: "show_choice" | "counted_only" | undefined): Promise<{ id: string; receipt: string }> {
  const token = await admin(BETA);
  const made = await call("POST", "/process", BETA.host, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Check mode ${mode ?? "unset"} ${Date.now()}`,
    description: "A vote for the check-mode test.",
    state: { method: "approval", options: [PICK, OTHER], activation_mode: "direct", ...(mode ? { check_mode: mode } : {}) },
  }, token);
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const id = made.body.id as string;
  expect((await act(BETA, id, "process.activate", {}, token)).status).toBe(200);
  const voted = await act(BETA, id, "process.vote", { selections: [PICK] }, (await resident(BETA)).token);
  expect(voted.status, JSON.stringify(voted.body)).toBe(200);
  return { id, receipt: voted.body.result.receipt_id as string };
}

const verify = (id: string, receipt: string) => call("POST", `/votes/${id}/verify`, BETA.host, { receipt });
const log = (id: string) => call("GET", `/votes/${id}/log`, BETA.host);
const close = async (id: string) =>
  expect((await act(BETA, id, "process.close", { note: "Closed for the check-mode test." }, await admin(BETA))).status).toBe(200);

describe("before the vote closes", () => {
  it("the check says only that the vote is still open, in either mode", async () => {
    for (const mode of ["show_choice", "counted_only"] as const) {
      const { id, receipt } = await voteIn(mode);
      const res = await verify(id, receipt);
      expect(res.body.found).toBe(false);
      expect(res.body.message).toMatch(/after voting ends/);
      expect(JSON.stringify(res.body)).not.toContain(PICK);
      expect((await log(id)).body.available).toBe(false);
    }
  });
});

describe("after it closes", () => {
  it("show the choice: the code and the log say how that ballot was cast", async () => {
    const { id, receipt } = await voteIn("show_choice");
    await close(id);
    const res = await verify(id, receipt);
    expect(res.body).toMatchObject({ found: true, receipt_id: receipt, check_mode: "show_choice" });
    expect(res.body.choice).toContain(PICK);
    const entry = (await log(id)).body.log.find((e: { receipt_id: string }) => e.receipt_id === receipt);
    expect(entry.choice).toContain(PICK);
  });

  it("counted only: the code and the log say it was counted, and nothing about the choice", async () => {
    const { id, receipt } = await voteIn("counted_only");
    await close(id);
    const res = await verify(id, receipt);
    expect(res.body).toMatchObject({ found: true, receipt_id: receipt, check_mode: "counted_only" });
    expect(res.body).not.toHaveProperty("choice");
    const page = (await log(id)).body;
    expect(page.check_mode).toBe("counted_only");
    expect(page.log.some((e: { receipt_id: string }) => e.receipt_id === receipt)).toBe(true);
    for (const body of [res.body, page]) {
      expect(JSON.stringify(body)).not.toContain(PICK);
      expect(JSON.stringify(body)).not.toContain(OTHER);
    }
  });

  it("a vote made before modes shows the choice, as its log always did", async () => {
    const { id, receipt } = await voteIn(undefined);
    await localRest(`processes?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: { ...(await stateOf(id)), check_mode: undefined } }),
    });
    await close(id);
    expect((await verify(id, receipt)).body.choice).toContain(PICK);
  });
});

describe("the mode on the draft", () => {
  // Unset through the admin route (so the hub's own settings cache agrees),
  // before and after.
  const unset = async () => {
    const res = await call("PUT", "/admin/hub/settings", BETA.host, {
      section: "plugins",
      values: { "plugin.vote.default_check_mode": "" },
    }, await admin(BETA));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  beforeAll(unset);
  afterAll(unset);

  it("starts at the hub's default, refuses anything else, and the review queue shows it", async () => {
    const { token } = await resident(BETA);
    const first = await call("POST", "/votes/drafts", BETA.host, {}, token);
    expect(first.body.check_mode).toBe("show_choice");

    // An admin sets the hub's default in Settings → Plugins → Votes.
    const set = await call("PUT", "/admin/hub/settings", BETA.host, {
      section: "plugins",
      values: { "plugin.vote.default_check_mode": "counted_only" },
    }, await admin(BETA));
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const draft = (await call("POST", "/votes/drafts", BETA.host, {}, token)).body;
    expect(draft.check_mode).toBe("counted_only");

    const bad = await call("PATCH", `/votes/drafts/${draft.id}`, BETA.host, { check_mode: "reveal_everything" }, token);
    expect(bad.status).toBe(400);

    // The creator picks the other one; it reaches the queue and the vote.
    await call("PATCH", `/votes/drafts/${draft.id}`, BETA.host, {
      title: `Mode on the draft ${Date.now()}`,
      description: `A draft for the check-mode test. ${FAKE_COC_DOWN}`,
      check_mode: "show_choice",
    }, token);
    const submitted = await call("POST", `/votes/drafts/${draft.id}/submit`, BETA.host, {}, token);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const review = await call("GET", `/admin/reviews/${submitted.body.review_id}`, BETA.host, undefined, await admin(BETA));
    const field = (review.body.submission as Array<{ key: string; value: string }>).find((f) => f.key === "check_mode");
    expect(field?.value).toMatch(/^Show the choice/);
    expect((await stateOf(submitted.body.process_id)).check_mode).toBe("show_choice");
  });
});

async function stateOf(id: string): Promise<Record<string, unknown>> {
  const [row] = (await localRest(`processes?select=state&id=eq.${id}`)) as Array<{ state: Record<string, unknown> }>;
  return row.state;
}
