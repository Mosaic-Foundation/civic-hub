// Meeting-summary controllers — five HTTP surfaces in one file:
//
//   POST /internal/meeting-summary/run
//     Cron-triggered. Loads the configured MeetingSourceConnector,
//     discovers meeting entries, summarizes new ones via Claude, creates
//     a civic.meeting_summary draft process per entry. Protected by
//     CRON_SECRET bearer auth (shared with the digest cron). Respects
//     MEETING_SUMMARY_ENABLED=false. Per-meeting failures are isolated;
//     one bad meeting does not abort the batch.
//
//   GET /admin/meeting-summaries            (mounted in adminRoutes.ts)
//   GET /admin/meeting-summaries/:id        (mounted in adminRoutes.ts)
//   PATCH /admin/meeting-summaries/:id      (mounted in adminRoutes.ts)
//   POST /admin/meeting-summaries/:id/approve
//     Admin review queue. Pattern mirrors adminBriefController.
//
//   GET /meeting-summary/:id
//     Public read of published summaries only.

import { Request, Response } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import {
  approveMeetingSummary,
  buildCreateInput,
  buildDescription,
  createMeetingSummaryState,
  discoverMeetings,
  editMeetingSummary,
  emitCreationEvents,
  floydMinutesConnector,
  getAdminReadModel,
  getAdminSummary,
  getPublicReadModel,
  resolveEffectiveInstructions,
  summarizeMeeting,
  type MeetingSourceConnector,
  type MeetingSummaryApprovalStatus,
  type MeetingSummaryConfig,
  type MeetingSummaryPatch,
  type MeetingSummaryProcessState,
  type SummaryBlock,
} from "../modules/civic.meeting_summary/index.js";
import {
  archiveProcess,
  createProcess,
  getAllProcesses,
  getProcess,
  saveProcessState,
} from "../services/processService.js";
import { getAuthUser } from "../middleware/auth.js";
import { enrichCreator } from "../services/creatorDisplay.js";
import { callClaude, DEFAULT_MODEL } from "../utils/anthropic.js";
import { fetchHtml, fetchPdf } from "../utils/http.js";
import { fetchYouTubeTranscript } from "../utils/youtube.js";
import { sendEmail } from "../utils/email.js";

const DEFAULT_CONNECTOR_ID = "floyd-minutes-page";
const CRON_ACTOR = "system:meeting-summary-cron";
const DEFAULT_MAX_PER_RUN = 3;

function maxPerRun(): number {
  const raw = process.env.MEETING_SUMMARY_MAX_PER_RUN?.trim();
  if (!raw) return DEFAULT_MAX_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PER_RUN;
  return Math.floor(n);
}

// Connector registry — MVP ships one; extending is a new entry here.
const CONNECTORS: Record<string, MeetingSourceConnector> = {
  "floyd-minutes-page": floydMinutesConnector,
};

function summaryState(
  record: { state: Record<string, unknown> },
): MeetingSummaryProcessState {
  return record.state as unknown as MeetingSummaryProcessState;
}

function isApprovalStatus(s: string): s is MeetingSummaryApprovalStatus {
  return s === "pending" || s === "approved" || s === "published";
}

function enabled(): boolean {
  const v = process.env.MEETING_SUMMARY_ENABLED?.trim().toLowerCase();
  return v !== "false";
}

function requireCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  return token.length > 0 && token === secret;
}

function modelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

function connectorFor(id: string | undefined): MeetingSourceConnector | null {
  const lookup = id?.trim() || DEFAULT_CONNECTOR_ID;
  return CONNECTORS[lookup] ?? null;
}

function autoPublish(): boolean {
  const v = process.env.MEETING_SUMMARY_AUTO_PUBLISH?.trim().toLowerCase();
  return v === "true";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cutoffDate(): string | null {
  const v = process.env.MEETING_SUMMARY_CUTOFF_DATE?.trim();
  if (!v || !ISO_DATE_RE.test(v)) return null;
  return v;
}

function adminRecipients(): string[] {
  return (process.env.CIVIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

async function notifyCronFailures(stats: {
  discovered: number;
  created: number;
  skippedExisting: number;
  failed: number;
  failures: Array<{ source_id: string; error: string }>;
  duration_ms: number;
}): Promise<void> {
  const recipients = adminRecipients();
  if (recipients.length === 0 || stats.failed === 0) return;

  const subject = `[Civic Hub] Meeting summary cron: ${stats.failed} failure(s)`;
  const failureLines = stats.failures
    .map((f) => `<li><code>${f.source_id}</code>: ${f.error}</li>`)
    .join("\n");
  const html = `
    <p>The meeting summary cron completed with <strong>${stats.failed} failure(s)</strong>.</p>
    <ul>${failureLines}</ul>
    <p>Discovered: ${stats.discovered} | Created: ${stats.created} | Skipped existing: ${stats.skippedExisting} | Duration: ${stats.duration_ms}ms</p>
  `;

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html });
    } catch (err) {
      console.warn(
        `[meeting-summary] notification email failed for ${to}: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}

// --- POST /internal/meeting-summary/run ------------------------------------

export async function handleRunMeetingSummary(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireCronSecret(req)) {
    res.status(401).json({ error: "Invalid or missing cron credential" });
    return;
  }

  if (!enabled()) {
    res.status(200).json({ skipped: true, reason: "meeting summary disabled" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY must be set. Create a key at https://console.anthropic.com and add it to Vercel env vars.",
    });
    return;
  }

  const sourceUrl = process.env.MEETING_SOURCE_URL?.trim();
  if (!sourceUrl) {
    res.status(500).json({
      error:
        "MEETING_SOURCE_URL must be set (e.g. https://www.floydcova.gov/agendas-minutes).",
    });
    return;
  }

  const connectorId = process.env.MEETING_CONNECTOR_ID?.trim();
  const connector = connectorFor(connectorId);
  if (!connector) {
    res.status(500).json({
      error: `Unknown MEETING_CONNECTOR_ID "${connectorId}". Known: ${Object.keys(CONNECTORS).join(", ")}`,
    });
    return;
  }

  const cfg: MeetingSummaryConfig = {
    source_url: sourceUrl,
    extraction_instructions: resolveEffectiveInstructions(
      process.env.MEETING_EXTRACTION_INSTRUCTIONS ?? "",
    ),
    model: modelName(),
  };

  const started = Date.now();
  let discovered = 0;
  let created = 0;
  let skippedExisting = 0;
  let failed = 0;
  const failures: Array<{ source_id: string; error: string }> = [];

  try {
    console.log(
      `[meeting-summary] run started connector=${connector.id} source=${cfg.source_url}`,
    );

    const discoveryStart = Date.now();
    const entries = await discoverMeetings(connector, cfg, {
      fetchHtml,
      callClaude,
    });
    discovered = entries.length;
    console.log(
      `[meeting-summary] discovery done entries=${discovered} duration_ms=${Date.now() - discoveryStart}`,
    );

    // Apply date cutoff to skip old meetings (e.g. pre-2026 backlog with
    // oversized PDFs that fail every run).
    const cutoff = cutoffDate();
    let filteredEntries = entries;
    if (cutoff) {
      filteredEntries = entries.filter((e) => e.meeting_date >= cutoff);
      console.log(
        `[meeting-summary] date cutoff=${cutoff} filtered ${entries.length}→${filteredEntries.length}`,
      );
    }

    // Process newest meetings first so the per-run cap prioritizes recent ones.
    filteredEntries.sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));

    // Build the set of existing source_ids and a map of agenda-based
    // summaries (keyed by meeting_date) eligible for upgrade once minutes
    // become available.
    const allProcesses = await getAllProcesses();
    const existingSourceIds = new Set<string>();
    const agendaByDate = new Map<string, typeof allProcesses[0]>();
    for (const p of allProcesses) {
      if (p.definition.type !== "civic.meeting_summary") continue;
      const s = summaryState(p);
      if (typeof s?.source_id === "string") {
        existingSourceIds.add(s.source_id);
        if ((s.source_type ?? "minutes") === "agenda") {
          agendaByDate.set(s.meeting_date, p);
        }
      }
    }

    const perRunCap = maxPerRun();
    const willAutoPublish = autoPublish();
    console.log(
      `[meeting-summary] processing with per_run_cap=${perRunCap} auto_publish=${willAutoPublish}`,
    );

    for (const entry of filteredEntries) {
      if (created >= perRunCap) {
        console.log(
          `[meeting-summary] cap reached (${perRunCap}); remaining new meetings deferred to next run`,
        );
        break;
      }
      if (existingSourceIds.has(entry.source_id) || agendaByDate.has(entry.meeting_date)) {
        skippedExisting += 1;
        continue;
      }

      const meetingStart = Date.now();
      try {
        const summary = await summarizeMeeting(entry, cfg, {
          fetchPdf,
          fetchYouTubeTranscript,
          callClaude,
        });

        const createInput = buildCreateInput(entry, summary);
        const description = buildDescription(summary.blocks);

        const newProcess = await createProcess({
          definition: { type: "civic.meeting_summary", version: "0.1" },
          title: `Meeting summary: ${entry.meeting_date}`,
          description,
          jurisdiction: "us-va-floyd",
          createdBy: CRON_ACTOR,
          state: createInput as unknown as Record<string, unknown>,
        });

        const state = summaryState(newProcess);
        const ctx = {
          process_id: newProcess.id,
          hub_id: newProcess.hubId,
          jurisdiction: newProcess.jurisdiction,
          emit: emitEvent,
        };
        await emitCreationEvents(ctx, CRON_ACTOR, state);

        if (willAutoPublish) {
          await approveMeetingSummary(state, CRON_ACTOR, ctx);
          newProcess.status = "finalized";
          await saveProcessState(newProcess);
        }

        console.log(
          `[meeting-summary] created process=${newProcess.id} source_id=${entry.source_id} blocks=${summary.blocks.length} published=${willAutoPublish} duration_ms=${Date.now() - meetingStart}`,
        );
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.warn(
          `[meeting-summary] failed source_id=${entry.source_id} error=${msg} duration_ms=${Date.now() - meetingStart}`,
        );
        failures.push({ source_id: entry.source_id, error: msg });
        failed += 1;
      }
    }

    // --- Upgrade pass: re-summarize agenda-based summaries when minutes appear ---
    let upgraded = 0;
    if (agendaByDate.size > 0) {
      for (const entry of filteredEntries) {
        if (!entry.source_minutes_url) continue;
        const existing = agendaByDate.get(entry.meeting_date);
        if (!existing) continue;
        const meetingStart = Date.now();
        try {
          console.log(
            `[meeting-summary] upgrading agenda→minutes source_id=${entry.source_id}`,
          );
          const summary = await summarizeMeeting(entry, cfg, {
            fetchPdf,
            fetchYouTubeTranscript,
            callClaude,
          });
          const state = summaryState(existing);
          state.source_id = entry.source_id;
          state.source_minutes_url = entry.source_minutes_url;
          state.source_agenda_url = entry.source_agenda_url;
          state.source_type = "minutes";
          state.blocks = summary.blocks;
          state.ai_instructions_used = summary.ai_instructions_used;
          state.ai_model = summary.model;
          state.generated_at = new Date().toISOString();
          // Reset to pending so admin reviews the upgraded version
          state.approval_status = "pending";
          state.published_at = null;
          state.approved_at = null;
          existing.state = state as unknown as Record<string, unknown>;
          await saveProcessState(existing);
          console.log(
            `[meeting-summary] upgraded process=${existing.id} source_id=${entry.source_id} duration_ms=${Date.now() - meetingStart}`,
          );
          upgraded += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.warn(
            `[meeting-summary] upgrade failed source_id=${entry.source_id} error=${msg}`,
          );
          failures.push({ source_id: entry.source_id, error: `upgrade: ${msg}` });
          failed += 1;
        }
      }
    }

    const duration_ms = Date.now() - started;
    console.log(
      `[meeting-summary] run complete discovered=${discovered} created=${created} upgraded=${upgraded} skipped=${skippedExisting} failed=${failed} duration_ms=${duration_ms}`,
    );
    res.status(200).json({
      discovered,
      created,
      upgraded,
      skipped_existing: skippedExisting,
      failed,
      duration_ms,
    });

    notifyCronFailures({
      discovered,
      created,
      skippedExisting,
      failed,
      failures,
      duration_ms,
    }).catch((err) => {
      console.warn(
        `[meeting-summary] notification send error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const duration_ms = Date.now() - started;
    console.error(`[meeting-summary] batch error: ${message}`);
    res.status(500).json({
      error: message,
      discovered,
      created,
      skipped_existing: skippedExisting,
      failed,
      duration_ms,
    });
  }
}

// --- Admin surfaces --------------------------------------------------------

export async function handleAdminListMeetingSummaries(
  req: Request,
  res: Response,
): Promise<void> {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleAdminGetMeetingSummary(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    res.json(
      await enrichCreator(
        getAdminReadModel(summaryState(record), {
          id: record.id,
          title: record.title,
          createdAt: record.createdAt,
          createdBy: record.createdBy,
        }),
        { keepRawId: true },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handlePatchMeetingSummary(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    const state = summaryState(record);
    if (state.approval_status !== "pending") {
      res.status(409).json({
        error: `Cannot edit meeting summary: approval_status is "${state.approval_status}".`,
      });
      return;
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
      hub_id: record.hubId,
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
        { keepRawId: true },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleApproveMeetingSummary(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    const state = summaryState(record);
    if (state.approval_status !== "pending") {
      res.status(409).json({
        error: `Meeting summary is already ${state.approval_status}.`,
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

    await approveMeetingSummary(state, actor, ctx);

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
        { keepRawId: true },
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- POST /admin/meeting-summaries/batch-approve ---------------------------

export async function handleBatchApproveMeetingSummaries(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ error: "ids[] is required" });
      return;
    }

    const backdate = body.backdate === true;
    const actor = getAuthUser(res).id;
    let published = 0;
    let bulkFailed = 0;
    let skipped = 0;

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
          hub_id: record.hubId,
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
      failed: bulkFailed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- POST /admin/meeting-summaries/batch-delete ----------------------------
//
// SOFT-archive, not hard-delete. Removed meeting summaries are archived
// (status → "archived", restorable from the admin Archived view) rather than
// destroyed. The route name is kept for API compatibility; the behavior is now
// non-destructive per the "soft-remove only" decision.

export async function handleBatchDeleteMeetingSummaries(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const adminId = getAuthUser(res).id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ error: "ids[] is required" });
      return;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- GET /meeting-summary/:id (public) -------------------------------------

export async function handleGetPublicMeetingSummary(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    const model = getPublicReadModel(summaryState(record), {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
    });
    if (!model) {
      // Not yet published — invisible to the public.
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
