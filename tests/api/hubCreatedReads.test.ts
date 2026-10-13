// The records the hub makes itself (briefs, meeting summaries, the retired
// vote results) are public only once published, and then without what is
// the admins' (Actions slice, 2026-10-13). Until then, GET /process/:id/state
// and GET /process/:id served their admin read model to anyone: unpublished
// text, and for a brief its recipients' email addresses (`recipients`, and
// `delivered_to` once sent).
//
// Rows are written straight into the local stack: the test is about what
// the server then serves, not how the row got there.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";

const HUB = "floyd";
const HOST = "floyd.civic.social";
const run = randomBytes(4).toString("hex");
const EMAIL = `official-${run}@example.test`;
const inserted: string[] = [];
let resident = "";

async function insert(type: string, status: string, state: Record<string, unknown>): Promise<string> {
  const id = `proc_reads${randomBytes(6).toString("hex")}`;
  inserted.push(id);
  await localRest("processes", {
    method: "POST",
    body: JSON.stringify({ id, hub_id: HUB, type, status, title: `Hub-made ${run}`, description: "", state }),
  });
  return id;
}

const content = {
  title: `Hub-made ${run}`,
  headline: "An outcome",
  summary: "What happened.",
  sections: [],
  participation_label: null,
  participation_count: 3,
  comments: [],
  admin_notes: "",
};

function brief(publication_status: string, extra: Record<string, unknown> = {}) {
  return {
    type: "civic.brief",
    // One brief per source (a unique index): a source of its own each time.
    source_process_id: `proc_source${randomBytes(6).toString("hex")}`,
    source_process_type: "civic.vote",
    publication_status,
    generated_at: new Date().toISOString(),
    approved_at: null,
    published_at: publication_status === "published" ? new Date().toISOString() : null,
    content,
    delivered_to: publication_status === "published" ? [EMAIL] : [],
    recipients: [{ email: EMAIL, label: "An official" }],
    ...extra,
  };
}

beforeAll(async () => {
  resident = await mintSession(HUB, `reads-${run}@example.test`);
});

afterAll(async () => {
  if (inserted.length > 0) {
    await localRest(`processes?id=in.(${inserted.join(",")})`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
  }
});

describe("what the hub makes is public only once published", () => {
  it("an unpublished brief, meeting summary and vote results record are not found, by a visitor or a resident", async () => {
    const ids = [
      await insert("civic.brief", "active", brief("pending")),
      await insert("civic.meeting_summary", "active", { approval_status: "pending", meeting_title: `Meeting ${run}`, blocks: [] }),
      await insert("civic.vote_results", "active", { publication_status: "pending", admin_notes: `Draft notes ${run}` }),
    ];
    for (const id of ids) {
      for (const token of [undefined, resident]) {
        for (const path of [`/process/${id}/state`, `/process/${id}`]) {
          const res = await call("GET", path, HOST, undefined, token);
          expect(res.status, `${path} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(404);
        }
      }
    }
  });

  it("a published brief reads as its public page does: no recipients, no emails", async () => {
    const id = await insert("civic.brief", "finalized", brief("published", { held_back: [{ email: EMAIL, reason: "demo" }] }));
    for (const token of [undefined, resident]) {
      const res = await call("GET", `/process/${id}/state`, HOST, undefined, token);
      expect(res.status).toBe(200);
      expect(res.body.headline).toBe("An outcome");
      for (const field of ["recipients", "delivered_to", "held_back", "publication_status", "pending_revision", "history"]) {
        expect(res.body, field).not.toHaveProperty(field);
      }
      expect(JSON.stringify(res.body)).not.toContain(EMAIL);
    }
  });

  // Every published brief says publicly whom it went to and when, by name and
  // title, never an address (Adam, 2026-10-13); and whom it was addressed to
  // but held back from, with why.
  it("the public brief carries recipients' names and dates, and no email address", async () => {
    const OTHER = `held-${run}@example.test`;
    const sentAt = "2026-10-13T15:00:00.000Z";
    const approvedAt = "2026-10-13T14:59:00.000Z";
    const id = await insert("civic.brief", "finalized", brief("published", {
      approved_at: approvedAt,
      recipients: [{ email: EMAIL, label: "Jane Doe, Chair" }, { email: OTHER, label: "Test BoS" }],
      delivered_to: [EMAIL],
      delivered_at: sentAt,
      delivered_to_labels: ["Jane Doe, Chair"],
      held_back: [{ email: OTHER, reason: "this hub is in demo mode" }],
      held_back_labels: ["Test BoS"],
    }));
    for (const token of [undefined, resident]) {
      const res = await call("GET", `/brief/${id}`, HOST, undefined, token);
      expect(res.status).toBe(200);
      expect(res.body.sent_to).toEqual(["Jane Doe, Chair"]);
      expect(res.body.delivered_at).toBe(sentAt);
      expect(res.body.addressed_to).toEqual(["Test BoS"]);
      expect(res.body.not_sent_because).toBe("this hub is in demo mode");
      expect(res.body.approved_at).toBe(approvedAt);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(OTHER);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
