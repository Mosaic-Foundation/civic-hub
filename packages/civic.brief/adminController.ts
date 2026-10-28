// Admin brief controller — list, read, edit, and approve civic.brief
// processes (the universal, admin-reviewed results for any closed process).
//
// Generalizes adminVoteResultsController: the approve handler runs the
// brief module's publication orchestration (deliver → publish → finalize
// source), then marks the brief process finalized. Recipients come from the
// same "Brief recipients" setting; unlike vote-results, an empty recipient
// list is NOT fatal (a conversation/project brief can publish to the feed
// without an official email list).

import {
  applyOnApproval,
  discardBriefRevision,
  publishBriefRevision,
  regenerateBrief,
  ConflictError,
  NotFoundError,
  route,
  emitEvent,
  enrichCreator,
  getAllProcesses,
  getProcess,
  saveProcessState,
  finalizeBriefSource,
  processWireIris,
  getAuthUser,
  sampleDeliverySuppressed,
  getVoteResultsRecipients,
  hubDisplayNameSync,
  currentHubId,
  uiBaseUrl,
  extractUrls,
  warmPreviewsInBackground,
} from "@civic-social/plugin-sdk/first-party";
import {
  approveBrief,
  editBrief,
  getAdminReadModel,
  getAdminSummary,
  setRecipients,
  type BriefContentPatch,
  type BriefProcessState,
  type BriefPublicationStatus,
} from "./api.js";
import { briefHost } from "./host.js";
import { publishedMessage } from "../../src/shared/delivery.js";

const BRIEF_TYPE = "civic.brief";

function briefState(record: { state: Record<string, unknown> }): BriefProcessState {
  return record.state as unknown as BriefProcessState;
}

function publicBriefUrl(id: string): string {
  return `${uiBaseUrl()}/brief/${id}`;
}

function isPublicationStatus(s: string): s is BriefPublicationStatus {
  return s === "pending" || s === "approved" || s === "published";
}

/** GET /admin/briefs — list with optional ?status=, pending first. */
export const handleAdminListBriefs = route(async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const all = await getAllProcesses();
  const records = all.filter((p) => p.definition.type === BRIEF_TYPE);

  const summaries = records.map((p) =>
    getAdminSummary(briefState(p), {
      id: p.id,
      title: p.title,
      createdAt: p.createdAt,
    }),
  );

  const filtered =
    statusFilter && isPublicationStatus(statusFilter)
      ? summaries.filter((b) => b.publication_status === statusFilter)
      : summaries;

  const rank: Record<string, number> = { pending: 0, approved: 1, published: 2 };
  filtered.sort((a, b) => {
    const r =
      (rank[(a.publication_status as string) ?? ""] ?? 99) -
      (rank[(b.publication_status as string) ?? ""] ?? 99);
    if (r !== 0) return r;
    return ((b.generated_at as string) ?? "").localeCompare(
      (a.generated_at as string) ?? "",
    );
  });

  res.json(filtered);
});

/** GET /admin/briefs/:id — full detail for admin review. */
export const handleAdminGetBrief = route(async (req, res) => {
  const record = await getProcess(req.params.id as string);
  if (!record || record.definition.type !== BRIEF_TYPE) {
    throw new NotFoundError("Brief not found");
  }
  const model = await enrichCreator(
    getAdminReadModel(briefState(record), {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    }),
    { keepRawId: true, audience: "member" },
  );
  res.json(model);
});

/** PATCH /admin/briefs/:id — edit headline/summary/comments/notes/image. */
export const handlePatchBrief = route(async (req, res) => {
  const record = await getProcess(req.params.id as string);
  if (!record || record.definition.type !== BRIEF_TYPE) {
    throw new NotFoundError("Brief not found");
  }
  const state = briefState(record);
  if (state.publication_status !== "pending") {
    throw new ConflictError(`Cannot edit brief: publication_status is "${state.publication_status}".`);
  }

  const body = req.body ?? {};
  const patch: BriefContentPatch = {};
  if (Array.isArray(body.comments)) patch.comments = body.comments;
  if (typeof body.admin_notes === "string") patch.admin_notes = body.admin_notes;
  if (typeof body.headline === "string") patch.headline = body.headline;
  if (typeof body.summary === "string") patch.summary = body.summary;
  if (body.image_url === null || typeof body.image_url === "string") {
    patch.image_url = body.image_url as string | null;
  }
  if (body.image_alt === null || typeof body.image_alt === "string") {
    patch.image_alt = body.image_alt as string | null;
  }

  // Per-review delivery selection rides the same PATCH as the content
  // edits. setRecipients validates (labels required — the label is what
  // the public receipt shows) and throws a user-facing message the UI
  // renders verbatim (a ValidationError, so a 400, not a 500).
  if (body.recipients !== undefined) {
    setRecipients(state, body.recipients);
  }

  const actor = getAuthUser(res).id;
  const ctx = {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  };

  await editBrief(state, actor, patch, ctx);
  await saveProcessState(record);

  const noteUrls = extractUrls(state.content.admin_notes);
  if (noteUrls.length > 0) warmPreviewsInBackground(noteUrls);

  const model = await enrichCreator(
    getAdminReadModel(state, {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    }),
    { keepRawId: true, audience: "member" },
  );
  res.json(model);
});

/** POST /admin/briefs/:id/approve — deliver, publish, finalize the source. */
export const handleApproveBrief = route(async (req, res) => {
  const record = await getProcess(req.params.id as string);
  if (!record || record.definition.type !== BRIEF_TYPE) {
    throw new NotFoundError("Brief not found");
  }
  const state = briefState(record);
  if (state.publication_status !== "pending") {
    throw new ConflictError(`Brief is already ${state.publication_status}.`);
  }

  // Delivery goes to the admin's per-review selection (state.recipients,
  // set via PATCH during review). The hub-wide "Brief recipients"
  // setting is only the fallback for briefs whose review predates the
  // picker. Empty is allowed either way — the brief still publishes to
  // the feed, just without an email.
  const fallbackRecipients = await getVoteResultsRecipients(currentHubId());

  const actor = getAuthUser(res).id;
  const ctx = {
    process_id: record.id,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  };

  await approveBrief(state, actor, ctx, {
    fallbackRecipients,
    hubLabel: hubDisplayNameSync(),
    publicBriefUrl: publicBriefUrl(record.id),
    // A sample brief is never delivered (Phase 7).
    sendEmail: record.isSample ? sampleDeliverySuppressed : briefHost.get().adapter("mail").deliver,
    finalizeSource: finalizeBriefSource,
    sourceProcessIri:
      (await processWireIris([state.source_process_id])).get(state.source_process_id) ?? null,
  });

  // A published brief is terminal.
  record.status = "finalized";
  await saveProcessState(record);
  // Regenerated before it was public: its source takes the new summary now.
  await applyOnApproval(record, actor);

  const model = await enrichCreator(
    getAdminReadModel(state, {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    }),
    { keepRawId: true, audience: "member" },
  );
  // Held back is not failed (review #34): say who was not emailed and why,
  // e.g. "Published. Not emailed to Board of Supervisors because this hub
  // is in demo mode." Labels when the admin chose recipients, else addresses.
  const heldBack = state.held_back ?? [];
  const message = publishedMessage(
    state.delivered_to_labels?.length ? state.delivered_to_labels : state.delivered_to,
    {
      names: state.held_back_labels?.length
        ? state.held_back_labels
        : heldBack.map((h) => h.email),
      reasons: heldBack.map((h) => h.reason),
    },
  );
  res.json({ message, brief: model });
});

// --- Regenerate (Actions slice, 2026-10-13; src/services/briefRegenerate.ts) ---

async function adminModel(record: { id: string; title: string; createdAt: string; createdBy: string }, state: BriefProcessState) {
  return enrichCreator(
    getAdminReadModel(state, { id: record.id, title: record.title, createdAt: record.createdAt, createdBy: record.createdBy }),
    { keepRawId: true, audience: "member" },
  );
}

function adminOf(res: Parameters<typeof getAuthUser>[0]) {
  const user = getAuthUser(res);
  return { id: user.id, email: user.email };
}

/** POST /admin/briefs/:id/regenerate — make it again: replaced if unpublished, staged if published. */
export const handleRegenerateBrief = route(async (req, res) => {
  const { staged, state, record } = await regenerateBrief(req.params.id as string, adminOf(res));
  res.json({ staged, brief: await adminModel(record, state) });
});

/** POST /admin/briefs/:id/revision/publish — the staged version replaces the published one. */
export const handlePublishBriefRevision = route(async (req, res) => {
  const { state, record } = await publishBriefRevision(req.params.id as string, adminOf(res));
  res.json({ brief: await adminModel(record, state) });
});

/** POST /admin/briefs/:id/revision/discard — drop the staged version. */
export const handleDiscardBriefRevision = route(async (req, res) => {
  const { state, record } = await discardBriefRevision(req.params.id as string, adminOf(res));
  res.json({ brief: await adminModel(record, state) });
});
