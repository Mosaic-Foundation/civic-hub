// Vote options are at most 80 characters when a vote is made (Actions slice,
// 2026-10-13), by an admin's create or a resident's draft at Submit. Votes
// made before the limit keep their options (the results page shows a long
// one in three lines; tests/e2e/yourVote.spec.ts).

import { describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { admin, approve, BETA, resident } from "../conformance/driver.js";
import { VOTE_OPTION_MAX } from "../../src/shared/voteOptions.js";
import { FAKE_COC_DOWN } from "../../src/debug/fakeCodeOfConduct.js";

const exactly = (n: number) => "x".repeat(n);

function create(options: string[], token: string) {
  return call("POST", "/process", BETA.host, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Option limit ${Date.now()}`,
    description: "A vote for the option-limit test.",
    state: { method: "approval", options, activation_mode: "direct" },
  }, token);
}

describe("vote option limit", () => {
  it(`an admin's create takes options of ${VOTE_OPTION_MAX} characters and refuses longer`, async () => {
    const token = await admin(BETA);
    expect((await create([exactly(VOTE_OPTION_MAX), "Two"], token)).status).toBe(201);
    const refused = await create([exactly(VOTE_OPTION_MAX + 1), "Two"], token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.code).toBe("option_too_long");
    expect(refused.body.error).toContain(`${VOTE_OPTION_MAX} characters`);
  });

  it("a resident's draft is refused at Submit with an overlong option, and kept", async () => {
    const { token } = await resident(BETA);
    const draft = await call("POST", "/votes/drafts", BETA.host, {}, token);
    expect(draft.status).toBe(201);
    const filled = await call("PATCH", `/votes/drafts/${draft.body.id}`, BETA.host, {
      title: `Option limit draft ${Date.now()}`,
      description: `A draft for the option-limit test. ${FAKE_COC_DOWN}`,
      method: "approval",
      custom_options: [exactly(VOTE_OPTION_MAX + 5), "Two"],
    }, token);
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    const submitted = await call("POST", `/votes/drafts/${draft.body.id}/submit`, BETA.host, {}, token);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(400);
    expect(submitted.body.code).toBe("option_too_long");
    const kept = await call("GET", `/votes/drafts/${draft.body.id}`, BETA.host, undefined, token);
    expect(kept.body.custom_options[0]).toHaveLength(VOTE_OPTION_MAX + 5);
  });

  // Blank option fields are ignored, never refused (2026-10-13): an extra
  // "+ Add option" left empty must not block Submit.
  it("blank options are dropped at Submit, and the vote gets only the filled ones", async () => {
    const { token } = await resident(BETA);
    const draft = await call("POST", "/votes/drafts", BETA.host, {}, token);
    const filled = await call("PATCH", `/votes/drafts/${draft.body.id}`, BETA.host, {
      title: `Blank options ${Date.now()}`,
      description: "A draft with an empty option field.",
      method: "approval",
      custom_options: ["One", "", "Two", "   "],
    }, token);
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    const submitted = await call("POST", `/votes/drafts/${draft.body.id}/submit`, BETA.host, {}, token);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const approved = await approve(BETA, await admin(BETA), submitted.body.review_id);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const state = await call("GET", `/process/${submitted.body.process_id}/state`, BETA.host, undefined, token);
    expect(state.body.options).toEqual(["One", "Two"]);
  });

  it("a draft with fewer than two filled options is refused at Submit, and kept", async () => {
    const { token } = await resident(BETA);
    const draft = await call("POST", "/votes/drafts", BETA.host, {}, token);
    await call("PATCH", `/votes/drafts/${draft.body.id}`, BETA.host, {
      title: `One option ${Date.now()}`,
      description: "A draft with one filled option.",
      method: "approval",
      custom_options: ["Only", ""],
    }, token);
    const submitted = await call("POST", `/votes/drafts/${draft.body.id}/submit`, BETA.host, {}, token);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(400);
    expect(submitted.body.error).toContain("at least two options");
    const kept = await call("GET", `/votes/drafts/${draft.body.id}`, BETA.host, undefined, token);
    expect(kept.body.status).toBe("drafting");
  });

  it("an admin's create drops blank options", async () => {
    const res = await create(["One", "", "Two"], await admin(BETA));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.state?.options ?? res.body.options).toEqual(["One", "Two"]);
  });
});
