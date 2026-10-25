/**
 * The feed read off the hub's public stream (frontend pass, 2026-10-24).
 *
 * The feed's "All" view reads GET /events, as any outside reader does, and
 * turns each served activity back into the event the card classifier reads
 * (src/shared/feedWire.ts). What a card needs that the stream does not carry
 * comes from the hub's own read, GET /api/feed/meta: whether the hub shows the
 * process (it exists, is not archived or pending, its plugin is on), its type
 * for an event from before data.process.type, its sample flag, and the card
 * metadata /api/feed batches. The rules /api/feed applies on the server are
 * applied here in the same order, so the reader sees the same cards:
 *   - an activity that is not a card, or whose process the hub does not show,
 *     is not one;
 *   - only the newest publication of a process is a card (the stream is read
 *     newest first, so the first one met);
 *   - metadata seeds the cache for the kinds /api/feed batches it for.
 *
 * Carried on /api/feed (Feed.tsx): the filter pills (the stream has no filter
 * by surface), and a hub with sample content (never on the stream).
 */

import { FEED_META_KINDS, classifyActivity } from "../../../src/shared/feedActivity";
import { fromWireActivity, nextCursorOf } from "../../../src/shared/feedWire";
import {
  FEED_PAGE_SIZE,
  getEventsPage,
  getFeedMeta,
  type CivicEvent,
  type FeedProcessMeta,
} from "./api";

const RESULT_PUBLISHED = "civic.process.result_published";
/** Activities per request to /events (its maximum is 200). */
const WIRE_PAGE = 100;

export interface FeedPage {
  events: CivicEvent[];
  processMeta: Record<string, FeedProcessMeta>;
  /** True once the oldest card has been handed out. */
  done: boolean;
}

function hasType(data: Record<string, unknown>): boolean {
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  return typeof nested === "string" || typeof data.process_type === "string";
}

/** One reader of the stream, newest first, handing out a page of cards at a time. */
export class WireFeedReader {
  private cursor: string | null = null;
  private exhausted = false;
  private buffer: CivicEvent[] = [];
  private meta: Record<string, FeedProcessMeta> = {};
  private published = new Set<string>();

  /** A reader at the same place, for a cached first page to continue from. */
  clone(): WireFeedReader {
    const copy = new WireFeedReader();
    copy.cursor = this.cursor;
    copy.exhausted = this.exhausted;
    copy.buffer = [...this.buffer];
    copy.meta = { ...this.meta };
    copy.published = new Set(this.published);
    return copy;
  }

  async page(size = FEED_PAGE_SIZE): Promise<FeedPage> {
    while (this.buffer.length < size && !this.exhausted) await this.readMore();
    const events = this.buffer.splice(0, size);
    const processMeta: Record<string, FeedProcessMeta> = {};
    for (const e of events) if (this.meta[e.process_id]) processMeta[e.process_id] = this.meta[e.process_id]!;
    return { events, processMeta, done: this.exhausted && this.buffer.length === 0 };
  }

  private async readMore(): Promise<void> {
    const page = await getEventsPage(this.cursor, WIRE_PAGE);
    this.cursor = nextCursorOf(page);
    if (!this.cursor) this.exhausted = true;
    const items = Array.isArray(page.orderedItems) ? page.orderedItems : [];
    const read = items.map(fromWireActivity).filter((e) => e !== null);
    const ids = [...new Set(read.map((e) => e.process_id))];
    const facts = ids.length > 0 ? await getFeedMeta(ids) : {};

    for (const w of read) {
      const fact = facts[w.process_id];
      if (!fact || "hidden" in fact) continue;
      // The public stream carries no type for an event from before
      // data.process.type; the hub's own record of the process says it.
      const data = hasType(w.data) ? w.data : { ...w.data, process: { ...(w.data.process as object), type: fact.type } };
      const event: CivicEvent = {
        id: w.id,
        version: "1.0",
        event_type: w.event_type,
        timestamp: w.timestamp,
        process_id: w.process_id,
        actor: "",
        jurisdiction: "",
        action_url: w.action_url,
        source: { hub_id: "", hub_url: "" },
        data,
        meta: { visibility: "public" },
        ...(fact.sample ? { sample: true } : {}),
      };
      const card = classifyActivity(event);
      if (!card) continue;
      if (event.event_type === RESULT_PUBLISHED) {
        if (this.published.has(event.process_id)) continue;
        this.published.add(event.process_id);
      }
      if (fact.meta && FEED_META_KINDS.has(card.kind)) this.meta[event.process_id] = fact.meta;
      this.buffer.push(event);
    }
  }
}
