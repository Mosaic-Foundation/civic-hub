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
  getAdminReadModel,
  removeAnnouncement,
  restoreAnnouncement,
  type AnnouncementProcessState,
} from "./api.js";


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
