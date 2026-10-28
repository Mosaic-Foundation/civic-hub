// What the SDK tour keeps in its own tables, on the database its host hands it
// (its granted tables only).

import { HubDbError, generateId, readAll, storeSlot, type GrantedDb } from "@civic-social/plugin-sdk";

/** What a draft is filled from: the tour as it is published. */
export interface LiveTour {
  title: string;
  description: string;
  place: string;
}

export interface SdkTourStore {
  /** Record a mark. "already": this resident had. */
  addMark(processId: string, userId: string): Promise<"ok" | "already">;
  /** Record a join. "already": this resident had. */
  addJoin(processId: string, userId: string): Promise<"ok" | "already">;
  /** The accounts that joined, earliest first: for the hub's name lookup only (namesFor), never served. */
  joinedAccounts(processId: string): Promise<string[]>;
  hasJoined(processId: string, userId: string): Promise<boolean>;
  markCount(processId: string): Promise<number>;
  /** Keep the tour's place as last edited (written by onEdited). */
  upsertPlace(processId: string, place: string): Promise<void>;
  /** Put a submitted draft back to drafting, for a revision an admin asked for. */
  reopenDraft(draftId: string): Promise<void>;
  /** A new draft owned by `userId`, filled from a live tour. Its id. */
  draftFromTour(userId: string, tour: LiveTour): Promise<string>;
  /** Fill an existing draft from the live tour again and clear its check. */
  syncDraft(draftId: string, tour: LiveTour): Promise<void>;
}

export const sdkTourStore = storeSlot<SdkTourStore>("example.sdk_tour");

export function createSdkTourStore(db: () => GrantedDb): SdkTourStore {
  async function insertOnce(table: "sdk_tour_marks" | "sdk_tour_joins", processId: string, userId: string): Promise<"ok" | "already"> {
    try {
      await db().from(table).insert({ process_id: processId, user_id: userId });
      return "ok";
    } catch (err) {
      if (err instanceof HubDbError && err.code === "23505") return "already";
      throw err;
    }
  }

  return {
    addMark: (processId, userId) => insertOnce("sdk_tour_marks", processId, userId),
    addJoin: (processId, userId) => insertOnce("sdk_tour_joins", processId, userId),

    async joinedAccounts(processId) {
      const rows = await readAll((from, to) =>
        db()
          .from("sdk_tour_joins")
          .select<{ user_id: string }>("user_id")
          .eq("process_id", processId)
          .order("joined_at", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to),
      );
      return rows.map((r) => r.user_id);
    },

    async hasJoined(processId, userId) {
      return (await db().from("sdk_tour_joins").count().eq("process_id", processId).eq("user_id", userId)) > 0;
    },

    async markCount(processId) {
      return db().from("sdk_tour_marks").count().eq("process_id", processId);
    },

    async upsertPlace(processId, place) {
      await db()
        .from("sdk_tour_places")
        .upsert({ process_id: processId, place, updated_at: new Date().toISOString() }, { onConflict: "hub_id,process_id" });
    },

    async draftFromTour(userId, tour) {
      const id = generateId("sdtdraft");
      await db().from("sdk_tour_drafts").insert({ id, user_id: userId, status: "drafting", title: tour.title, description: tour.description, place: tour.place });
      return id;
    },

    async syncDraft(draftId, tour) {
      await db()
        .from("sdk_tour_drafts")
        .update({
          title: tour.title,
          description: tour.description,
          place: tour.place,
          status: "drafting",
          last_review_result: null,
          coc_checked_hash: null,
          draft_modified_since_review: false,
        })
        .eq("id", draftId);
    },

    async reopenDraft(draftId) {
      await db().from("sdk_tour_drafts").update({ status: "drafting" }).eq("id", draftId);
    },
  };
}
