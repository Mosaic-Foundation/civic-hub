// Close early (Actions slice, 2026-10-13): the API refuses an admin's close
// before the deadline without a note, and takes one with a note. The
// conformance suite walks the whole close for every type with a deadline
// (step 5b); this file covers what that walk doesn't: after the deadline no
// note is needed, and a resident can't close at all.

import { describe, expect, it } from "vitest";
import { act, admin, BETA, expireDeadline, liveProcess, processRow, resident } from "../../kit/conformance/src/driver.js";
import { hostFacts } from "../../kit/conformance/src/hostFacts.js";
import { call } from "../fixtures/hostCall.js";
import { getDescriptor } from "../../src/processes/registry.js";

const vote = getDescriptor("civic.vote")!;
const proposal = getDescriptor("civic.proposal")!;

/** A vote an admin made and opened at once, open for a day. */
async function activeVote(): Promise<string> {
  const made = await call("POST", "/process", BETA.host, {
    definition: { type: "civic.vote", version: "0.1" },
    title: `Close early ${Date.now()}`,
    description: "A vote for the close-early test.",
    state: { options: ["Yes", "No"], voting_duration_ms: 86_400_000, activation_mode: "direct" },
  }, await admin(BETA));
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const res = await act(BETA, made.body.id, "process.activate", {}, await admin(BETA));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return made.body.id;
}

describe("Close early", () => {
  it("refuses an admin's close of a vote before its deadline without a note, or with only spaces", async () => {
    const id = await activeVote();
    for (const payload of [{}, { note: "   " }]) {
      const res = await act(BETA, id, "process.close", payload, await admin(BETA));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe("note_required");
      expect(res.body.error).toMatch(/note/i);
    }
    expect((await processRow(id)).status).toBe("active");
  });

  it("refuses a proposal's early close without a note, and takes one with a note", async () => {
    const id = await liveProcess(proposal, hostFacts(), BETA);
    const refused = await act(BETA, id, "process.close", {}, await admin(BETA));
    expect(refused.body.code).toBe("note_required");
    const closed = await act(BETA, id, "process.close", { note: "The board took this up directly." }, await admin(BETA));
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.view.closed_early.note).toBe("The board took this up directly.");
    expect(closed.body.view.closed_early.line).toMatch(/^Closed early on /);
  });

  it("once the deadline has passed, an admin's close needs no note and records no early close", async () => {
    const id = await activeVote();
    await expireDeadline(vote, id);
    // The read that notices the deadline may close it first; either way it closes once, without a record.
    const res = await act(BETA, id, "process.close", {}, await admin(BETA));
    expect([200, 409]).toContain(res.status);
    const row = await processRow(id);
    expect(row.status).toBe("finalized");
    expect(row.state.closed_early).toBeUndefined();
  });

  it("a resident can't close one, note or not", async () => {
    const id = await activeVote();
    const { token } = await resident(BETA);
    const res = await act(BETA, id, "process.close", { note: "I'd like it closed." }, token);
    expect(res.status).toBe(403);
    expect((await processRow(id)).status).toBe("active");
  });
});
