// Redaction by declared policy, served (Architecture 3, ADR-010; Adam,
// 2026-10-21, Q6): names on the wire follow the process type's declared
// disclosure policy, not the reader's sign-in state. Unit coverage of the
// full matrix is tests/unit/publicRedaction.test.ts; this file proves the
// serving path end to end on the two policies whose bytes change (field
// rows 8 and 9).
//
// Rows are written straight into the local stack: the test is about what
// the server then serves.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const ATHENS = "athens.localhost";
const run = randomBytes(4).toString("hex");
const announcementId = `proc_disc${run}a`;
const eventId = `evt_disc${run}a`;
let member = "";

beforeAll(async () => {
  member = await mintSession("athens", `disclosure-${run}@example.test`);
  // A published announcement by a non-official admin, with the post-time name
  // snapshot its real events carry. Before the policy, a signed-out reader
  // got "Admin" in its place; announcements are now the public record.
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({
      id: announcementId,
      hub_id: "athens",
      type: "civic.announcement",
      status: "active",
      title: `Disclosure announcement ${run}`,
      description: "",
      state: { status: "active", content: { title: `Disclosure announcement ${run}`, body: "x", links: [] } },
    }),
  });
  await localRest("events", {
    method: "POST",
    body: JSON.stringify({
      id: eventId,
      hub_id: "athens",
      event_type: "civic.process.result_published",
      actor: "system:announcement",
      process_id: announcementId,
      jurisdiction: "local",
      action_url: `http://athens.localhost/announcement/${announcementId}`,
      data: {
        process: { type: "civic.announcement" },
        announcement: {
          id: announcementId,
          title: `Disclosure announcement ${run}`,
          author_role: "Admin",
          official_type: null,
          author_display_name: `Dana Disclosure ${run}`,
        },
      },
      meta: { visibility: "public" },
    }),
  });
});

afterAll(async () => {
  await localRest(`processes?id=eq.${announcementId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
});

describe("a public-disclosure type (an announcement)", () => {
  it("serves the author's name to a signed-out reader and a member alike (row 9)", async () => {
    for (const token of [undefined, member]) {
      const res = await call("GET", `/activities/${eventId}`, ATHENS, undefined, token);
      expect(res.status).toBe(200);
      const payload = (res.body.object as Record<string, any>)["hub:payload"];
      expect(payload.announcement.author_display_name).toBe(`Dana Disclosure ${run}`);
    }
  });
});

describe("an anonymous-disclosure type (a vote)", () => {
  it("scrubs name-shaped fields for a member too (row 8)", async () => {
    const id = `evt_disc${run}v`;
    const voteId = `proc_disc${run}v`;
    await localRest("processes", {
      method: "POST",
      body: JSON.stringify({
        id: voteId,
        hub_id: "athens",
        type: "civic.vote",
        status: "active",
        title: `Disclosure vote ${run}`,
        description: "",
        state: { options: ["Yes", "No"] },
      }),
    });
    await localRest("events", {
      method: "POST",
      body: JSON.stringify({
        id,
        hub_id: "athens",
        event_type: "civic.process.started",
        actor: "system:test",
        process_id: voteId,
        jurisdiction: "local",
        action_url: `http://athens.localhost/process/${voteId}`,
        // The name sits inside the declared `process` subtree, which the
        // payload projection keeps whole — what hides it is the disclosure
        // policy's scrub, the thing under test.
        data: { process: { type: "civic.vote", options: ["Yes", "No"], author_name: `Dana Disclosure ${run}` } },
        meta: { visibility: "public" },
      }),
    });
    try {
      for (const token of [undefined, member]) {
        const res = await call("GET", `/activities/${id}`, ATHENS, undefined, token);
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain(`Dana Disclosure ${run}`);
      }
    } finally {
      await localRest(`processes?id=eq.${voteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
    }
  });
});
