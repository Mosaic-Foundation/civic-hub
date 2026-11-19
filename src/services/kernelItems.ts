// items: any item on the space as a feature plugin reads it (kernel step 4,
// docs/KERNEL.md rule 5: the kernel offers services, plugins offer features).
// A plugin that works on items of every type, such as Pinning, reads them
// here: what an item is called, its page, its type's word, whether readers
// see it right now. Never who made it, never its votes or inputs.
//
// "Public" is what the feed would show anyone: not held back, archived or
// otherwise not public (processLifecycle's NON_PUBLIC_STATUSES), its type's
// plugin on, not removed by moderation.

import { publicCardRows, type CardRow } from "./processRows.js";
import { isProcessTypeEnabled } from "./pluginGate.js";
import { getManifest } from "../processes/registry.js";

/** One item as a feature plugin sees it. */
export interface ItemSummary {
  id: string;
  type: string;
  /** Its type's one word ("Vote"). */
  type_label: string;
  title: string;
  /** Its page, a local path ("/vote/proc_…"). */
  url: string;
  /** ISO: when it was made. */
  created_at: string;
  /** Sample content a reader is told is a sample (not one an admin added in demo). */
  sample: boolean;
  /** Its type's plugin is on. */
  on: boolean;
  /** Removed by moderation (kept, not shown). */
  removed: boolean;
}

type Removable = { moderation?: { removed?: boolean } | null };

function summaryOf(row: CardRow): ItemSummary {
  const state = row.state as { content?: { title?: string }; created_at?: string } & Removable;
  const manifest = getManifest(row.type);
  return {
    id: row.id,
    type: row.type,
    type_label: manifest?.descriptor.display.label ?? row.type,
    title: state.content?.title || row.title,
    url: manifest?.detailPath(row.id) ?? `/process/${row.id}`,
    created_at: state.created_at ?? row.created_at,
    sample: row.is_sample && !row.added_in_demo,
    on: isProcessTypeEnabled(row.type),
    removed: Boolean(state.moderation?.removed),
  };
}

export const items = {
  /**
   * These items, the ones not held back or archived, in no set order. An id
   * that is not here, or not public, is left out. Read `on` and `removed`
   * before showing one.
   */
  async publicSummaries(ids: readonly string[]): Promise<ItemSummary[]> {
    if (ids.length === 0) return [];
    return (await publicCardRows([...ids])).map(summaryOf);
  },
  /** One item readers see right now (public, its plugin on, not removed), or null; `removed` is still read. */
  async publicSummary(id: string): Promise<ItemSummary | null> {
    const [one] = await items.publicSummaries([id]);
    return one && one.on ? one : null;
  },
};
