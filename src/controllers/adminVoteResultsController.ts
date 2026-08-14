// Admin vote-results controller — list, read, edit, and approve
// civic.vote_results processes. Renamed from adminBriefController.ts in
// Slice 8.5.
//
// The approve handler orchestrates the full publication sequence:
//   1. edit check (status must be "pending")
//   2. mark "approved", set approved_at
//   3. deliver email (HALT on failure — later steps won't run)
//   4. record delivered_to
//   5. emit civic.process.outcome_recorded
//   6. mark "published", set published_at
//   7. emit civic.process.result_published (vote-results)
//   8. finalize the linked vote (civic.vote.finalizeVote), which emits
//      civic.process.result_published for the vote — that vote event is
//      filtered out of Feed/digest as of Slice 8.5 to eliminate the
//      duplicate post; the event remains on the log for federation /
//      audit purposes.
//
// Mutations to in-memory state are persisted via saveProcessState only
// on success. Durable event emissions that happen mid-sequence are not
// rolled back on failure — this matches the existing hub architecture
// (events are the source of truth) and is an accepted pilot-phase
// limitation for the same reason as the executeAction race condition.

import { Request, Response } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import { enrichCreator } from "../services/creatorDisplay.js";
import {
  approveVoteResults,
  editVoteResults,
  getAdminReadModel,
  getAdminSummary,
  type VoteResultsContentPatch,
  type VoteResultsProcessState,
  type VoteResultsPublicationStatus,
} from "../modules/civic.vote_results/index.js";
import {
  finalizeVote,
  getVotingMethod,
  DEFAULT_METHOD,
  type VoteProcessState,
} from "../modules/civic.vote/index.js";
import { getBallotChoicesForProcess } from "../modules/civic.receipts/index.js";
import {
  getAllProcesses,
  getProcess,
  saveProcessState,
} from "../services/processService.js";
import { getAuthUser } from "../middleware/auth.js";
import { sendEmail } from "../services/mailer.js";
import { getVoteResultsRecipients } from "../services/hubSettings.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { extractUrls } from "../modules/civic.link_preview/index.js";
import { warmPreviewsInBackground } from "../services/linkPreviewCache.js";

const HUB_LABEL = "Floyd Civic Hub";

function voteResultsState(record: {
  state: Record<string, unknown>;
}): VoteResultsProcessState {
  return record.state as unknown as VoteResultsProcessState;
}

function voteState(record: { state: Record<string, unknown> }): VoteProcessState {
  return record.state as unknown as VoteProcessState;
}

function publicVoteResultsUrl(id: string): string {
  return `${uiBaseUrl()}/vote-results/${id}`;
}

function isPublicationStatus(s: string): s is VoteResultsPublicationStatus {
  return s === "pending" || s === "approved" || s === "published";
}

/**
 * GET /admin/vote-results — list with optional ?status= filter.
 * Returns pending first (needing review), then approved, then published.
 */
export async function handleAdminListVoteResults(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const statusFilter = req.query.status as string | undefined;
    const all = await getAllProcesses();
    // Only legacy civic.vote_results rows (existing published vote briefs).
    // The `civic.brief` string is now the NEW generic brief module — its
    // records are served by the /admin/briefs controller, not here.
    const records = all.filter(
      (p) => p.definition.type === "civic.vote_results",
    );

    const summaries = records.map((p) => ({
      ...getAdminSummary(voteResultsState(p), {
        id: p.id,
        title: p.title,
        createdAt: p.createdAt,
      }),
    }));

    const filtered =
      statusFilter && isPublicationStatus(statusFilter)
        ? summaries.filter((b) => b.publication_status === statusFilter)
        : summaries;

    // Sort: pending first, then approved, then published. Within each
    // bucket, newest generated first.
    const rank: Record<string, number> = { pending: 0, approved: 1, published: 2 };
    filtered.sort((a, b) => {
      const statusA = (a.publication_status as string) ?? "";
      const statusB = (b.publication_status as string) ?? "";
      const r = (rank[statusA] ?? 99) - (rank[statusB] ?? 99);
      if (r !== 0) return r;
      const ga = (a.generated_at as string) ?? "";
      const gb = (b.generated_at as string) ?? "";
      return gb.localeCompare(ga);
    });

    res.json(filtered);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * GET /admin/vote-results/:id — full detail for admin review.
 */
export async function handleAdminGetVoteResults(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.vote_results") {
      res.status(404).json({ error: "Vote results not found" });
      return;
    }
    const model = await enrichCreator(
      getAdminReadModel(voteResultsState(record), {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true },
    );
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * PATCH /admin/vote-results/:id — edit comments and admin_notes.
 * Rejects with 409 if the record is no longer in pending status.
 */
export async function handlePatchVoteResults(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.vote_results") {
      res.status(404).json({ error: "Vote results not found" });
      return;
    }
    const state = voteResultsState(record);
    if (state.publication_status !== "pending") {
      res.status(409).json({
        error: `Cannot edit vote results: publication_status is "${state.publication_status}".`,
      });
      return;
    }

    const body = req.body ?? {};
    const patch: VoteResultsContentPatch = {};
    if (Array.isArray(body.comments)) patch.comments = body.comments;
    if (typeof body.admin_notes === "string") patch.admin_notes = body.admin_notes;
    // Image patch semantics match civic.announcement: null clears,
    // string sets, undefined leaves alone. The module enforces the
    // alt-text-required-when-image-set rule.
    if (body.image_url === null || typeof body.image_url === "string") {
      patch.image_url = body.image_url as string | null;
    }
    if (body.image_alt === null || typeof body.image_alt === "string") {
      patch.image_alt = body.image_alt as string | null;
    }

    const actor = getAuthUser(res).id;
    const ctx = {
      process_id: record.id,
      hub_id: record.hubId,
      jurisdiction: record.jurisdiction,
      emit: emitEvent,
    };

    await editVoteResults(state, actor, patch, ctx);
    await saveProcessState(record);

    // Pre-warm the link-preview cache for any URLs the admin embedded
    // in admin_notes. Vote-results admin_notes is the canonical "free
    // text" surface for this module — comments[] is sanitized to short
    // statements that rarely contain URLs. Fire-and-forget; failures
    // logged but never bubble up to the admin save.
    const noteUrls = extractUrls(state.content.admin_notes);
    if (noteUrls.length > 0) warmPreviewsInBackground(noteUrls);

    const model = await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true },
    );
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * POST /admin/vote-results/:id/approve — run the full approval orchestration.
 */
export async function handleApproveVoteResults(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.vote_results") {
      res.status(404).json({ error: "Vote results not found" });
      return;
    }

    const state = voteResultsState(record);
    if (state.publication_status !== "pending") {
      res.status(409).json({
        error: `Vote results are already ${state.publication_status}.`,
      });
      return;
    }

    // Recipients: admin-configured DB value first, env var
    // (BOARD_RECIPIENT_EMAIL) as safety-net fallback so existing
    // deploys keep working before an admin has opened the settings
    // panel for the first time.
    const recipients = await getVoteResultsRecipients();
    if (recipients.length === 0) {
      res.status(503).json({
        error:
          "Approval unavailable: no recipients configured. Set them in " +
          "Admin → Vote results → Settings (or as BOARD_RECIPIENT_EMAIL env var).",
      });
      return;
    }

    const actor = getAuthUser(res).id;
    const ctx = {
      process_id: record.id,
      hub_id: record.hubId,
      jurisdiction: record.jurisdiction,
      emit: emitEvent,
    };

    // Closure called by the vote-results module once the record reaches
    // "published". Loads the linked vote, calls the vote module's
    // finalizeVote directly (library-only; no HTTP path), then persists
    // the vote.
    const finalizeLinkedVote = async (voteId: string, byActor: string) => {
      const voteRecord = await getProcess(voteId);
      if (!voteRecord) {
        throw new Error(`Linked vote not found: ${voteId}`);
      }
      if (voteRecord.definition.type !== "civic.vote") {
        throw new Error(
          `Linked process ${voteId} is not a civic.vote (type=${voteRecord.definition.type})`,
        );
      }
      if (voteRecord.status === "finalized") {
        // Idempotency: if the vote was already finalized (e.g. a prior
        // approval attempt succeeded at this step), skip cleanly.
        return;
      }
      const voteCtx = {
        process_id: voteRecord.id,
        hub_id: voteRecord.hubId,
        jurisdiction: voteRecord.jurisdiction,
        emit: emitEvent,
      };
      // Ballots come from the anonymized receipts table — the vote's
      // state carries no individual ballots (ballot secrecy).
      const vState = voteState(voteRecord);
      const method = getVotingMethod(vState.method ?? DEFAULT_METHOD);
      const ballots = (await getBallotChoicesForProcess(voteRecord.id)).map(
        (c) => method.parseReceipt(c),
      );
      await finalizeVote(vState, byActor, ballots, voteCtx);
      voteRecord.status = voteState(voteRecord).status;
      await saveProcessState(voteRecord);
    };

    await approveVoteResults(state, actor, ctx, {
      recipients,
      hubLabel: HUB_LABEL,
      publicVoteResultsUrl: publicVoteResultsUrl(record.id),
      sendEmail,
      finalizeLinkedVote,
    });

    // Persist mutations (publication_status, timestamps, delivered_to).
    // Also advance process-level status: published vote-results are
    // terminal, i.e. "finalized" in the spec's state machine.
    record.status = "finalized";
    await saveProcessState(record);

    const model = await enrichCreator(
      getAdminReadModel(state, {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      }),
      { keepRawId: true },
    );
    res.json({
      message: "Vote results approved and published.",
      vote_results: model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
