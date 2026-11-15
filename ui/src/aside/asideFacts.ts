// GET /api/aside, read once per page load and shared (ADR-019): the right
// column's cards and the urgent line across the top of the pages
// (UrgentLine.tsx) read the same answer, so a page draws both for one
// request. refreshAside() reads it again, after an admin pins or unpins or an
// announcement's urgent label changes.

import { getAside, type AsideFacts } from "../services/api";

const CHANGED = "civic:aside-changed";
let pending: Promise<AsideFacts | null> | null = null;

/** The right column's facts; null when the read failed (an aside never shows an error). */
export function loadAsideFacts(): Promise<AsideFacts | null> {
  return (pending ??= getAside().catch(() => null));
}

/** Forget the facts and tell every reader to read them again. */
export function refreshAside(): void {
  pending = null;
  window.dispatchEvent(new Event(CHANGED));
}

/** Call `fn` when the facts change; returns the unsubscribe. */
export function onAsideChanged(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
