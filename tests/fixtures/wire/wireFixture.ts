// FIXTURE DATA — the wire-identity fixture hub.
//
// One event for every mapped event type, with every actor form the
// serializer knows (user:, bare id, system:<part>, bare "system", did:,
// anonymous, an official), public and restricted, with and without a
// process. serializeWireFixture() projects them the three ways the hub
// serves them (admin, member, public) inside the fixture hub's scope.
//
// tests/fixtures/wire/before.json is that output as the serializer produced
// it BEFORE the Architecture-1 slice (wire identity frozen at emission). It
// is the invariant of that slice: no identifier the hub serves today may
// change. tests/unit/wireIdentity.test.ts compares against it; never
// regenerate it to make a red test green.

import type { CivicEvent } from "../../../src/models/event.js";
import type { Hub } from "../../../src/models/hub.js";
import { withHubScope } from "../../../src/config/hubContext.js";
import { toActivity } from "../../../src/events/activitySerializer.js";
import { toRedactedActivity } from "../../../src/events/publicRedaction.js";

export const WIRE_FIXTURE_HUB: Hub = {
  id: "wirefix",
  protocol_hub_id: "civic-hub-wirefix",
  hostname: "wirefix.example",
  name: "Wire Fixture Hub",
  jurisdiction_code: "us-zz-wirefix",
  jurisdiction_name: "Wire Fixture County",
  space_did: "did:web:wirefix.example",
  space_type: "civic-hub",
  status: "active",
  mode: "live",
  created_at: "2026-09-22T00:00:00Z",
  updated_at: "2026-09-22T00:00:00Z",
};

/** The fixture's one official, whose IRI stays un-anonymized on every wire. */
export const WIRE_FIXTURE_OFFICIAL = "u_official";

/** The secret the public wire's per-process tokens are keyed with. */
export const WIRE_FIXTURE_ANON_SECRET = "wire-fixture-anon-secret";

const ACTORS = [
  "user:u_resident",
  "u_bare",
  "system:brief-spawn",
  "system",
  "did:web:person.example",
  "anonymous",
  `user:${WIRE_FIXTURE_OFFICIAL}`,
];

/** A payload every mapping can read something from. */
function payloadFor(eventType: string): Record<string, unknown> {
  return {
    process: { type: "civic.vote", title: `Fixture ${eventType}`, status: "active" },
    title: `Fixture ${eventType}`,
    comment: { body_preview: "A fixture comment", parent_id: "cmt_parent" },
    vote: { changed: false, method: "single_choice" },
    action: eventType === "civic.process.action_taken" ? "official_response" : undefined,
    author_display_name: "Fixture Author",
    full_name: "Fixture Person",
  };
}

/** The fixture events, in a fixed order, for the given mapped types. */
export function wireFixtureEvents(eventTypes: readonly string[]): CivicEvent[] {
  return [...eventTypes].sort().map((eventType, i) => {
    const n = String(i + 1).padStart(3, "0");
    const withProcess = i % 5 !== 4;
    return {
      id: `evt_wire_${n}`,
      version: "1.0",
      event_type: eventType,
      timestamp: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T12:${String(i % 60).padStart(2, "0")}:00+00:00`,
      process_id: withProcess ? `proc_wire_${(i % 4) + 1}` : "",
      actor: ACTORS[i % ACTORS.length],
      jurisdiction: "us-zz-wirefix",
      action_url: withProcess ? `https://wirefix.example/process/proc_wire_${(i % 4) + 1}` : "",
      source: { hub_id: "civic-hub-wirefix", hub_url: "https://wirefix.example" },
      data: payloadFor(eventType),
      meta: { visibility: i % 3 === 2 ? "restricted" : "public" },
    };
  });
}

export interface WireDocuments {
  event_id: string;
  admin: Record<string, unknown>;
  member: Record<string, unknown>;
  public: Record<string, unknown>;
}

/**
 * The three serialized forms of each event, inside `hub`'s scope. `hub`
 * defaults to the fixture hub; pass a moved copy of it to simulate a
 * hostname change.
 */
export async function serializeWireFixture(
  events: readonly CivicEvent[],
  hub: Hub = WIRE_FIXTURE_HUB,
): Promise<WireDocuments[]> {
  const officials = new Set([WIRE_FIXTURE_OFFICIAL]);
  // The public wire's tokens are keyed with this secret; pin it so the
  // fixture describes the serializer, not the developer's .env.
  const saved = process.env.CIVIC_ANON_SECRET;
  process.env.CIVIC_ANON_SECRET = WIRE_FIXTURE_ANON_SECRET;
  try {
    return await withHubScope(hub, {}, async () =>
      events.map((event) => ({
        event_id: event.id,
        admin: toActivity(event),
        member: toRedactedActivity(event, officials, "member"),
        public: toRedactedActivity(event, officials, "public"),
      })),
    );
  } finally {
    if (saved === undefined) delete process.env.CIVIC_ANON_SECRET;
    else process.env.CIVIC_ANON_SECRET = saved;
  }
}
