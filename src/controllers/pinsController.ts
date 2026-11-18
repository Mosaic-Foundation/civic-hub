// Pinning any item (Adam, 2026-11-18; src/services/pins.ts). Admins only:
// the admin router checks the role before these run.
//
//   GET  /admin/pins                 Admin → Pinned: everything pinned or urgent now
//   POST /admin/processes/:id/pin    { pinned_until?: ISO | null }
//   POST /admin/processes/:id/unpin
//
// All three behind the Pinning switch (requirePlugin("pinning")).

import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { ValidationError } from "../errors/index.js";
import { listPinned, pinItem, pinView, unpinItem } from "../services/pins.js";

/** `pinned_until` from a body (`true` for none). */
export function readUntil(body: unknown): string | null {
  const b = (body ?? {}) as { pinned_until?: unknown };
  if (b.pinned_until === undefined || b.pinned_until === null || b.pinned_until === "") return null;
  if (typeof b.pinned_until !== "string") throw new ValidationError("pinned_until must be a date.");
  return b.pinned_until;
}

export const handlePinProcess = route(async (req, res) => {
  const admin = getAuthUser(res);
  const process = await pinItem(req.params.id as string, admin.id, readUntil(req.body));
  res.json({ id: process.id, ...pinView(process) });
});

export const handleUnpinProcess = route(async (req, res) => {
  const admin = getAuthUser(res);
  const process = await unpinItem(req.params.id as string, admin.id);
  res.json({ id: process.id, ...pinView(process) });
});

export const handleListPins = route(async (_req, res) => {
  res.json(await listPinned());
});
