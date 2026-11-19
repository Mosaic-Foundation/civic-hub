// The Pinning plugin's calls (features/pinning/routes.ts), and its one shared
// read of the card: the Pinned card, the urgent line and each Pin button read
// the same GET /pins, once per page load, and read it again after a change.

import { request } from "../../../ui/src/services/http";
import type { BoardRow, PinnedRow, PinView } from "../types";

export type { BoardRow, PinnedRow, PinView };

export interface Board {
  items: BoardRow[];
  /** The newest urgent pin, for the line across the top of the pages. */
  urgent: BoardRow | null;
  /** The reader may pin (the space's "Who can pin" setting). */
  can_pin: boolean;
}

const CHANGED = "civic:pins-changed";
let pending: Promise<Board | null> | null = null;

/** The card; null when the read failed (an aside never shows an error). */
export function loadBoard(): Promise<Board | null> {
  return (pending ??= request<Board>("GET", "/pins").catch(() => null));
}

/** Forget the card and tell every reader to read it again. */
export function refreshBoard(): void {
  pending = null;
  window.dispatchEvent(new Event(CHANGED));
}

/** Call `fn` when the pins change; returns the unsubscribe. */
export function onBoardChanged(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

export function getPin(id: string): Promise<PinView> {
  return request("GET", `/pins/${id}`);
}

/** Pin an item, or change its end date (ISO or null) or urgent flag. */
export function pinItem(id: string, change: { pinned_until: string | null; urgent: boolean }): Promise<PinView> {
  return request("POST", `/pins/${id}`, change);
}

export function unpinItem(id: string): Promise<PinView> {
  return request("DELETE", `/pins/${id}`);
}

/** Admin → Pinned: everything pinned now, urgent first; the count against the cap. */
export function adminListPins(): Promise<{ items: PinnedRow[]; pinned_count: number; pinned_max: number }> {
  return request("GET", "/admin/pins");
}
