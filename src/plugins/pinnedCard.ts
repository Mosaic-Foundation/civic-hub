// What a plugin adds to the hub's Pinned card (pinning phase 2, Adam,
// 2026-11-18). Pinning is the kernel's: an admin pins any item, the hub keeps
// the pins (process_pins, src/services/pins.ts), and no plugin writes pin code.
// A plugin may still put its own items on the card, above the pins: the
// Announcements plugin's urgent announcements. And when the card would be
// empty, a plugin may offer a few items to fill it (the newest announcements).
//
// The kernel calls these for the hub in scope, only while the plugin is on,
// and draws the rows; it names no plugin. An item flagged `urgent` is also
// the line across the top of the hub's pages (the first one).

/** One row a plugin puts on the Pinned card. */
export interface PinnedCardItem {
  process_id: string;
  title: string;
  /** ISO: when it was published (the card orders by it). */
  published_at: string;
  /** Its page, a local path ("/announcement/proc_…"). */
  url: string;
  /** The red Urgent label, and a candidate for the line across the top of the pages. */
  urgent?: true;
  /** Its end date (ISO), when it has one: shown to admins on Admin → Pinned. */
  until?: string | null;
  sample?: true;
}

export interface PluginPinnedCard {
  /** Its items for the top of the card, right now (each with its own rule for "now"). */
  first(): Promise<PinnedCardItem[]>;
  /**
   * A few items for the card when nothing is pinned and no plugin has one for
   * the top. `isAdmin`: the reader is an admin (who sees what the feed shows an admin).
   */
  fill?(opts: { isAdmin: boolean }): Promise<PinnedCardItem[]>;
}
