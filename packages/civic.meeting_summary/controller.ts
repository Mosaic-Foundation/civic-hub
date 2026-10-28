// Meeting-summary controllers — the admin review queue and the public read:
//
//   GET /admin/meeting-summaries            (mounted in adminRoutes.ts)
//   GET /admin/meeting-summaries/:id        (mounted in adminRoutes.ts)
//   PATCH /admin/meeting-summaries/:id      (mounted in adminRoutes.ts)
//   POST /admin/meeting-summaries/:id/approve
//     Admin review queue. Pattern mirrors adminBriefController.
//
//   GET /meeting-summary/:id
//     Public read of published summaries only.
//
// The job that creates the summaries is "meeting_summary",
// ./job.ts.

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  route,
  emitEvent,
  archiveProcess,
  getAllProcesses,
  getProcess,
  saveProcessState,
  getAuthUser,
  enrichCreator,
} from "@civic-social/plugin-sdk/first-party";
import { Request, Response } from "express";
import {
  approveMeetingSummary,
  effectiveQualityFlag,
  FlaggedSummaryError,
  editMeetingSummary,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
  acceptRevision,
  discardRevision,
  type MeetingSummaryApprovalStatus,
  type MeetingSummaryPatch,
  type MeetingSummaryProcessState,
  type SummaryBlock,
} from "./api.js";
import { summaryState } from "./job.js";

function isApprovalStatus(s: string): s is MeetingSummaryApprovalStatus {
  return s === "pending" || s === "approved" || s === "published";
}

// --- Admin surfaces --------------------------------------------------------

export const handleAdminListMeetingSummaries = route(async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const all = await getAllProcesses();
  const summaries = all
    .filter((p) => p.definition.type === "civic.meeting_summary")
    .map((p) =>
      getAdminSummary(summaryState(p), {
        id: p.id,
        title: p.title,
        createdAt: p.createdAt,
      }),
    );

  const filtered =
    statusFilter && isApprovalStatus(statusFilter)
      ? summaries.filter((s) => s.approval_status === statusFilter)
      : summaries;

  // Rank pending first, then approved, then published; newest within each.
  const rank: Record<string, number> = {
    pending: 0,
    approved: 1,
    published: 2,
  };
  filtered.sort((a, b) => {
    const statusA = (a.approval_status as string) ?? "";
    const statusB = (b.approval_status as string) ?? "";
    const r = (rank[statusA] ?? 99) - (rank[statusB] ?? 99);
    if (r !== 0) return r;
    const ga = (a.generated_at as string) ?? "";
    const gb = (b.generated_at as string) ?? "";
    return gb.localeCompare(ga);
  });

  res.json(filtered);
});

export const handleAdminGetMeetingSummary = route(async (req, res) => {
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.meeting_summary") {
    throw new NotFoundError("Meeting summary not found");
  }
  res.json(
    await enrichCreator(
      getAdminReadModel(summaryState(record), {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true, audience: "member" },
    ),
  );
});

export const handlePatchMeetingSummary = route(async (req, res) => {
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.meeting_summary") {
    throw new NotFoundError("Meeting summary not found");
  }
  const state = summaryState(record);
  if (state.approval_status !== "pending") {
    throw new ConflictError(`Cannot edit meeting summary: approval_status is "${state.approval_status}".`);
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: MeetingSummaryPatch = {};
  if (typeof body.meeting_title === "string") {
    patch.meeting_title = body.meeting_title;
  }
  if (Array.isArray(body.blocks)) {
    patch.blocks = body.blocks as SummaryBlock[];
  }
  if (typeof body.admin_notes === "string") {
    patch.admin_notes = body.admin_notes;
  }

  const actor = getAuthUser(res).id;
  const ctx = {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  };

  await editMeetingSummary(state, actor, patch, ctx);

  // If meeting_title changed, mirror it into the process-level title
  // so list views stay consistent. We keep process.title formatted
  // "Meeting summary: <date>" rather than the meeting_title itself —
  // the meeting_title lives in state and is the primary display name
  // on the admin + public surfaces.
  await saveProcessState(record);

  res.json(
    await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true, audience: "member" },
    ),
  );
});

export const handleApproveMeetingSummary = route(async (req, res) => {
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.meeting_summary") {
    throw new NotFoundError("Meeting summary not found");
  }
  const state = summaryState(record);
  if (state.approval_status !== "pending") {
    throw new ConflictError(`Meeting summary is already ${state.approval_status}.`);
  }

  const actor = getAuthUser(res).id;
  const ctx = {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  };

  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    await approveMeetingSummary(state, actor, ctx, {
      confirmFlagged: body.confirm_flagged === true,
    });
  } catch (err) {
    if (err instanceof FlaggedSummaryError) {
      res.status(409).json({
        error: err.message,
        code: err.code,
        needs_confirmation: true,
        quality_flag: effectiveQualityFlag(state),
      });
      return;
    }
    throw err;
  }

  // Match the civic.brief convention: published summaries are terminal,
  // i.e. "finalized" in the spec's state machine. Skips "closed"
  // (no participation window to close).
  record.status = "finalized";
  await saveProcessState(record);

  res.json({
    message: "Meeting summary approved and published.",
    meeting_summary: await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true, audience: "member" },
    ),
  });
});

// --- Revision review ------------------------------------------------------
//
//   POST /admin/meeting-summaries/:id/revision/accept
//   POST /admin/meeting-summaries/:id/revision/discard
//
// A revision is a regenerated summary held beside a PUBLISHED one, waiting for
// review. The live version keeps serving throughout, so neither of these can
// take a page offline.

async function withRevision(
  req: Request,
  res: Response,
  apply: (state: MeetingSummaryProcessState) => void,
  message: string,
): Promise<void> {
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.meeting_summary") {
    throw new NotFoundError("Meeting summary not found");
  }
  const state = summaryState(record);
  if (!state.pending_revision) {
    throw new ConflictError("No revision is waiting for review.", "no_pending_revision");
  }
  try {
    apply(state);
  } catch (err) {
    if (err instanceof FlaggedSummaryError) {
      res.status(409).json({
        error: err.message,
        code: err.code,
        needs_confirmation: true,
        quality_flag: state.pending_revision?.quality_flag ?? null,
      });
      return;
    }
    throw err;
  }
  record.state = state as unknown as Record<string, unknown>;
  await saveProcessState(record);
  res.json({
    message,
    meeting_summary: await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true, audience: "member" },
    ),
  });
}

export const handleAcceptMeetingSummaryRevision = route(async (req, res) => {
  // No publication event: the summary was already published and stays
  // published. The feed marks it "Updated" from revised_at rather than
  // floating a month-old meeting back to the top.
  await withRevision(
    req,
    res,
    (state) =>
      acceptRevision(state, undefined, {
        confirmFlagged: (req.body as Record<string, unknown> | undefined)?.confirm_flagged === true,
      }),
    "Revision accepted. The published summary now reflects it.",
  );
});

export const handleDiscardMeetingSummaryRevision = route(async (req, res) => {
  await withRevision(
    req,
    res,
    (state) => discardRevision(state),
    "Revision discarded. The published summary is unchanged.",
  );
});

// --- POST /admin/meeting-summaries/batch-approve ---------------------------

export const handleBatchApproveMeetingSummaries = route(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null;
  if (!ids || ids.length === 0) {
    throw new ValidationError("ids[] is required");
  }

  const backdate = body.backdate === true;
  const actor = getAuthUser(res).id;
  let published = 0;
  let bulkFailed = 0;
  let skipped = 0;
  let flaggedSkipped = 0;

  for (const id of ids) {
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      skipped += 1;
      continue;
    }
    const state = summaryState(record);
    if (state.approval_status !== "pending") {
      skipped += 1;
      continue;
    }
    // Batch approval never confirms a flag: each flagged summary is opened
    // and approved on its own, with the reason in front of the admin.
    if (effectiveQualityFlag(state)) {
      flaggedSkipped += 1;
      continue;
    }
    try {
      const emit = backdate
        ? (input: Parameters<typeof emitEvent>[0]) =>
            emitEvent({
              ...input,
              timestamp: `${state.meeting_date}T12:00:00Z`,
            })
        : emitEvent;
      const ctx = {
        process_id: record.id,
        jurisdiction: record.jurisdiction,
        emit,
      };
      await approveMeetingSummary(state, actor, ctx);
      record.status = "finalized";
      await saveProcessState(record);
      published += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(
        `[meeting-summary] batch-approve failed id=${record.id}: ${msg}`,
      );
      bulkFailed += 1;
    }
  }

  res.json({
    message: "Batch approve complete.",
    published,
    skipped,
    // Held back because they need a one-by-one confirmation.
    flagged_skipped: flaggedSkipped,
    failed: bulkFailed,
  });
});

// --- POST /admin/meeting-summaries/batch-delete ----------------------------
//
// SOFT-archive, not hard-delete. Removed meeting summaries are archived
// (status → "archived", restorable from the admin Archived view) rather than
// destroyed. The route name is kept for API compatibility; the behavior is now
// non-destructive per the "soft-remove only" decision.

export const handleBatchDeleteMeetingSummaries = route(async (req, res) => {
  const adminId = getAuthUser(res).id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null;
  if (!ids || ids.length === 0) {
    throw new ValidationError("ids[] is required");
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Archived from meeting summaries admin";

  let archived = 0;
  let skipped = 0;

  for (const id of ids) {
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      skipped += 1;
      continue;
    }
    try {
      await archiveProcess(id, adminId, reason);
      archived += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(
        `[meeting-summary] batch-archive failed id=${id}: ${msg}`,
      );
      skipped += 1;
    }
  }

  res.json({
    message: "Batch archive complete.",
    archived,
    // Keep `deleted` in the response for older clients; equals `archived`.
    deleted: archived,
    skipped,
  });
});

// --- GET /meeting-summary/:id (public) -------------------------------------

export const handleGetPublicMeetingSummary = route(async (req, res) => {
  const id = req.params.id as string;
  const record = await getProcess(id);
  if (!record || record.definition.type !== "civic.meeting_summary") {
    throw new NotFoundError("Meeting summary not found");
  }
  const model = getPublicReadModel(summaryState(record), {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
  });
  if (!model) {
    // Not yet published — invisible to the public.
    throw new NotFoundError("Meeting summary not found");
  }
  // Sample content (Phase 7): the page says so, and that no recording
  // stands behind it. Its minutes are sample text the page shows in place
  // of a minutes PDF (2026-10-07, review issue #7).
  const sample = record.isSample === true;
  const minutes = (record.state as Record<string, unknown>).sample_minutes;
  res.json({
    ...model,
    is_sample: sample,
    ...(sample && typeof minutes === "string" && minutes.trim() ? { sample_minutes: minutes } : {}),
  });
});
