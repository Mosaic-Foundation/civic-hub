// Admin brief controller — list, read, edit, and approve civic.brief
// processes (the universal, admin-reviewed results for any closed process).
//
// Generalizes adminVoteResultsController: the approve handler runs the
// brief module's publication orchestration (deliver → publish → finalize
// source), then marks the brief process finalized. Recipients come from the
// same "Brief recipients" setting; unlike vote-results, an empty recipient
// list is NOT fatal (a conversation/project brief can publish to the feed
// without an official email list).

import { Request, Response } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import { enrichCreator } from "../services/creatorDisplay.js";
import {
  approveBrief,
  editBrief,
  getAdminReadModel,
  getAdminSummary,
  setRecipients,
  type BriefContentPatch,
  type BriefProcessState,
  type BriefPublicationStatus,
} from "../modules/civic.brief/index.js";
import {
  getAllProcesses,
  getProcess,
  saveProcessState,
} from "../services/processService.js";
import { finalizeBriefSource } from "../services/briefFinalize.js";
import { getAuthUser } from "../middleware/auth.js";
import { sendEmail } from "../services/mailer.js";
import { getVoteResultsRecipients } from "../services/hubSettings.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { extractUrls } from "../modules/civic.link_preview/index.js";
import { warmPreviewsInBackground } from "../services/linkPreviewCache.js";

const HUB_LABEL = "Floyd Civic Hub";
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
export async function handleAdminListBriefs(
  req: Request,
  res: Response,
): Promise<void> {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** GET /admin/briefs/:id — full detail for admin review. */
export async function handleAdminGetBrief(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const record = await getProcess(req.params.id as string);
    if (!record || record.definition.type !== BRIEF_TYPE) {
      res.status(404).json({ error: "Brief not found" });
      return;
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** PATCH /admin/briefs/:id — edit headline/summary/comments/notes/image. */
export async function handlePatchBrief(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const record = await getProcess(req.params.id as string);
    if (!record || record.definition.type !== BRIEF_TYPE) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    const state = briefState(record);
    if (state.publication_status !== "pending") {
      res.status(409).json({
        error: `Cannot edit brief: publication_status is "${state.publication_status}".`,
      });
      return;
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
    // renders verbatim. A 400, not a 500: it's the admin's input.
    if (body.recipients !== undefined) {
      try {
        setRecipients(state, body.recipients);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Invalid recipients",
        });
        return;
      }
    }

    const actor = getAuthUser(res).id;
    const ctx = {
      process_id: record.id,
      hub_id: record.hubId,
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/** POST /admin/briefs/:id/approve — deliver, publish, finalize the source. */
export async function handleApproveBrief(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const record = await getProcess(req.params.id as string);
    if (!record || record.definition.type !== BRIEF_TYPE) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    const state = briefState(record);
    if (state.publication_status !== "pending") {
      res.status(409).json({ error: `Brief is already ${state.publication_status}.` });
      return;
    }

    // Delivery goes to the admin's per-review selection (state.recipients,
    // set via PATCH during review). The hub-wide "Brief recipients"
    // setting is only the fallback for briefs whose review predates the
    // picker. Empty is allowed either way — the brief still publishes to
    // the feed, just without an email.
    const fallbackRecipients = await getVoteResultsRecipients();

    const actor = getAuthUser(res).id;
    const ctx = {
      process_id: record.id,
      hub_id: record.hubId,
      jurisdiction: record.jurisdiction,
      emit: emitEvent,
    };

    await approveBrief(state, actor, ctx, {
      fallbackRecipients,
      hubLabel: HUB_LABEL,
      publicBriefUrl: publicBriefUrl(record.id),
      sendEmail,
      finalizeSource: finalizeBriefSource,
    });

    // A published brief is terminal.
    record.status = "finalized";
    await saveProcessState(record);

    const model = await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true, audience: "member" },
    );
    res.json({ message: "Brief approved and published.", brief: model });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
