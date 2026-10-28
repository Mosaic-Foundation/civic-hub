// What Events keeps beyond each event's process: the calendar (one row per
// published event, by date) and who is going, on the database its host hands
// it (its granted tables only; the hub in scope's rows only).

import { HubDbError, generateId, readAll, storeSlot, type GrantedDb } from "@civic-social/plugin-sdk";
import type { EventLocation, EventState } from "./event.js";

export interface CalendarRow {
  process_id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  location: EventLocation;
  cancelled: boolean;
  archived: boolean;
}

export interface EventStore {
  /** Put an event on the calendar, or bring its row up to date. */
  upsertEvent(row: Omit<CalendarRow, "archived">): Promise<void>;
  /** Take an archived event off the calendar, or put a restored one back. */
  setArchived(processId: string, archived: boolean): Promise<void>;
  /** The calendar, earliest first, archived events left out. */
  calendar(): Promise<CalendarRow[]>;
  /** Mark a resident going. "already": they were. */
  addGoing(processId: string, userId: string): Promise<"ok" | "already">;
  /** Take a resident's going back. False: they weren't. */
  removeGoing(processId: string, userId: string): Promise<boolean>;
  isGoing(processId: string, userId: string): Promise<boolean>;
  goingCount(processId: string): Promise<number>;
  /** The accounts going, earliest first: for the hub's name lookup only (namesFor), never served. */
  goingAccounts(processId: string): Promise<string[]>;
  /** Put a submitted draft back to drafting, for a revision an admin asked for. */
  reopenDraft(draftId: string): Promise<void>;
  /** A new draft owned by `userId`, filled from a live event, for the hub's edit path. Its id. */
  draftFromEvent(userId: string, event: LiveEvent): Promise<string>;
  /** Fill an existing draft from the live event again and clear its check (every edit starts from what is published). */
  syncDraft(draftId: string, event: LiveEvent): Promise<void>;
}

/** What a draft is filled from: the event as it is published. */
export interface LiveEvent {
  title: string;
  description: string;
  state: EventState;
}

/** The draft's columns for a live event: its words, times, and place or link. */
function draftColumns(e: LiveEvent): Record<string, unknown> {
  const loc = e.state.location;
  const place = loc.type === "Place" ? loc : null;
  return {
    title: e.title,
    description: e.description,
    start_time: e.state.start_time,
    end_time: e.state.end_time,
    venue: place?.name ?? null,
    street_address: place?.address?.streetAddress ?? null,
    locality: place?.address?.addressLocality ?? null,
    region: place?.address?.addressRegion ?? null,
    postal_code: place?.address?.postalCode ?? null,
    country: place?.address?.addressCountry ?? null,
    online_url: loc.type === "Link" ? loc.href : null,
  };
}

export const eventStore = storeSlot<EventStore>("civic.event");

const COLUMNS = "process_id,title,description,start_time,end_time,location,cancelled,archived";

export function createEventStore(db: () => GrantedDb): EventStore {
  return {
    async upsertEvent(row) {
      await db()
        .from("calendar_events")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "hub_id,process_id" });
    },

    async setArchived(processId, archived) {
      await db().from("calendar_events").update({ archived }).eq("process_id", processId);
    },

    async calendar() {
      return readAll((from, to) =>
        db()
          .from("calendar_events")
          .select<CalendarRow>(COLUMNS)
          .eq("archived", false)
          .order("start_time", { ascending: true })
          .order("process_id", { ascending: true })
          .range(from, to),
      );
    },

    async addGoing(processId, userId) {
      try {
        await db().from("calendar_attendance").insert({ process_id: processId, user_id: userId });
        return "ok";
      } catch (err) {
        if (err instanceof HubDbError && err.code === "23505") return "already";
        throw err;
      }
    },

    async removeGoing(processId, userId) {
      const removed = await db()
        .from("calendar_attendance")
        .delete()
        .eq("process_id", processId)
        .eq("user_id", userId)
        .select<{ user_id: string }>("user_id");
      return removed.length > 0;
    },

    async isGoing(processId, userId) {
      return (await db().from("calendar_attendance").count().eq("process_id", processId).eq("user_id", userId)) > 0;
    },

    async goingCount(processId) {
      return db().from("calendar_attendance").count().eq("process_id", processId);
    },

    async goingAccounts(processId) {
      const rows = await readAll((from, to) =>
        db()
          .from("calendar_attendance")
          .select<{ user_id: string }>("user_id")
          .eq("process_id", processId)
          .order("going_at", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to),
      );
      return rows.map((r) => r.user_id);
    },

    async draftFromEvent(userId, event) {
      const id = generateId("edraft");
      await db().from("calendar_drafts").insert({ id, user_id: userId, status: "drafting", ...draftColumns(event) });
      return id;
    },

    async syncDraft(draftId, event) {
      await db()
        .from("calendar_drafts")
        .update({ ...draftColumns(event), status: "drafting", last_review_result: null, coc_checked_hash: null, draft_modified_since_review: false })
        .eq("id", draftId);
    },

    async reopenDraft(draftId) {
      await db().from("calendar_drafts").update({ status: "drafting" }).eq("id", draftId);
    },
  };
}
