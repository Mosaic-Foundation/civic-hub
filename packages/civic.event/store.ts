// What Events keeps beyond each event's process: the calendar (one row per
// published event, by date) and who is going, on the database its host hands
// it (its granted tables only; the hub in scope's rows only).

import { HubDbError, readAll, storeSlot, type GrantedDb } from "@civic-social/plugin-sdk";
import type { EventLocation } from "./event.js";

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
  /** Put a submitted draft back to drafting, for a revision an admin asked for. */
  reopenDraft(draftId: string): Promise<void>;
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

    async reopenDraft(draftId) {
      await db().from("calendar_drafts").update({ status: "drafting" }).eq("id", draftId);
    },
  };
}
