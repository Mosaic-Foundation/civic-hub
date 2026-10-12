// Admin archive controller — generic soft-remove / restore across process
// types (meeting summaries, announcements, votes, proposals, projects,
// conversations). Archiving flips the process to "archived" (hidden from the
// public list, direct fetch, feed, and digest) while keeping it restorable.
// See processService.archiveProcess / restoreProcess for the data model.

import { route } from "../http/route.js";
import {
  archiveProcess,
  restoreProcess,
  getArchivedProcesses,
} from "../services/processService.js";
import { getProcessHandler } from "../processes/registry.js";
import { getAuthUser } from "../middleware/auth.js";

// --- POST /admin/processes/:id/archive -------------------------------------

export const handleArchiveProcess = route(async (req, res) => {
  const adminId = getAuthUser(res).id;
  const id = req.params.id as string;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason : "";

  const process = await archiveProcess(id, adminId, reason);
  res.json({
    message: "Archived.",
    id: process.id,
    status: process.status,
  });
});

// --- POST /admin/processes/:id/restore -------------------------------------

export const handleRestoreProcess = route(async (req, res) => {
  const adminId = getAuthUser(res).id;
  const id = req.params.id as string;
  const process = await restoreProcess(id, adminId);
  res.json({
    message: "Restored.",
    id: process.id,
    status: process.status,
  });
});

// --- GET /admin/archived ----------------------------------------------------

export const handleListArchivedProcesses = route(async (_req, res) => {
  const archived = await getArchivedProcesses();
  const items = archived.map((p) => {
    const archive = (p.state?.archive ?? {}) as Record<string, unknown>;
    return {
      id: p.id,
      type: p.definition.type,
      title: p.title,
      archived_at: (archive.archived_at as string) ?? p.updatedAt,
      archived_by: (archive.archived_by as string) ?? null,
      reason: (archive.reason as string) ?? null,
      previous_status: (archive.previous_status as string) ?? null,
      // Best-effort human label for the type, reusing the handler registry.
      type_label: getProcessHandler(p.definition.type)?.type ?? p.definition.type,
    };
  });
  res.json({ items, count: items.length });
});
