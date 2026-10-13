// Submit runs the Code of Conduct check (Submit and Save, 2026-10-12). The
// conformance suite proves the common path for every drafted type (flagged
// text refused and kept, "tell the admins" once, a check that can't run goes
// to an admin). This file covers the rest, on proposals:
//   - an admin's own flagged text, sent to the admins, waits in the queue;
//   - "tell the admins" with text the check passes is an ordinary submission;
//   - a second Submit on the same flagged text is refused the same way;
//   - a revision's flag follows the revised text (set, then cleared);
//   - the admin's review carries the findings and the note;
//   - the older on-demand check route still answers, for pages already open.
//
// The hub must run the fake check (CIVIC_COC_FAKE=on). Both API passes.

import { beforeAll, describe, expect, it } from "vitest";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { COC_FLAG } from "../fixtures/codeOfConduct.js";

const FLOYD = "floyd.civic.social";
const PATH = "/proposals/drafts";
const tag = Date.now().toString(36);

let resident = "";
let admin = "";

beforeAll(async () => {
  resident = await mintSession("floyd", `submit-check-${tag}@example.test`);
  admin = await mintSession("floyd", "admin@example.test");
});

async function draftWith(token: string, description: string, title = `Submit check ${tag}`): Promise<string> {
  const made = await call("POST", PATH, FLOYD, { category: "idea" }, token);
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const id = made.body.id as string;
  const filled = await call("PATCH", `${PATH}/${id}`, FLOYD, { title, description }, token);
  expect(filled.status, JSON.stringify(filled.body)).toBe(200);
  return id;
}

const submit = (token: string, id: string, body: Record<string, unknown> = {}) =>
  call("POST", `${PATH}/${id}/submit`, FLOYD, body, token);

describe("Submit runs the Code of Conduct check", () => {
  it("refuses flagged text with its findings, and the same again on a second press", async () => {
    const id = await draftWith(resident, `Rude words ${COC_FLAG}`);
    for (let i = 0; i < 2; i++) {
      const res = await submit(resident, id);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "code_of_conduct_flagged", error: expect.stringMatching(/Your draft is saved/) });
      expect(res.body.findings).toEqual([
        { field: "description", quoted_text: COC_FLAG, message: expect.any(String) },
      ]);
    }
    expect((await call("GET", `${PATH}/${id}`, FLOYD, undefined, resident)).body.status).toBe("drafting");
  });

  it("an admin's own flagged text, sent to the admins, waits in the queue", async () => {
    const id = await draftWith(admin, `Admin's text ${COC_FLAG}`);
    expect((await submit(admin, id)).status).toBe(400);
    const told = await submit(admin, id, { tell_admins: true });
    expect(told.status, JSON.stringify(told.body)).toBe(201);
    expect(told.body).toMatchObject({ auto_approved: false, flagged: true });
  });

  it("'tell the admins' with text the check passes is an ordinary submission, unflagged", async () => {
    const id = await draftWith(resident, "A bench by the bus stop.");
    const res = await submit(resident, id, { tell_admins: true, note: "Just in case." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.flagged).toBeUndefined();
    const review = await call("GET", `/admin/reviews/${res.body.review_id}`, FLOYD, undefined, admin);
    expect(review.body.review?.coc_flags ?? review.body.coc_flags ?? null).toBeNull();
  });

  it("the admin sees the findings and the note; a revision's flag follows its text", async () => {
    const id = await draftWith(resident, `First try ${COC_FLAG}`);
    const note = "The check misread a quotation.";
    const told = await submit(resident, id, { tell_admins: true, note });
    expect(told.status, JSON.stringify(told.body)).toBe(201);
    const reviewId = told.body.review_id as string;

    const seen = await call("GET", `/admin/reviews/${reviewId}`, FLOYD, undefined, admin);
    expect(seen.status).toBe(200);
    const shown = JSON.stringify(seen.body);
    expect(shown).toContain("coc_flags");
    expect(shown).toContain(note);

    // The admin asks for changes; the resident revises the same draft.
    const asked = await call("POST", `/admin/reviews/${reviewId}/request-changes`, FLOYD, { note: "Please reword." }, admin);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const reopen = () => call("POST", `/reviews/${reviewId}/reopen`, FLOYD, {}, resident);
    expect((await reopen()).status).toBe(200);
    expect((await call("GET", `${PATH}/${id}`, FLOYD, undefined, resident)).body.status).toBe("drafting");

    // Revised, and still flagged: refused, then sent again with the flag.
    await call("PATCH", `${PATH}/${id}`, FLOYD, { description: `Second try ${COC_FLAG}` }, resident);
    expect((await submit(resident, id, { review_id: reviewId })).status).toBe(400);
    const again = await submit(resident, id, { review_id: reviewId, tell_admins: true });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.flagged).toBe(true);

    // Revised clean: the flag is cleared.
    await call("POST", `/admin/reviews/${reviewId}/request-changes`, FLOYD, { note: "Once more." }, admin);
    expect((await reopen()).status).toBe(200);
    await call("PATCH", `${PATH}/${id}`, FLOYD, { description: "Third try, reworded." }, resident);
    const clean = await submit(resident, id, { review_id: reviewId });
    expect(clean.status, JSON.stringify(clean.body)).toBe(201);
    const after = await call("GET", `/admin/reviews/${reviewId}`, FLOYD, undefined, admin);
    expect(JSON.stringify(after.body)).toMatch(/"coc_flags":null/);
  });

  it("the older on-demand check route still answers", async () => {
    const id = await draftWith(resident, `Checked on demand ${COC_FLAG}`);
    const res = await call("POST", `/assistant/civic.proposal/drafts/${id}/review`, FLOYD, {}, resident);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.response.suggestions).toHaveLength(1);
  });
});
