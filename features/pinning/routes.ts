// The Pinning plugin's routes (Adam, 2026-11-18; a plugin since kernel step
// 4). Each behind the plugin's switch (the host mounts them so).
//
//   GET    /pins          the Pinned card: { items, urgent, can_pin }
//   GET    /pins/:id      an item's pin, for its Pin button
//   POST   /pins/:id      pin it, or change it: { pinned_until?: ISO | null, urgent?: boolean }
//   DELETE /pins/:id      unpin it
//   GET    /admin/pins    Admin → Pinned: everything pinned now (admins)
//
// Who may pin is the space's setting (./rules.ts): admins, or every member.

import { Router, type Request, type RequestHandler } from "express";
import {
  getAuthUser,
  getSettingSync,
  requireAdmin,
  requireResident,
  resolveCallerIsAdmin,
  resolveCallerUser,
  route,
  ValidationError,
} from "../../src/sdk/index.js";
import { WHO_CAN_PIN_KEY, whoCanPinOf } from "./rules.js";
import { listPinned, pinItem, readBoard, readPinView, unpinItem } from "./service.js";
import type { PinStore } from "./store.js";

/** Who may pin on the space in scope. */
export function whoCanPin() {
  return whoCanPinOf(getSettingSync(WHO_CAN_PIN_KEY));
}

/** Let the request on when its caller may pin. */
const requirePinner: RequestHandler = (req, res, next) => (whoCanPin() === "members" ? requireResident : requireAdmin)(req, res, next);

/** Whether the caller may pin, for the card's answer (never refuses). */
async function callerCanPin(req: Request): Promise<boolean> {
  if (whoCanPin() === "members") return Boolean(await resolveCallerUser(req));
  return resolveCallerIsAdmin(req);
}

/** `pinned_until` from a body (`null` for none). */
export function readUntil(body: unknown): string | null {
  const b = (body ?? {}) as { pinned_until?: unknown };
  if (b.pinned_until === undefined || b.pinned_until === null || b.pinned_until === "") return null;
  if (typeof b.pinned_until !== "string") throw new ValidationError("pinned_until must be a date.");
  return b.pinned_until;
}

/** `urgent` from a body: true, false, or left as it is (undefined). */
export function readUrgent(body: unknown): boolean | undefined {
  const b = (body ?? {}) as { urgent?: unknown };
  if (b.urgent === undefined || b.urgent === null) return undefined;
  if (typeof b.urgent !== "boolean") throw new ValidationError("urgent must be true or false.");
  return b.urgent;
}

export function pinRoutes(store: PinStore): Router {
  const r = Router();
  r.get(
    "/",
    route(async (req, res) => {
      const items = await readBoard(store);
      res.json({ items, urgent: items.find((i) => i.urgent) ?? null, can_pin: await callerCanPin(req) });
    }),
  );
  r.get(
    "/:id",
    requirePinner,
    route(async (req, res) => {
      res.json(await readPinView(store, req.params.id as string));
    }),
  );
  r.post(
    "/:id",
    requirePinner,
    route(async (req, res) => {
      const user = getAuthUser(res);
      res.json(await pinItem(store, req.params.id as string, user.id, { until: readUntil(req.body), urgent: readUrgent(req.body) }));
    }),
  );
  r.delete(
    "/:id",
    requirePinner,
    route(async (req, res) => {
      const user = getAuthUser(res);
      res.json(await unpinItem(store, req.params.id as string, user.id));
    }),
  );
  return r;
}

/** Under /admin, after the admin check. */
export function adminPinRoutes(store: PinStore): Router {
  const r = Router();
  r.get(
    "/",
    route(async (_req, res) => {
      res.json(await listPinned(store));
    }),
  );
  return r;
}
