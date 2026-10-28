/**
 * The Events plugin on the wire (plugin Events, 2026-10-27): every event it
 * writes serializes as an AS2 Event a fediverse reader parses — Create,
 * Update, Join and Leave on an object of type Event, with startTime, endTime,
 * a Place (with a schema.org PostalAddress) or an online Link, summary,
 * content and ical:status — and each term it uses is AS2's or declared in the
 * document's @context. The hub's own created event stays civic:Process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { toActivity, ICAL_CONTEXT, SCHEMA_ADDRESS_CONTEXT } from "../../src/events/activitySerializer.js";
import { projectDocumentPayload } from "../../src/events/publicPayload.js";
import type { CivicEvent } from "../../src/models/event.js";
import { eventBlock, type EventState } from "../../packages/civic.event/event.js";

const ENV = {
  BASE_URL: "https://hub.example",
  CIVIC_UI_BASE_URL: "https://app.hub.example",
  CIVIC_SPACE_DID: "did:web:hub.example",
  HUB_NAME: "Example Hub",
  CIVIC_JURISDICTION: "",
  CIVIC_JURISDICTION_NAME: "",
};
const SAVED: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    SAVED[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const AS2 = "https://www.w3.org/ns/activitystreams";

const PLACE_STATE: EventState = {
  start_time: "2030-06-01T17:00:00.000Z",
  end_time: "2030-06-01T19:00:00.000Z",
  location: {
    type: "Place",
    name: "Community room",
    address: { type: "PostalAddress", streetAddress: "1 Example Street", addressLocality: "Exampletown", postalCode: "00000" },
  },
  cancelled: null,
};

const ONLINE_STATE: EventState = {
  ...PLACE_STATE,
  location: { type: "Link", name: "Online", href: "https://meet.example/room" },
};

/** An event of 0.3.0 with everything it may have: its zone, its picture, a limit. */
const SEASON_STATE: EventState = {
  ...PLACE_STATE,
  time_zone: "America/Chicago",
  image: { url: "https://store.example/hub/types/civic.event/2030/05/pic.webp", alt: "The community room set for dinner" },
  capacity: 40,
};

function eventOf(eventType: string, state: EventState, extra: Record<string, unknown> = {}, going?: number): CivicEvent {
  return {
    id: "evt_ev1",
    version: "1.0",
    event_type: eventType,
    timestamp: "2030-05-01T12:00:00Z",
    process_id: "proc_ev1",
    actor: "user:abc",
    jurisdiction: "",
    action_url: "https://app.hub.example/events/proc_ev1",
    source: { hub_id: "hub", hub_url: "https://hub.example" },
    data: {
      process: { ...eventBlock("Neighbours' evening", "An evening to meet the neighbours.", state, going), type: "civic.event" },
      ...extra,
    },
    meta: { visibility: "public" },
  };
}

/**
 * The properties AS2's vocabulary defines on an Object (§4 of the vocabulary)
 * and on a Place, plus JSON-LD's own keywords. A key outside these must use a
 * prefix or term the document's @context declares.
 */
const AS2_OBJECT_TERMS = new Set([
  "id", "type", "attachment", "attributedTo", "audience", "content", "context", "name", "endTime",
  "generator", "icon", "image", "inReplyTo", "location", "preview", "published", "replies", "startTime",
  "summary", "tag", "updated", "url", "to", "bto", "cc", "bcc", "mediaType", "duration",
]);
const AS2_PLACE_TERMS = new Set(["type", "id", "name", "accuracy", "altitude", "latitude", "longitude", "radius", "units"]);
const AS2_LINK_TERMS = new Set(["type", "href", "rel", "mediaType", "name", "hreflang", "height", "width", "preview"]);

/** Terms and prefixes the document's @context declares beyond AS2's own. */
function declared(doc: Record<string, unknown>): { prefixes: Set<string>; terms: Set<string> } {
  const prefixes = new Set<string>(["civic"]);
  const terms = new Set<string>();
  for (const entry of doc["@context"] as unknown[]) {
    if (entry && typeof entry === "object") {
      for (const [k, v] of Object.entries(entry as Record<string, string>)) {
        if (typeof v === "string" && /^https?:/.test(v)) prefixes.add(k);
        else terms.add(k);
      }
    }
  }
  return { prefixes, terms };
}

/** Every key a reader cannot resolve, with where it was. */
function unresolved(doc: Record<string, unknown>): string[] {
  const { prefixes, terms } = declared(doc);
  const ok = (key: string, own: Set<string>) =>
    own.has(key) || terms.has(key) || (key.includes(":") && prefixes.has(key.split(":")[0]));
  const object = doc.object as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(object)) if (!ok(key, AS2_OBJECT_TERMS)) out.push(`object.${key}`);
  const location = object.location as Record<string, unknown> | undefined;
  if (location) {
    const own = location.type === "Link" ? AS2_LINK_TERMS : AS2_PLACE_TERMS;
    for (const key of Object.keys(location)) if (!ok(key, own)) out.push(`location.${key}`);
    const address = location.address as Record<string, unknown> | undefined;
    for (const key of Object.keys(address ?? {})) if (key !== "type" && !terms.has(key)) out.push(`address.${key}`);
    if (address && !terms.has(address.type as string)) out.push("address.type");
  }
  return out;
}

describe("the Events plugin on the wire", () => {
  it("publishes a Create of an AS2 Event with its time, place, address and status", () => {
    const doc = toActivity(eventOf("civic.event.published", PLACE_STATE));
    expect(doc.type).toBe("Create");
    expect(doc["@context"]).toEqual([AS2, "https://civic.social/ns/civic", ICAL_CONTEXT, SCHEMA_ADDRESS_CONTEXT, { hub: "https://www.civic.social/ns/civic-hub#" }]);
    const object = doc.object as Record<string, unknown>;
    expect(object).toMatchObject({
      type: "Event",
      id: "https://app.hub.example/process/proc_ev1",
      name: "Neighbours' evening",
      summary: "An evening to meet the neighbours.",
      content: "An evening to meet the neighbours.",
      startTime: "2030-06-01T17:00:00.000Z",
      endTime: "2030-06-01T19:00:00.000Z",
      location: PLACE_STATE.location,
      "ical:status": "CONFIRMED",
    });
    expect((doc.context as Record<string, unknown>)["civic:processType"]).toBe("civic.event");
    expect(unresolved(doc)).toEqual([]);
  });

  it("names everything AS2 recommends for an Event: id, name, startTime, endTime, location", () => {
    for (const state of [PLACE_STATE, ONLINE_STATE]) {
      const object = toActivity(eventOf("civic.event.published", state)).object as Record<string, unknown>;
      for (const key of ["id", "type", "name", "startTime", "endTime", "location"]) expect(object[key], key).toBeTruthy();
      // xsd:dateTime with an explicit offset (RFC 3339).
      expect(object.startTime).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
      expect(object.endTime).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    }
  });

  it("puts an online event's link in location as an AS2 Link, with no address vocabulary", () => {
    const doc = toActivity(eventOf("civic.event.published", ONLINE_STATE));
    expect((doc.object as Record<string, unknown>).location).toEqual({ type: "Link", name: "Online", href: "https://meet.example/room" });
    expect(doc["@context"]).not.toContainEqual(SCHEMA_ADDRESS_CONTEXT);
    expect(unresolved(doc)).toEqual([]);
  });

  it("announces a cancellation as an Update with ical:status CANCELLED", () => {
    const cancelled = { ...PLACE_STATE, cancelled: { at: "2030-05-20T00:00:00Z", reason: "The room is no longer available." } };
    const doc = toActivity(eventOf("civic.event.cancelled", cancelled, { cancellation: { reason: "The room is no longer available." } }));
    expect(doc.type).toBe("Update");
    expect((doc.object as Record<string, unknown>)["ical:status"]).toBe("CANCELLED");
    expect(unresolved(doc)).toEqual([]);
  });

  it("serializes going and not going as Join and Leave on the Event, the count in its payload", () => {
    for (const [eventType, verb] of [["civic.event.going", "Join"], ["civic.event.not_going", "Leave"]]) {
      const doc = toActivity(eventOf(eventType, PLACE_STATE, { attendance: { count: 3 } }));
      expect(doc.type).toBe(verb);
      const object = doc.object as Record<string, unknown>;
      expect(object.type).toBe("Event");
      expect(object.id).toBe("https://app.hub.example/process/proc_ev1");
      expect((object["hub:payload"] as Record<string, unknown>).attendance).toEqual({ count: 3 });
    }
  });

  it("keeps the Event's properties for a public reader; only the payload is projected", () => {
    const doc = toActivity(eventOf("civic.event.going", PLACE_STATE, { attendance: { count: 3 }, internal: "x" }));
    const projected = projectDocumentPayload(doc, "civic.event.going");
    const object = projected.object as Record<string, unknown>;
    expect(object.startTime).toBe("2030-06-01T17:00:00.000Z");
    expect(object.location).toEqual(PLACE_STATE.location);
    expect(Object.keys(object["hub:payload"] as Record<string, unknown>).sort()).toEqual(["attendance", "process"]);
  });

  it("leaves the hub's own created event a civic:Process, with no vocabulary beyond the civic profile", () => {
    const created = { ...eventOf("civic.process.created", PLACE_STATE), data: { process: { type: "civic.event", title: "Neighbours' evening" } } };
    const doc = toActivity(created);
    expect((doc.object as Record<string, unknown>).type).toBe("civic:Process");
    expect(doc["@context"]).toEqual([AS2, "https://civic.social/ns/civic", { hub: "https://www.civic.social/ns/civic-hub#" }]);
  });

  it("0.3.0: its picture as an AS2 Image, its zone and its limit in Mobilizon's terms, each declared in the @context", () => {
    const doc = toActivity(eventOf("civic.event.going", SEASON_STATE, { attendance: { count: 13 } }, 13));
    const object = doc.object as Record<string, unknown>;
    expect(object.image).toEqual({
      type: "Image",
      url: "https://store.example/hub/types/civic.event/2030/05/pic.webp",
      mediaType: "image/webp",
      name: "The community room set for dinner",
    });
    expect(object.timezone).toBe("America/Chicago");
    expect(object.maximumAttendeeCapacity).toBe(40);
    expect(object.remainingAttendeeCapacity).toBe(27);
    expect(doc["@context"]).toContainEqual({
      mz: "https://mobilizon.org/ns#",
      sc: "http://schema.org/",
      timezone: { "@id": "mz:timezone", "@type": "sc:Text" },
      maximumAttendeeCapacity: "sc:maximumAttendeeCapacity",
      remainingAttendeeCapacity: "sc:remainingAttendeeCapacity",
    });
    expect(unresolved(doc)).toEqual([]);
  });

  it("0.3.0: an event with only a zone carries only the zone's term; one with none keeps the document it had", () => {
    const zoned = toActivity(eventOf("civic.event.published", { ...PLACE_STATE, time_zone: "Europe/Paris" }));
    expect(zoned["@context"]).toContainEqual({ mz: "https://mobilizon.org/ns#", sc: "http://schema.org/", timezone: { "@id": "mz:timezone", "@type": "sc:Text" } });
    const object = zoned.object as Record<string, unknown>;
    for (const absent of ["image", "maximumAttendeeCapacity", "remainingAttendeeCapacity"]) expect(object, absent).not.toHaveProperty(absent);
    expect(unresolved(zoned)).toEqual([]);
    const plain = toActivity(eventOf("civic.event.published", PLACE_STATE));
    expect(plain["@context"]).toEqual([AS2, "https://civic.social/ns/civic", ICAL_CONTEXT, SCHEMA_ADDRESS_CONTEXT, { hub: "https://www.civic.social/ns/civic-hub#" }]);
  });

  it("an announcement to the people going: a Create of a Note on the Event, to the admins' audience, its words not on the wire", () => {
    const e = { ...eventOf("civic.event.announced", SEASON_STATE, { announcement: { recipients: 12 } }), meta: { visibility: "restricted" as const } };
    const doc = toActivity(e);
    expect(doc.type).toBe("Create");
    const object = doc.object as Record<string, unknown>;
    expect(object.type).toBe("Note");
    expect(object.inReplyTo).toBe("https://app.hub.example/process/proc_ev1");
    expect(doc.to).not.toContain("https://www.w3.org/ns/activitystreams#Public");
    expect(JSON.stringify(doc)).not.toMatch(/message|subject/);
  });

  it("serializes the past event's close as civic:End on the Event", () => {
    const doc = toActivity(eventOf("civic.process.ended", PLACE_STATE));
    expect(doc.type).toBe("civic:End");
    expect((doc.object as Record<string, unknown>).type).toBe("Event");
  });
});
