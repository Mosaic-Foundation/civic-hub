/**
 * src/shared/feedWire.ts reads the feed's cards back off GET /events. These
 * checks run every event type the serializer maps, with every process type's
 * payload and the payload shapes the classifier discriminates on, through the
 * real serializer (canonical, member and public views), and require:
 *   - every event that makes a card reads back as the same event, with the
 *     same card (kind, pill, colour, link); an untyped (pre-stamp) event, once
 *     the reader gives it the hub's stored type, as the stored event would;
 *   - nothing that is not that event type reads back as it (no pair is shared).
 */

import { describe, expect, it } from "vitest";
import type { CivicEvent } from "../../src/models/event.js";
import { activityTypeIndex, toActivity } from "../../src/events/activitySerializer.js";
import { redactEvent, toRedactedActivity } from "../../src/events/publicRedaction.js";
import { FEED_EVENT_TYPES, classifyActivity } from "../../src/shared/feedActivity.js";
import { FEED_WIRE_FORMS, fromWireActivity, nextCursorOf } from "../../src/shared/feedWire.js";
import { LEGACY_TYPES, MANIFEST_LIST } from "../../src/shared/processManifests.js";

const WIRE = { hostname: "athens.civic.social", process_hostname: "athens.civic.social", actor_hostname: "athens.civic.social" };

function event(event_type: string, data: Record<string, unknown>, n: number): CivicEvent {
  return {
    id: `evt_${n.toString(16).padStart(16, "0")}`,
    version: "1.0",
    event_type,
    timestamp: "2026-10-24T12:00:00.000Z",
    process_id: "proc_0123456789abcdef",
    actor: "user_0123456789abcdef",
    jurisdiction: "us-va-athens",
    action_url: "https://athens.civic.social/process/proc_0123456789abcdef",
    source: { hub_id: "athens", hub_url: "https://athens.civic.social" },
    data,
    meta: { visibility: "public" },
    wire: WIRE,
  } as unknown as CivicEvent;
}

/** Payloads: none, each process type's discriminator, and the shapes the classifier reads. */
function payloads(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{}];
  for (const m of MANIFEST_LIST) {
    const type = m.descriptor.type;
    out.push({ process: { type, title: "A title" } });
    out.push({
      process: { type: "civic.brief" },
      brief: { source_process_type: type, headline: "A headline" },
      result_of: { iri: "https://athens.civic.social/process/proc_fedcba9876543210", id: "proc_fedcba9876543210", type },
    });
  }
  out.push(
    { announcement: { title: "Hearing", author_role: "admin", author_name: "Pat Admin" } },
    { announcement: { title: "Hearing", author_role: "Planning Committee", author_name: "Sam Member" } },
    { announcement: { title: "Synced", source: { origin: "news" } } },
    { meeting_summary: {}, summary_id: "ms_1" },
    { results_id: "vr_1" },
    // An old vote results event naming its retired type (engine 2, C): same card via legacyTypes.
    { process: { type: "civic.vote_results" }, results_id: "vr_1" },
    { wordcloud_snapshot: {} },
    { action: "official_response", official_name: "Jo Official", process: { type: "civic.brief" } },
    { action: "something_else", process: { type: "civic.vote" } },
    { process: { type: "civic.vote" }, result: { tally: { Yes: 3, No: 1 } } },
  );
  return out;
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function typed(data: Record<string, unknown>): boolean {
  return typeof (data.process as { type?: unknown } | undefined)?.type === "string" || typeof data.process_type === "string";
}

/** The reader's rule for an untyped event (ui/src/services/wireFeed.ts): the hub's stored type. */
function stamp<E extends { data: Record<string, unknown> }>(e: E, type: string): E {
  return typed(e.data) ? e : { ...e, data: { ...e.data, process: { ...(e.data.process as object), type } } };
}

const MAPPED_TYPES = [...new Set(Object.values(activityTypeIndex()).flat())];

describe("feedWire: the feed's cards read back off /events", () => {
  it("lists a wire form for every event type that makes a card", () => {
    for (const t of FEED_EVENT_TYPES) {
      expect(FEED_WIRE_FORMS.some((f) => f.event === t), t).toBe(true);
    }
  });

  it("every card reads back as the same event and the same card, in every view", () => {
    let n = 0;
    let cards = 0;
    for (const eventType of MAPPED_TYPES) {
      for (const data of payloads()) {
        const e = event(eventType, data, ++n);
        const views: Array<[string, Record<string, unknown>, CivicEvent]> = [
          ["admin", toActivity(e), e],
          ["member", toRedactedActivity(e, new Set(), "member"), redactEvent(e, new Set(), "member")],
          ["public", toRedactedActivity(e, new Set(), "public"), redactEvent(e, new Set(), "public")],
        ];
        for (const [view, activity, seen] of views) {
          const card = classifyActivity(seen);
          const back = fromWireActivity(activity);
          const label = `${eventType} ${JSON.stringify(data)} (${view})`;
          if (back) {
            // Nothing reads back as an event it is not.
            expect(back.event_type, label).toBe(eventType);
          }
          if (!card) continue;
          cards += 1;
          expect(back, label).not.toBeNull();
          expect(back!.id, label).toBe(e.id);
          expect(back!.process_id, label).toBe(e.process_id);
          expect(back!.action_url, label).toBe(e.action_url);
          expect(new Date(back!.timestamp).toISOString(), label).toBe(e.timestamp);
          if (typed(data)) {
            expect(classifyActivity(back!), label).toEqual(card);
          } else {
            // An event from before data.process.type: the member and public
            // views do not carry the legacy fields the classifier reads
            // (ADR-010's declared payload), so the reader stamps the type the
            // hub stores for the process (GET /api/feed/meta). With that type
            // known, the stream and the stored event make the same card.
            // The types this event can have been about: those with a card
            // rule of their own for its event type, which make this card from
            // it. The stream reads it the same as each.
            // Retired types count too (engine 2, C): an old results event
            // that predates data.process.type reads as civic.vote_results.
            const types = [...MANIFEST_LIST.map((m) => m.descriptor.type), ...LEGACY_TYPES.map((l) => l.type)].filter(
              (t) => classifyActivity(stamp({ ...seen, data: {} }, t)) !== null && isEqual(classifyActivity(stamp(seen, t)), card),
            );
            expect(types.length, `${label}: some type stores it`).toBeGreaterThan(0);
            for (const t of types) {
              expect(classifyActivity(stamp(back!, t)), `${label} as ${t}`).toEqual(card);
            }
          }
        }
      }
    }
    expect(cards).toBeGreaterThan(50);
  });

  it("a Tombstone, a ballot or anything unlisted is not a card", () => {
    expect(fromWireActivity({ type: "Tombstone", id: "https://h/activities/evt_1" })).toBeNull();
    expect(fromWireActivity({ type: "Create", object: { type: "civic:Ballot" } })).toBeNull();
    expect(fromWireActivity(null)).toBeNull();
    expect(fromWireActivity("Create")).toBeNull();
  });

  it("reads the next page's cursor from a page's next link", () => {
    expect(nextCursorOf({ next: "https://athens.civic.social/events?page=true&cursor=abc123&limit=100" })).toBe("abc123");
    expect(nextCursorOf({})).toBeNull();
    expect(nextCursorOf({ next: "not a url" })).toBeNull();
  });
});
