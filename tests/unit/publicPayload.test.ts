// The declared public payload (Architecture 3, ADR-010): a member or public
// reader of the AS2 surface gets only the payload fields the event's type
// declares, an admin gets the stored payload verbatim, and the approved
// removals (Adam's field rows 1–7, 2026-10-21) are exactly what disappears.

import { describe, expect, it } from "vitest";
import type { CivicEvent } from "../../src/models/event.js";
import { projectDocumentPayload, publicPayloadKeys } from "../../src/events/publicPayload.js";
import { toActivity } from "../../src/events/activitySerializer.js";
import { toRedactedActivity } from "../../src/events/publicRedaction.js";

function event(overrides: Partial<CivicEvent> = {}): CivicEvent {
  return {
    id: "evt_pp01",
    version: "1.0",
    event_type: "civic.process.updated",
    timestamp: "2026-10-21T10:00:00Z",
    process_id: "proc_pp",
    actor: "system:test",
    jurisdiction: "us-va-floyd",
    action_url: "https://app.floyd.example/process/proc_pp",
    source: { hub_id: "civic-hub-floyd", hub_url: "https://hub.floyd.example" },
    data: {},
    meta: { visibility: "public" },
    ...overrides,
  };
}

function servedPayload(e: CivicEvent, audience: "member" | "public" = "member") {
  const activity = toRedactedActivity(e, new Set(), audience);
  return (activity.object as Record<string, unknown>)["hub:payload"];
}

describe("the declared public payload on the served wire", () => {
  it("row 1: a brief's publication_status leaves the updated event", () => {
    const e = event({
      data: { process: { type: "civic.brief" }, publication_status: "pending" },
    });
    expect(servedPayload(e)).toEqual({ process: { type: "civic.brief" } });
  });

  it("row 2: delivered_to_count leaves outcome_recorded; source_process_id stays", () => {
    const e = event({
      event_type: "civic.process.outcome_recorded",
      data: { process: { type: "civic.brief" }, source_process_id: "proc_src", delivered_to_count: 3 },
    });
    expect(servedPayload(e)).toEqual({
      process: { type: "civic.brief" },
      source_process_id: "proc_src",
    });
  });

  it("rows 3 and 6: a conversation's started event keeps the topic, drops the Polis id and the duplicates", () => {
    const e = event({
      event_type: "civic.process.started",
      data: {
        process: { type: "civic.polis_deliberation" },
        topic: "Downtown parking",
        polis_conversation_id: "2abc4def",
        process_id: "proc_pp",
        process_type: "civic.polis_deliberation",
      },
    });
    expect(servedPayload(e)).toEqual({
      process: { type: "civic.polis_deliberation" },
      topic: "Downtown parking",
    });
  });

  it("rows 4 and 5: summary_status and brief_revision leave; participation_stats and reason stay", () => {
    const ended = event({
      event_type: "civic.process.ended",
      data: {
        process: { type: "civic.polis_deliberation" },
        participation_stats: { participants: 12, statements: 40 },
        summary_status: "pending",
      },
    });
    expect(servedPayload(ended)).toEqual({
      process: { type: "civic.polis_deliberation" },
      participation_stats: { participants: 12, statements: 40 },
    });
    const updated = event({
      data: {
        process: { type: "civic.polis_deliberation" },
        reason: "edited",
        brief_revision: { brief_id: "proc_b", fields: ["summary"] },
      },
    });
    expect(servedPayload(updated)).toEqual({
      process: { type: "civic.polis_deliberation" },
      reason: "edited",
    });
  });

  it("row 7: vote_results' results_id leaves result_published; the rest stays", () => {
    const e = event({
      event_type: "civic.process.result_published",
      data: {
        process: { type: "civic.vote_results" },
        results_id: "vres_1",
        headline_result: "Yes",
        participation_count: 41,
        source_process_id: "proc_src",
      },
    });
    expect(servedPayload(e)).toEqual({
      process: { type: "civic.vote_results" },
      headline_result: "Yes",
      participation_count: 41,
      source_process_id: "proc_src",
    });
  });

  it("projecting a conforming document returns it by reference — byte-stable", () => {
    const doc = toActivity(
      event({
        event_type: "civic.process.result_published",
        data: {
          process: { type: "civic.vote" },
          result: { tally: { yes: 2, no: 1 }, total_votes: 3 },
          results_at_close: true,
        },
      }),
    );
    expect(projectDocumentPayload(doc, "civic.process.result_published")).toBe(doc);
  });

  it("host keys: a comment's payload and the Move's record pass whole", () => {
    expect([...publicPayloadKeys("civic.process.comment_added", null)]).toContain("comment");
    expect([...publicPayloadKeys("civic.hub.moved", null)]).toContain("move");
  });

  it("an unknown type's extras collapse to the process block — the safe direction", () => {
    const e = event({
      event_type: "civic.process.started",
      data: { process: { type: "civic.someday" }, secret_note: "internal" },
    });
    expect(servedPayload(e)).toEqual({ process: { type: "civic.someday" } });
  });

  it("the object's type and name still come from the stored payload, not the projected one", () => {
    // An official response whose `action` discriminator is not a declared
    // vote field: the object must stay hub:OfficialResponse (built from the
    // stored payload) while the served payload drops the undeclared keys.
    const e = event({
      event_type: "civic.process.action_taken",
      data: { process: { type: "civic.vote" }, action: "official_response" },
    });
    const activity = toRedactedActivity(e, new Set(), "public");
    expect((activity.object as { type: string }).type).toBe("hub:OfficialResponse");
    expect((activity.object as Record<string, unknown>)["hub:payload"]).toEqual({
      process: { type: "civic.vote" },
    });
  });

  it("an emptied payload is omitted, and the hub context entry goes with the last hub term", () => {
    const e = event({
      event_type: "civic.process.started",
      data: { x: 1 },
    });
    const activity = toRedactedActivity(e, new Set(), "public");
    const object = activity.object as Record<string, unknown>;
    expect(object["hub:payload"]).toBeUndefined();
    expect(activity["@context"]).toEqual([
      "https://www.w3.org/ns/activitystreams",
      "https://civic.social/ns/civic",
    ]);
  });
});

describe("the admin view", () => {
  it("is the stored payload verbatim", () => {
    const activity = toActivity(
      event({ data: { process: { type: "civic.brief" }, publication_status: "pending" } }),
    );
    expect((activity.object as Record<string, unknown>)["hub:payload"]).toEqual({
      process: { type: "civic.brief" },
      publication_status: "pending",
    });
  });
});
