// Moderation controller (Slice 11).
//
// Two admin-only actions, both emitting `civic.process.updated` events
// with `meta.visibility = "restricted"` so they never reach the public
// /events feed or the resident-facing digest:
//
//   - hide / restore a comment (civic.input)
//   - remove / restore an announcement (civic.announcement)
//
// A read-only moderation log lists every restricted moderation event,
// newest first. Public consumers never see these events; admins do via
// /admin/moderation/log.

import { NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import {
  getInputById,
  hideComment,
  restoreComment,
} from "../modules/civic.input/index.js";
import {
  getAdminReadModel,
  removeAnnouncement,
  restoreAnnouncement,
  type AnnouncementProcessState,
} from "../modules/civic.announcement/index.js";
import {
  getProcess,
  saveProcessState,
} from "../services/processService.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getModerationEvents } from "../events/eventStore.js";
import { getAuthUser } from "../middleware/auth.js";

function readReason(body: unknown): string {
  const b = body as { reason?: unknown } | null | undefined;
  if (!b || typeof b.reason !== "string") return "";
  return b.reason;
}

// --- Comments --------------------------------------------------------

export const handleHideComment = route(async (req, res) => {
  const admin = getAuthUser(res);
  const commentId = req.params.commentId as string;
  const reason = readReason(req.body);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("reason is required (string)");
  }
  const existing = await getInputById(commentId);
  if (!existing) {
    throw new NotFoundError("Comment not found");
  }
  const process = await getProcess(existing.process_id);
  if (!process) {
    throw new NotFoundError("Parent process not found");
  }
  const updated = await hideComment(commentId, admin.id, reason, {
    jurisdiction: process.jurisdiction,
    emit: emitEvent,
  });
  res.json(updated);
});

export const handleRestoreComment = route(async (req, res) => {
  const admin = getAuthUser(res);
  const commentId = req.params.commentId as string;
  const existing = await getInputById(commentId);
  if (!existing) {
    throw new NotFoundError("Comment not found");
  }
  const process = await getProcess(existing.process_id);
  if (!process) {
    throw new NotFoundError("Parent process not found");
  }
  const updated = await restoreComment(commentId, admin.id, {
    jurisdiction: process.jurisdiction,
    emit: emitEvent,
  });
  res.json(updated);
});

// --- Announcements ---------------------------------------------------

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
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.announcement") {
    throw new NotFoundError("Announcement not found");
  }
  const state = getState(record);
  await removeAnnouncement(state, admin.id, reason, {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  });
  await saveProcessState(record);
  res.json(
    getAdminReadModel(state, { id: record.id, createdAt: record.createdAt }),
  );
});

export const handleRestoreAnnouncement = route(async (req, res) => {
  const admin = getAuthUser(res);
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.announcement") {
    throw new NotFoundError("Announcement not found");
  }
  const state = getState(record);
  await restoreAnnouncement(state, admin.id, {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  });
  await saveProcessState(record);
  res.json(
    getAdminReadModel(state, { id: record.id, createdAt: record.createdAt }),
  );
});

// --- Moderation log --------------------------------------------------

interface ModerationLogEntry {
  event_id: string;
  timestamp: string;
  process_id: string;
  process_title: string | null;
  action: string;
  target_kind: "comment" | "announcement" | "process" | null;
  reason: string | null;
  admin: string;
}

/**
 * GET /admin/moderation/log — list every moderation event, newest
 * first. Admins-only (gated by requireAdmin in the route layer). Each
 * entry comes from a `civic.process.updated` event with
 * `data.moderation` populated and `meta.visibility = "restricted"`.
 *
 * Process title is best-effort: we look it up per unique process_id
 * once. Removed/deleted processes resolve to null and the UI shows the
 * raw process_id.
 */
export const handleGetModerationLog = route(async (_req, res) => {
  // Asks the database for moderation events only, every one of them
  // (paged). It read the whole log until 2026-10-07, which the server cut
  // at the newest 1,000 events, so older actions fell off the log.
  const moderationEvents = await getModerationEvents();

  // Cache process lookups so we don't re-fetch the same one per event.
  const titleCache = new Map<string, string | null>();
  async function lookupTitle(pid: string): Promise<string | null> {
    if (titleCache.has(pid)) return titleCache.get(pid) ?? null;
    try {
      const record = await getProcess(pid);
      const title = record?.title ?? null;
      titleCache.set(pid, title);
      return title;
    } catch {
      titleCache.set(pid, null);
      return null;
    }
  }

  const log: ModerationLogEntry[] = [];
  for (const ev of moderationEvents) {
    const data = ev.data as {
      moderation?: {
        action?: string;
        reason?: string;
        target?: { comment_id?: string };
      };
    };
    const action = data.moderation?.action ?? "unknown";
    const targetKind: ModerationLogEntry["target_kind"] = action.startsWith(
      "comment_",
    )
      ? "comment"
      : action.startsWith("announcement_")
        ? "announcement"
        : action.startsWith("process_")
          ? "process"
          : null;
    const title = await lookupTitle(ev.process_id);
    log.push({
      event_id: ev.id,
      timestamp: ev.timestamp,
      process_id: ev.process_id,
      process_title: title,
      action,
      target_kind: targetKind,
      reason: data.moderation?.reason ?? null,
      admin: ev.actor,
    });
  }

  res.json({ entries: log, count: log.length });
});
