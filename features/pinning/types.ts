// The Pinning plugin's answers, as plain data: what its routes send and its
// UI reads (./service.ts writes them, ./ui/api.ts reads them).

/** One row of the Pinned card. */
export interface BoardRow {
  process_id: string;
  title: string;
  /** ISO: when the item was made (the card orders by it, after urgent). */
  published_at: string;
  url: string;
  /** Its type's word ("Vote"). */
  type_label: string;
  urgent?: true;
  sample?: true;
}

/** An item's pin as readers see it: an end date that has passed reads as unpinned. */
export interface PinView {
  id: string;
  pinned: boolean;
  pinned_until: string | null;
  urgent: boolean;
}

/** One row of Admin → Pinned. */
export interface PinnedRow {
  id: string;
  type: string;
  type_label: string;
  title: string;
  url: string;
  pinned_at: string | null;
  pinned_until: string | null;
  urgent: boolean;
}
