/**
 * The home feed's reader of the public stream (ui/src/services/wireFeed.ts)
 * stops after a few requests once it has a card (2026-11-12), so a hub whose
 * newest activity is mostly hidden shows its first cards at once instead of
 * reading the whole log first. Checks, against a fake /events of 100 per page:
 *   - a page reads at most 3 requests once it holds a card, and says there is more;
 *   - a page with no card yet keeps reading until it finds one (never "empty" with more to come);
 *   - paging on hands out every card, newest first, each once, then says done;
 *   - a hub whose cards are dense still reads one request for a full page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CivicEvent } from "../../src/models/event.js";
import { toActivity } from "../../src/events/activitySerializer.js";
import { classifyActivity } from "../../src/shared/feedActivity.js";

const WIRE = { hostname: "athens.civic.social", process_hostname: "athens.civic.social", actor_hostname: "athens.civic.social" };

let log: unknown[] = [];
let shown = new Set<string>();
let requests = 0;

vi.mock("../../ui/src/services/api", () => ({
  FEED_PAGE_SIZE: 25,
  getEventsPage: async (cursor: string | null, limit: number) => {
    requests++;
    const start = cursor ? Number(cursor) : 0;
    const end = start + limit;
    return {
      orderedItems: log.slice(start, end),
      ...(end < log.length ? { next: `https://athens.civic.social/events?cursor=${end}` } : {}),
    };
  },
  getFeedMeta: async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, shown.has(id) ? { type: "civic.vote" } : { hidden: true }])),
}));

const { WireFeedReader } = await import("../../ui/src/services/wireFeed");

function procId(n: number): string {
  return `proc_${n.toString(16).padStart(16, "0")}`;
}

/** A log of `total` events, newest first; the events at `cardAt` belong to shown processes. */
function seed(total: number, cardAt: number[]): void {
  const cards = new Set(cardAt);
  shown = new Set();
  log = [];
  for (let i = 0; i < total; i++) {
    const process_id = procId(i);
    if (cards.has(i)) shown.add(process_id);
    const e = {
      id: `evt_${i.toString(16).padStart(16, "0")}`,
      version: "1.0",
      event_type: "civic.process.started",
      timestamp: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
      process_id,
      actor: "user_0123456789abcdef",
      jurisdiction: "us-va-athens",
      action_url: `https://athens.civic.social/process/${process_id}`,
      source: { hub_id: "athens", hub_url: "https://athens.civic.social" },
      data: { process: { type: "civic.vote", title: `Vote ${i}` } },
      meta: { visibility: "public" },
      wire: WIRE,
    } as unknown as CivicEvent;
    log.push(toActivity(e));
  }
  requests = 0;
}

describe("WireFeedReader", () => {
  beforeEach(() => {
    requests = 0;
  });

  it("the fixture's events are cards", () => {
    seed(1, [0]);
    const e = { event_type: "civic.process.started", data: { process: { type: "civic.vote" } } } as unknown as CivicEvent;
    expect(classifyActivity(e)).not.toBeNull();
  });

  it("a full page of dense cards is one request", async () => {
    seed(629, Array.from({ length: 629 }, (_, i) => i));
    const page = await new WireFeedReader().page(25);
    expect(page.events).toHaveLength(25);
    expect(requests).toBe(1);
    expect(page.done).toBe(false);
  });

  it("stops after 3 requests once it has a card, and pages on to every card", async () => {
    // A smoke-like hub: 3,000 events, two cards near the top, one deep down.
    seed(3000, [5, 150, 2500]);
    const reader = new WireFeedReader();
    const first = await reader.page(25);
    expect(requests).toBe(3);
    expect(first.events.map((e) => e.process_id)).toEqual([procId(5), procId(150)]);
    expect(first.done).toBe(false);

    const seen = [...first.events];
    let done = first.done;
    let pages = 1;
    while (!done && pages < 50) {
      const next = await reader.page(25);
      seen.push(...next.events);
      done = next.done;
      pages++;
    }
    expect(done).toBe(true);
    expect(seen.map((e) => e.process_id)).toEqual([procId(5), procId(150), procId(2500)]);
    expect(requests).toBe(30);
  });

  it("a page with no card yet keeps reading until it finds one", async () => {
    seed(3000, [2500]);
    const page = await new WireFeedReader().page(25);
    expect(page.events.map((e) => e.process_id)).toEqual([procId(2500)]);
    expect(requests).toBe(26);
  });

  it("a hub with no cards at all reads to the end and says done", async () => {
    seed(450, []);
    const page = await new WireFeedReader().page(25);
    expect(page.events).toHaveLength(0);
    expect(page.done).toBe(true);
    expect(requests).toBe(5);
  });
});
