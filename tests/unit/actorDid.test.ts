/**
 * The actor's DID on the wire (Architecture 4, ADR-011, item 5; Adam, Q4).
 *
 * events.wire_actor_did is stamped at insert from the person's own, self-set
 * users.identity_did (20261023010000). The serializer serves it in place of
 * the account's /users/<id> IRI — but only where the event's type's disclosure
 * policy already serves an actor, never for "anonymous", and redaction hides
 * it wherever it hides the actor. Unset (every account today), the documents
 * are byte-for-byte what they were.
 */

import { describe, it, expect } from "vitest";
import { rowToEvent, type EventRow } from "../../src/events/eventStore.js";
import { BACKFILLED, WIRE_FIXTURE_OFFICIAL, serializeWireFixture } from "../fixtures/wire/wireFixture.js";
import { redactEvent } from "../../src/events/publicRedaction.js";

const DID = "did:key:z6MkpersonsOwnKeyExample";

function row(type: string, processType: string, actor: string, did?: string): EventRow {
  return {
    id: `evt_${type.replace(/\W/g, "_")}_${actor}`,
    version: "0.1",
    event_type: type,
    process_id: "proc_did",
    actor,
    jurisdiction: "us-xx-fixture",
    action_url: "",
    source: { hub_id: "civic-hub-wire", hub_url: "https://wire.example" },
    dedupe_key: null,
    data: { process: { type: processType } },
    meta: { visibility: "public" },
    created_at: "2026-10-23T12:00:00.000Z",
    wire_hostname: BACKFILLED.hostname,
    wire_process_hostname: BACKFILLED.process_hostname,
    wire_actor_hostname: BACKFILLED.actor_hostname,
    wire_ns: BACKFILLED.ns,
    ...(did === undefined ? {} : { wire_actor_did: did }),
  };
}

async function docs(r: EventRow) {
  const [d] = await serializeWireFixture([rowToEvent(r)]);
  return d;
}

describe("the actor's DID", () => {
  it("unset: every view is byte-identical to a row from before the column", async () => {
    for (const [type, pt] of [
      ["civic.process.created", "civic.proposal"],
      ["civic.process.created", "civic.vote"],
      ["civic.process.created", "civic.announcement"],
    ] as const) {
      const before = await docs(row(type, pt, "u_resident"));
      const none = await docs(row(type, pt, "u_resident", null as unknown as string));
      expect(JSON.stringify(none)).toBe(JSON.stringify(before));
      expect(rowToEvent(row(type, pt, "u_resident", null as unknown as string)).wire).toEqual(rowToEvent(row(type, pt, "u_resident")).wire);
    }
  });

  it("set, on a type whose policy serves an actor: the admin view names the DID, not the account", async () => {
    const d = await docs(row("civic.process.created", "civic.proposal", "u_resident", DID));
    expect(d.admin.actor).toBe(DID);
    // Everything else in the document is as without it.
    const plain = await docs(row("civic.process.created", "civic.proposal", "u_resident"));
    expect({ ...d.admin, actor: undefined }).toEqual({ ...plain.admin, actor: undefined });
  });

  it("is hidden wherever the actor is: a resident below admin gets the process-scoped token, not the DID", async () => {
    const d = await docs(row("civic.process.created", "civic.proposal", "u_resident", DID));
    const plain = await docs(row("civic.process.created", "civic.proposal", "u_resident"));
    expect(d.member).toEqual(plain.member);
    expect(d.public).toEqual(plain.public);
    expect(JSON.stringify([d.member, d.public])).not.toContain(DID);
    // And off the internal event the feed serves, once redacted.
    const redacted = redactEvent(rowToEvent(row("civic.process.created", "civic.proposal", "u_resident", DID)), new Set(), "member");
    expect(JSON.stringify(redacted)).not.toContain(DID);
  });

  it("an official on the public record is named by their DID to every reader", async () => {
    const d = await docs(row("civic.process.created", "civic.announcement", WIRE_FIXTURE_OFFICIAL, DID));
    expect(d.admin.actor).toBe(DID);
    expect(d.member.actor).toBe(DID);
    expect(d.public.actor).toBe(DID);
  });

  it("never for the anonymous policy, in any view, for anyone", async () => {
    for (const actor of ["u_resident", WIRE_FIXTURE_OFFICIAL]) {
      const r = row("civic.process.created", "civic.vote", actor, DID);
      expect(rowToEvent(r).wire?.actor_did).toBeUndefined();
      const d = await docs(r);
      const plain = await docs(row("civic.process.created", "civic.vote", actor));
      expect(JSON.stringify(d)).toBe(JSON.stringify(plain));
      expect(JSON.stringify(d)).not.toContain(DID);
    }
  });

  it("an event of an unknown type is read as 'members' (ADR-010's default), so it may carry one", () => {
    const r = row("civic.process.created", "", "u_resident", DID);
    r.data = {};
    expect(rowToEvent(r).wire?.actor_did).toBe(DID);
  });
});
