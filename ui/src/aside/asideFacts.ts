// GET /api/aside, read once per page load and shared (ADR-019): the right
// column's kernel cards read the same answer. (The Pinned card and the urgent
// line read the Pinning plugin's own GET /pins, features/pinning/ui/api.ts.)

import { getAside, type AsideFacts } from "../services/api";

let pending: Promise<AsideFacts | null> | null = null;

/** The right column's facts; null when the read failed (an aside never shows an error). */
export function loadAsideFacts(): Promise<AsideFacts | null> {
  return (pending ??= getAside().catch(() => null));
}
