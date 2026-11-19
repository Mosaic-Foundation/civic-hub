// The Admin digest plugin's table, `admin_digest_marks` (migration
// 20261017000000; the plugin's since kernel step 4): where the last digest that
// went out covered up to, one row per space, through the plugin's own grant.

import { HubDbError, type FeatureHost } from "../../src/sdk/index.js";

export interface MarkStore {
  /** Where the last digest that went out covered up to; null when none has. */
  readMark(): Promise<string | null>;
  /**
   * Move the mark from `from` (null: there is none yet) to `to`, only if it is
   * still at `from`. False when another run moved it first.
   */
  moveMark(from: string | null, to: string): Promise<boolean>;
  /** Give a claimed window back: the mark returns to where it was. */
  releaseMark(claimed: string, previous: string | null): Promise<void>;
}

export function markStore(host: Pick<FeatureHost, "db">): MarkStore {
  const table = () => host.db().from("admin_digest_marks");
  return {
    async readMark() {
      const row = await table().select<{ covered_until: string }>("covered_until").maybeSingle();
      return row?.covered_until ?? null;
    },
    async moveMark(from, to) {
      if (from === null) {
        try {
          await table().insert({ covered_until: to, updated_at: new Date().toISOString() });
          return true;
        } catch (err) {
          if (err instanceof HubDbError && err.code === "23505") return false;
          throw err;
        }
      }
      const moved = await table()
        .update({ covered_until: to, updated_at: new Date().toISOString() })
        .eq("covered_until", from)
        .select<{ covered_until: string }>("covered_until");
      return moved.length > 0;
    },
    async releaseMark(claimed, previous) {
      if (previous === null) {
        await table().delete().eq("covered_until", claimed);
      } else {
        await table().update({ covered_until: previous, updated_at: new Date().toISOString() }).eq("covered_until", claimed);
      }
    },
  };
}
