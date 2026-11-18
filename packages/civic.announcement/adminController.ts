// Announcement moderation (Slice 11): remove and restore an announcement.
// Admin-only; each emits a `civic.process.updated` event with
// `meta.visibility = "restricted"`, which the moderation log
// (src/controllers/moderationController.ts) reads back.

import {
  NotFoundError,
  ValidationError,
  route,
  processesOf,
  emitEvent,
  getAuthUser,
} from "@civic-social/plugin-sdk";
import {
  boardView,
  getAdminReadModel,
  removeAnnouncement,
  restoreAnnouncement,
  type AnnouncementProcessState,
} from "./api.js";

import type { Request, Response } from "express";
import { applyPin, readPin } from "./controller.js";
import { PINNED_MAX } from "./board.js";

function readReason(body: unknown): string {
  const b = body as { reason?: unknown } | null | undefined;
  if (!b || typeof b.reason !== "string") return "";
  return b.reason;
}

/** Announcements' own processes, through the kernel (called where used: ADR-017). */
const announcements = () => processesOf("civic.announcement");

function getState(record: { state: Record<string, unknown> }): AnnouncementProcessState {
  return record.state as unknown as AnnouncementProcessState;
}

export const handleRemoveAnnouncement = route(async (req, res) => {
  const admin = getAuthUser(res);
  const id = req.params.id as string;
  const reason = readReason(req.body);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("reason is required (string)");
  }
  const record = await announcements().get(id);
  if (!record) {
    throw new NotFoundError("Announcement not found");
  }
  const state = getState(record);
  await removeAnnouncement(state, admin.id, reason, {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  });
  await announcements().saveState(record);
  res.json(
    getAdminReadModel(state, { id: record.id, createdAt: record.createdAt }),
  );
});

export const handleRestoreAnnouncement = route(async (req, res) => {
  const admin = getAuthUser(res);
  const id = req.params.id as string;
  const record = await announcements().get(id);
  if (!record) {
    throw new NotFoundError("Announcement not found");
  }
  const state = getState(record);
  await restoreAnnouncement(state, admin.id, {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  });
  await announcements().saveState(record);
  res.json(
    getAdminReadModel(state, { id: record.id, createdAt: record.createdAt }),
  );
});

// --- Admin → Announcements (pinned and urgent; Adam, 2026-11-15) -----------

/** How many announcements the admin tab lists below the pinned ones. */
const ADMIN_LIST_MAX = 100;

/**
 * GET /admin/announcements: the admin tab. `pinned` is every announcement
 * pinned or urgent right now (urgent first, then newest first, as the card);
 * `recent` the newest others, for pinning. Removed ones are left out.
 */
export const handleAdminListAnnouncements = route(async (_req, res) => {
  const all = await announcements().list();
  const now = Date.now();
  const rows = all
    .filter((p) => !getState(p).moderation?.removed)
    .map((p) => {
      const state = getState(p);
      return {
        id: p.id,
        title: state.content.title,
        author_role: state.author_role,
        author_display_name: state.author_display_name ?? null,
        created_at: state.created_at ?? p.createdAt,
        pinned_at: state.pinned_at ?? null,
        ...boardView(state, now),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const onBoard = rows
    .filter((r) => r.pinned || r.urgent)
    // As the card orders them: urgent first, then newest first.
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.created_at.localeCompare(a.created_at));
  const recent = rows.filter((r) => !r.pinned && !r.urgent).slice(0, ADMIN_LIST_MAX);
  res.json({
    pinned: onBoard,
    recent,
    pinned_count: onBoard.filter((r) => r.pinned).length,
    pinned_max: PINNED_MAX,
  });
});

async function pinRoute(req: Request, res: Response, pinned: boolean) {
  const admin = getAuthUser(res);
  const id = req.params.id as string;
  const record = await announcements().get(id);
  if (!record) {
    throw new NotFoundError("Announcement not found");
  }
  const pin = pinned ? readPin({ ...(req.body ?? {}), pinned: true }) ?? { pinned: true, until: null } : { pinned: false, until: null };
  const changed = await applyPin(record, admin.id, pin);
  if (changed) await announcements().saveState(record);
  res.json(getAdminReadModel(getState(record), { id: record.id, createdAt: record.createdAt }));
}

/** POST /admin/announcements/:id/pin { pinned_until?: ISO | null } */
export const handlePinAnnouncement = route((req, res) => pinRoute(req, res, true));

/** POST /admin/announcements/:id/unpin */
export const handleUnpinAnnouncement = route((req, res) => pinRoute(req, res, false));
