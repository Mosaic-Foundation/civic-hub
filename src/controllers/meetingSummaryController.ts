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
  acceptRevision,
  discardRevision,
  resolveEffectiveInstructions,
  sourceFingerprints,
  stageRevision,
  summarizeMeeting,
  UPGRADEABLE_SOURCE_TYPES,
  wixCmsConnector,
  youtubeChannelConnector,
  type MeetingEntry,
  type MeetingSourceConnector,
  type MeetingSourceType,
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
import { fetchHtml, fetchJson, fetchPdf, fetchXml } from "../utils/http.js";
import { fetchYouTubeTranscript } from "../utils/youtube.js";
import { sendEmail } from "../utils/email.js";
import {
  findBrokenPublications,
  type BrokenPublication,
} from "../services/feedHealth.js";

// "auto" tries every connector whose configuration is present, in descending
// order of source quality, and uses the first that returns meetings. This is
// what makes "point it at your government's site" true across platforms
// without the operator having to know which kind of site they have.
const DEFAULT_CONNECTOR_ID = "auto";
const CRON_ACTOR = "system:meeting-summary-cron";
const DEFAULT_MAX_PER_RUN = 3;

/**
 * How long a revision may wait for review before the cron mentions it.
 *
 * Long enough not to nag about something queued yesterday, short enough that an
 * improvement does not sit unread for a whole meeting cycle.
 */
const REVISION_NAG_DAYS = 14;

function maxPerRun(): number {
  const raw = process.env.MEETING_SUMMARY_MAX_PER_RUN?.trim();
  if (!raw) return DEFAULT_MAX_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PER_RUN;
  return Math.floor(n);
}

// Connector registry — supporting a new publishing platform is a new entry
// here plus one module under modules/civic.meeting_summary/connectors.
//
//   wix-cms             Reads the CMS collection behind a Wix page. Structured
//                       rows, works even when the page renders client-side.
//                       Needs MEETING_SOURCE_URL.
//   floyd-minutes-page  Generic HTML + Claude reader. Works on ANY
//                       server-rendered listing page, whatever engine — the
//                       universal fallback. Needs MEETING_SOURCE_URL.
//   youtube-channel     Reads a government's YouTube channel feed. Recordings
//                       only, no documents. Needs MEETING_YOUTUBE_CHANNEL_ID.
const CONNECTORS: Record<string, MeetingSourceConnector> = {
  "wix-cms": wixCmsConnector,
  "floyd-minutes-page": floydMinutesConnector,
  "youtube-channel": youtubeChannelConnector,
};

/** Connectors that read a page and therefore require MEETING_SOURCE_URL. */
const PAGE_CONNECTOR_IDS = new Set(["wix-cms", "floyd-minutes-page"]);

/**
 * The order "auto" tries connectors in — best source first.
 *
 * Structured data beats prompt-driven HTML extraction (exact fields, no model
 * drift, full history). Documents beat recordings, because minutes are the
 * authoritative record and a transcript is a fallback. A connector whose
 * configuration is absent is skipped, not failed.
 */
const AUTO_ORDER = ["wix-cms", "floyd-minutes-page", "youtube-channel"] as const;

/**
 * Identity of a meeting for dedupe and upgrade matching.
 *
 * Date alone is not enough: two different meetings share a date often enough
 * that keying on it drops real meetings (see the Budget Workshop / Regular
 * Meeting pair on 2026-06-23). Title is normalized so trivial punctuation or
 * casing differences between a connector's runs don't fork one meeting in two.
 */
function meetingKey(date: string, title: string): string {
  const normalized = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${date}::${normalized}`;
}

/**
 * Today's date in ISO form, for comparing against a meeting date.
 *
 * Deliberately UTC-simple: meeting dates are calendar dates with no timezone,
 * and being a few hours conservative about "has this happened" is the safe
 * direction — a summary written a day late is fine, one written before the
 * meeting is not.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A summary is stale when it was generated before the meeting it describes
 * had happened.
 *
 * Floyd posts agendas ~4 days ahead and recordings ~1 day after, so the cron
 * would reliably catch the agenda first and write a summary of PLANNED topics
 * — then never revisit it, because the upgrade pass only fired on minutes.
 * The 2026-08-25 meeting sat that way: summarized 2026-08-22 from the agenda,
 * recording posted 2026-08-26, nothing re-read it.
 */
function summaryPredatesMeeting(state: {
  generated_at?: string;
  meeting_date?: string;
}): boolean {
  const generated = (state.generated_at ?? "").slice(0, 10);
  const meeting = state.meeting_date ?? "";
  if (!generated || !meeting) return false;
  return generated < meeting;
}

/** Whether a connector has enough configuration to be worth attempting. */
function isConfigured(id: string, cfg: MeetingSummaryConfig): boolean {
  if (PAGE_CONNECTOR_IDS.has(id)) return Boolean(cfg.source_url);
  if (id === "youtube-channel") return Boolean(cfg.channel_id);
  return true;
}

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

interface CronOutcome {
  discovered: number;
  created: number;
  skippedExisting: number;
  failed: number;
  failures: Array<{ source_id: string; error: string }>;
  duration_ms: number;
  connector_id: string;
  /** Published feed cards whose page no longer resolves. */
  brokenLinks?: BrokenPublication[];
  /** Summaries still describing a meeting that had not happened when written. */
  staleSummaries?: Array<{ meeting_date: string; meeting_title: string; generated_at: string }>;
  /** Revisions sitting unreviewed past the nag threshold. */
  staleRevisions?: Array<{ meeting_date: string; meeting_title: string; waiting_days: number }>;
  /** Set when the run aborted before finishing (discovery threw, config invalid). */
  fatal?: string;
}

/**
 * Why the run deserves an email, or null when it was genuinely uneventful.
 *
 * THIS IS THE GUARD THAT WAS MISSING. The previous version only notified
 * when `failed > 0`, which made two very different outcomes indistinguishable
 * from success:
 *
 *   1. Discovery returned zero entries. When Floyd County moved its
 *      agendas-and-minutes page to client-side rendering, `fetch()` began
 *      returning a shell with no meeting links in it. Discovery dutifully
 *      reported "0 meetings", the run exited 200 OK with failed=0, and the
 *      pipeline stayed silent for weeks while everyone assumed it was fine.
 *   2. The batch threw outright (bad config, discovery error). The catch
 *      block returned 500 to a cron caller that reads nobody's response.
 *
 * A source that has ever worked and now yields nothing is the single most
 * likely symptom of an upstream change, so it is reported as a failure, not
 * as an empty success.
 */
export function cronAlertReason(outcome: CronOutcome): string | null {
  if (outcome.fatal) {
    return `the run aborted: ${outcome.fatal}`;
  }
  if (outcome.discovered === 0) {
    return (
      `discovery returned 0 meetings from connector "${outcome.connector_id}". ` +
      `Either the source genuinely lists no meetings, or — far more likely — ` +
      `it changed shape and can no longer be read.`
    );
  }
  if (outcome.failed > 0) {
    return `${outcome.failed} meeting(s) failed to summarize.`;
  }
  if (outcome.staleRevisions && outcome.staleRevisions.length > 0) {
    // Nothing is broken — the published version is still serving — but an
    // improvement is sitting unread, and silence would let it sit forever.
    return (
      `${outcome.staleRevisions.length} revision(s) have been waiting for review ` +
      `longer than ${REVISION_NAG_DAYS} days. The published summaries are ` +
      `unaffected, but the newer versions are not reaching residents.`
    );
  }
  if (outcome.staleSummaries && outcome.staleSummaries.length > 0) {
    // The Aug 2026 case: a summary written from the agenda three days before
    // the meeting, never revisited once the recording appeared. Every counter
    // read clean because nothing failed — the summary simply described the
    // wrong thing.
    return (
      `${outcome.staleSummaries.length} summary/summaries still describe a meeting ` +
      `that had not happened when they were written, and no newer source was ` +
      `available to replace them.`
    );
  }
  if (outcome.brokenLinks && outcome.brokenLinks.length > 0) {
    // The counters can all read zero while readers get 404s: this run's
    // predecessor unpublished two live pages and reported complete success.
    return (
      `${outcome.brokenLinks.length} published feed card(s) point at a page ` +
      `that no longer resolves. Readers clicking them get nothing.`
    );
  }
  return null;
}

/**
 * Email admins when a run is worth their attention. Best-effort: a bounced
 * notification must never fail the run itself.
 */
async function notifyCronOutcome(outcome: CronOutcome): Promise<void> {
  const reason = cronAlertReason(outcome);
  if (!reason) return;

  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.warn(
      `[meeting-summary] would have alerted admins (${reason}) but ` +
        `CIVIC_ADMIN_EMAILS is empty — nobody is watching this cron.`,
    );
    return;
  }

  const headline = outcome.fatal
    ? "failed"
    : outcome.discovered === 0
      ? "found no meetings"
      : `completed with ${outcome.failed} failure(s)`;

  const subject = `[Civic Hub] Meeting summary cron ${headline}`;
  const failureLines = outcome.failures
    .map((f) => `<li><code>${f.source_id}</code>: ${f.error}</li>`)
    .join("\n");
  const html = `
    <p>The meeting summary cron ${headline}.</p>
    <p><strong>Why you're getting this:</strong> ${reason}</p>
    ${failureLines ? `<ul>${failureLines}</ul>` : ""}
    ${
      outcome.staleSummaries && outcome.staleSummaries.length > 0
        ? `<p><strong>Summaries written before their meeting happened</strong> — these describe planned topics, not the meeting:</p><ul>${outcome.staleSummaries
            .map(
              (t) =>
                `<li>${t.meeting_date} — ${t.meeting_title} (written ${t.generated_at.slice(0, 10)})</li>`,
            )
            .join("\n")}</ul>`
        : ""
    }
    ${
      outcome.brokenLinks && outcome.brokenLinks.length > 0
        ? `<p><strong>Broken feed links</strong> — published cards whose page 404s:</p><ul>${outcome.brokenLinks
            .map(
              (b) =>
                `<li><code>${b.process_id}</code> (${b.process_type}, published ${b.published_at.slice(0, 10)}): ${b.reason}</li>`,
            )
            .join("\n")}</ul>`
        : ""
    }
    <p>Connector: <code>${outcome.connector_id}</code><br/>
       Discovered: ${outcome.discovered} |
       Created: ${outcome.created} |
       Skipped existing: ${outcome.skippedExisting} |
       Failed: ${outcome.failed} |
       Duration: ${outcome.duration_ms}ms</p>
    <p>Run it by hand to see the full trace:<br/>
       <code>npx tsx scripts/diagnoseMeetingSummary.ts</code></p>
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

/**
 * Fire the alert and return the response body for a run that never got off
 * the ground (missing key, unknown connector, discovery threw). These used
 * to return 500 and tell nobody.
 */
async function failRun(
  res: Response,
  status: number,
  message: string,
  partial: Partial<CronOutcome> = {},
): Promise<void> {
  const outcome: CronOutcome = {
    discovered: 0,
    created: 0,
    skippedExisting: 0,
    failed: 0,
    failures: [],
    duration_ms: 0,
    connector_id: "unknown",
    ...partial,
    fatal: message,
  };
  console.error(`[meeting-summary] run aborted: ${message}`);
  res.status(status).json({
    error: message,
    discovered: outcome.discovered,
    created: outcome.created,
    skipped_existing: outcome.skippedExisting,
    failed: outcome.failed,
    duration_ms: outcome.duration_ms,
  });
  await notifyCronOutcome(outcome).catch((err) => {
    console.warn(
      `[meeting-summary] notification send error: ${err instanceof Error ? err.message : "unknown"}`,
    );
  });
}

/**
 * Run discovery, honoring "auto".
 *
 * In auto mode each configured connector is tried in AUTO_ORDER and the first
 * one returning meetings wins. A connector that throws is logged and the ladder
 * continues — a Wix endpoint change should fall through to HTML scraping, not
 * take the run down. If every rung comes up empty the caller sees zero
 * meetings and the alarm fires, with `attempts` naming what was tried.
 */
async function runDiscovery(
  requestedId: string,
  cfg: MeetingSummaryConfig,
  deps: Parameters<typeof discoverMeetings>[2],
): Promise<{
  entries: MeetingEntry[];
  connectorId: string;
  attempts: Array<{ id: string; outcome: string }>;
}> {
  const attempts: Array<{ id: string; outcome: string }> = [];

  if (requestedId !== "auto") {
    const connector = CONNECTORS[requestedId];
    const entries = await discoverMeetings(connector, cfg, deps);
    return { entries, connectorId: connector.id, attempts };
  }

  for (const id of AUTO_ORDER) {
    if (!isConfigured(id, cfg)) {
      attempts.push({ id, outcome: "skipped (not configured)" });
      continue;
    }
    try {
      const entries = await discoverMeetings(CONNECTORS[id], cfg, deps);
      if (entries.length > 0) {
        attempts.push({ id, outcome: `${entries.length} meeting(s)` });
        console.log(`[meeting-summary] auto: "${id}" won with ${entries.length} meeting(s)`);
        return { entries, connectorId: id, attempts };
      }
      attempts.push({ id, outcome: "0 meetings" });
      console.warn(`[meeting-summary] auto: "${id}" returned no meetings — trying next`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      attempts.push({ id, outcome: `error: ${msg}` });
      console.warn(`[meeting-summary] auto: "${id}" failed (${msg}) — trying next`);
    }
  }

  return { entries: [], connectorId: "auto", attempts };
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
    await failRun(
      res,
      500,
      "ANTHROPIC_API_KEY must be set. Create a key at https://console.anthropic.com and add it to Vercel env vars.",
    );
    return;
  }

  const connectorId = process.env.MEETING_CONNECTOR_ID?.trim() || DEFAULT_CONNECTOR_ID;
  if (connectorId !== "auto" && !CONNECTORS[connectorId]) {
    await failRun(
      res,
      500,
      `Unknown MEETING_CONNECTOR_ID "${connectorId}". Known: auto, ${Object.keys(CONNECTORS).join(", ")}`,
      { connector_id: connectorId },
    );
    return;
  }

  const sourceUrl = process.env.MEETING_SOURCE_URL?.trim() ?? "";
  const channelId = process.env.MEETING_YOUTUBE_CHANNEL_ID?.trim() ?? "";

  const cfg: MeetingSummaryConfig = {
    source_url: sourceUrl,
    channel_id: channelId,
    title_filter: process.env.MEETING_TITLE_FILTER?.trim() ?? "",
    type_exclude: process.env.MEETING_TYPE_EXCLUDE?.trim() ?? "",
    collection_name: process.env.MEETING_WIX_COLLECTION?.trim() ?? "",
    extraction_instructions: resolveEffectiveInstructions(
      process.env.MEETING_EXTRACTION_INSTRUCTIONS ?? "",
    ),
    model: modelName(),
  };

  if (connectorId !== "auto" && !isConfigured(connectorId, cfg)) {
    await failRun(
      res,
      500,
      PAGE_CONNECTOR_IDS.has(connectorId)
        ? `MEETING_SOURCE_URL must be set for the "${connectorId}" connector.`
        : `MEETING_YOUTUBE_CHANNEL_ID must be set for the "${connectorId}" connector.`,
      { connector_id: connectorId },
    );
    return;
  }

  if (connectorId === "auto" && !sourceUrl && !channelId) {
    await failRun(
      res,
      500,
      "No source configured. Set MEETING_SOURCE_URL (the jurisdiction's " +
        "agendas-and-minutes page) and/or MEETING_YOUTUBE_CHANNEL_ID.",
      { connector_id: "auto" },
    );
    return;
  }

  const started = Date.now();
  let discovered = 0;
  let created = 0;
  let skippedExisting = 0;
  let failed = 0;
  let usedConnectorId = connectorId;
  let brokenLinks: BrokenPublication[] = [];
  const failures: Array<{ source_id: string; error: string }> = [];

  try {
    console.log(
      `[meeting-summary] run started connector=${connectorId} ` +
        `source=${cfg.source_url || cfg.channel_id || "(none)"}`,
    );

    const discoveryStart = Date.now();
    const discovery = await runDiscovery(connectorId, cfg, {
      fetchHtml,
      fetchXml,
      fetchJson,
      callClaude,
    });
    const entries = discovery.entries;
    usedConnectorId = discovery.connectorId;
    discovered = entries.length;
    console.log(
      `[meeting-summary] discovery done connector=${usedConnectorId} ` +
        `entries=${discovered} duration_ms=${Date.now() - discoveryStart}`,
    );

    // Zero discovered entries is the signature of a source that changed
    // shape underneath us, not a quiet month. Say so loudly here; the
    // alert itself is raised by notifyCronOutcome below.
    if (discovered === 0) {
      const ladder = discovery.attempts.length > 0
        ? ` Tried: ${discovery.attempts.map((a) => `${a.id} → ${a.outcome}`).join("; ")}.`
        : "";
      console.error(
        `[meeting-summary] DISCOVERY EMPTY — no connector returned meetings.` +
          ladder +
          ` This is reported as a failure, not an empty success: a source that ` +
          `stops parsing looks exactly like a source with no meetings. Run ` +
          `"npx tsx scripts/diagnoseMeetingSummary.ts" to see the raw source.`,
      );
    }

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

    // Build the set of existing source_ids and a map of provisional
    // (agenda- or recording-sourced) summaries eligible for upgrade once
    // minutes become available.
    //
    // Keyed by date AND meeting title, not date alone. A jurisdiction
    // routinely holds two distinct meetings on one day — Floyd ran a Budget
    // Workshop and a Regular Meeting on 2026-06-23, each with its own agenda
    // and minutes. Keying on the date alone made the second meeting look like
    // a duplicate of the first, so it was silently skipped and its upgrade
    // would have overwritten the wrong summary.
    const allProcesses = await getAllProcesses();
    const existingSourceIds = new Set<string>();
    // Primary match: a provisional summary carrying this exact source_id.
    const provisionalBySourceId = new Map<string, typeof allProcesses[0]>();
    // Secondary bridge, for summaries whose source_id was minted by a
    // different connector (or by an older scheme keyed on the PDF URL, which
    // changed when minutes replaced an agenda). Holds every candidate so an
    // ambiguous match can be declined rather than guessed.
    const provisionalByMeeting = new Map<string, Array<typeof allProcesses[0]>>();
    // Cross-connector identity: every summary indexed by the documents and
    // recordings it was built from. This is what survives a connector change —
    // `source_id` does not. Without it, switching Floyd from HTML scraping to
    // the Wix CMS would make all 48 existing summaries invisible to dedupe and
    // the cron would summarize every one of them a second time.
    const bySourceFingerprint = new Map<string, typeof allProcesses[0]>();
    // Last-resort dedupe: how many summaries already exist per meeting.
    //
    // Document fingerprints are the precise match, but they only work while the
    // documents persist. A jurisdiction that replaces an agenda PDF with a
    // revised one, or removes a recording, leaves an existing summary with
    // nothing in common with the freshly discovered entry — and the meeting
    // gets summarized a second time. Counting per meeting closes that without
    // reintroducing the same-day collision bug: if a date+type genuinely has
    // two meetings, two summaries are expected and only the surplus is created.
    const existingSlots = new Map<string, number>();
    for (const p of allProcesses) {
      if (p.definition.type !== "civic.meeting_summary") continue;
      const s = summaryState(p);
      if (typeof s?.source_id === "string") {
        existingSourceIds.add(s.source_id);
        for (const fp of sourceFingerprints(s)) {
          if (!bySourceFingerprint.has(fp)) bySourceFingerprint.set(fp, p);
        }
        // Agenda- and recording-sourced summaries are provisional: both get
        // re-summarized when the official minutes for that date appear.
        const slotKey = meetingKey(s.meeting_date, s.meeting_title);
        existingSlots.set(slotKey, (existingSlots.get(slotKey) ?? 0) + 1);
        const sourceType = (s.source_type ?? "minutes") as MeetingSourceType;
        if (UPGRADEABLE_SOURCE_TYPES.includes(sourceType)) {
          provisionalBySourceId.set(s.source_id, p);
          const key = meetingKey(s.meeting_date, s.meeting_title);
          const bucket = provisionalByMeeting.get(key);
          if (bucket) bucket.push(p);
          else provisionalByMeeting.set(key, [p]);
        }
      }
    }

    /**
     * The existing provisional summary this entry should upgrade, or null.
     *
     * Exact source_id wins. Falling back to date-and-title is only safe when
     * that identifies exactly ONE summary: Floyd ran two separate Budget
     * Workshop Meetings on 2023-04-11, and picking either arbitrarily would
     * overwrite a real summary with another meeting's content. When it is
     * ambiguous we decline to match, which at worst creates a second summary
     * an admin can merge — strictly better than silently clobbering one.
     */
    const provisionalFor = (
      entry: MeetingEntry,
    ): typeof allProcesses[0] | null => {
      const exact = provisionalBySourceId.get(entry.source_id);
      if (exact) return exact;
      const bucket = provisionalByMeeting.get(
        meetingKey(entry.meeting_date, entry.meeting_title),
      );
      return bucket && bucket.length === 1 ? bucket[0] : null;
    };

    /**
     * Any existing summary — provisional or final — built from the same
     * documents or recording as this entry. Matching here means "we already
     * covered this meeting", regardless of which connector found it.
     */
    const existingByDocuments = (
      entry: MeetingEntry,
    ): typeof allProcesses[0] | null => {
      for (const fp of sourceFingerprints(entry)) {
        const hit = bySourceFingerprint.get(fp);
        if (hit) return hit;
      }
      return null;
    };

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
      // A meeting that has not happened yet has only an agenda, and an agenda
      // describes what is PLANNED. Summarizing it produces a document that
      // reads like a record of the meeting while predating it — and until the
      // upgrade fix below, nothing ever corrected it. Wait for the meeting.
      if (entry.meeting_date > todayIso()) {
        console.log(
          `[meeting-summary] ${entry.meeting_date} "${entry.meeting_title}" has not ` +
            `happened yet — deferring until there is a record to summarize`,
        );
        continue;
      }

      const slotKey = meetingKey(entry.meeting_date, entry.meeting_title);
      const consumeSlot = () => {
        const remaining = existingSlots.get(slotKey) ?? 0;
        if (remaining > 0) existingSlots.set(slotKey, remaining - 1);
      };

      if (
        existingSourceIds.has(entry.source_id) ||
        provisionalFor(entry) ||
        existingByDocuments(entry)
      ) {
        consumeSlot();
        skippedExisting += 1;
        continue;
      }

      // No shared id and no shared document — but a summary for this same
      // meeting already exists and has not been claimed by another entry this
      // run. Treat it as covered rather than summarizing the meeting twice.
      if ((existingSlots.get(slotKey) ?? 0) > 0) {
        consumeSlot();
        skippedExisting += 1;
        console.log(
          `[meeting-summary] ${slotKey} already has a summary with no shared ` +
            `documents (source files likely replaced upstream) — skipping`,
        );
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
    //
    // Shares the per-run budget with creation. An upgrade costs exactly what a
    // creation costs — a PDF fetch, a transcript fetch and a full Claude call —
    // so leaving it uncapped let a single run make an unbounded number of model
    // calls inside a 300-second function. It also resets each upgraded summary
    // to "pending", so an uncapped pass can flood the review queue with items
    // an admin had already approved.
    let upgraded = 0;
    if (provisionalBySourceId.size > 0 || bySourceFingerprint.size > 0) {
      for (const entry of filteredEntries) {
        if (created + upgraded >= perRunCap) {
          console.log(
            `[meeting-summary] cap reached (${perRunCap}); remaining upgrades deferred to next run`,
          );
          break;
        }
        // Two things justify re-summarizing: official minutes appearing, or a
        // recording appearing for a summary that predates its own meeting.
        // The second case is the common one — the county posts agendas days
        // ahead and recordings a day after — and it used to be invisible.
        if (!entry.source_minutes_url && !entry.source_video_url) continue;
        // Upgrade the summary this meeting's documents already belong to, if
        // it is still provisional; otherwise fall back to id/date+title match.
        const byDocs = existingByDocuments(entry);
        const upgradeable =
          byDocs &&
          UPGRADEABLE_SOURCE_TYPES.includes(
            (summaryState(byDocs).source_type ?? "minutes") as MeetingSourceType,
          )
            ? byDocs
            : null;
        const existing = upgradeable ?? provisionalFor(entry);
        if (!existing) continue;

        const existingState = summaryState(existing);

        // A revision is already waiting on this summary. Regenerating would
        // just replace one unreviewed candidate with another and burn the
        // per-run budget doing it.
        if (existingState.pending_revision) continue;

        // Skip when there is nothing new to say: no minutes to add, and the
        // existing summary was already written after the meeting happened.
        if (!entry.source_minutes_url && !summaryPredatesMeeting(existingState)) {
          continue;
        }
        // An admin who edited a summary owns its wording — but only the path
        // that would DESTROY that work needs guarding.
        //
        // A published summary gets a revision, which waits for review: the
        // admin sees both versions and decides, so their edits are replaced
        // only by their own choice. Skipping regeneration there would mean an
        // edited summary silently never receives the official minutes.
        //
        // A summary still in review is replaced in place, with nothing to
        // compare against and no decision point. That is where edits vanish,
        // so that is where the guard belongs.
        const editedAndUnpublished =
          (existingState.edit_count ?? 0) > 0 &&
          existingState.approval_status !== "published";
        if (editedAndUnpublished) {
          if (
            entry.source_minutes_url &&
            existingState.source_minutes_url !== entry.source_minutes_url
          ) {
            existingState.source_minutes_url = entry.source_minutes_url;
            existing.state = existingState as unknown as Record<string, unknown>;
            await saveProcessState(existing);
            console.log(
              `[meeting-summary] ${entry.source_id} was admin-edited and is not ` +
                `published (edit_count=${existingState.edit_count}) — attached the ` +
                `minutes link but kept the reviewed text`,
            );
          }
          continue;
        }

        const meetingStart = Date.now();
        try {
          console.log(
            `[meeting-summary] upgrading source_id=${entry.source_id} ` +
              `(${entry.source_minutes_url ? "minutes now available" : "recording now available"})`,
          );
          const summary = await summarizeMeeting(entry, cfg, {
            fetchPdf,
            fetchYouTubeTranscript,
            callClaude,
          });
          const state = summaryState(existing);
          const nowIso = new Date().toISOString();
          const reason = entry.source_minutes_url
            ? "Official minutes have been published for this meeting."
            : "A recording of this meeting is now available; the previous summary was written before it took place.";

          // A summary that is already public gets a REVISION, reviewed before
          // residents see it, with the live version untouched meanwhile. One
          // that is still in review has no public version to protect, so it is
          // replaced directly rather than queueing a review inside a review.
          if (state.approval_status === "published") {
            stageRevision(state, {
              blocks: summary.blocks,
              source_minutes_url: entry.source_minutes_url,
              source_agenda_url: entry.source_agenda_url,
              source_type: summary.sourceType,
              reason,
              ai_instructions_used: summary.ai_instructions_used,
              ai_model: summary.model,
              generated_at: nowIso,
            });
            existing.state = state as unknown as Record<string, unknown>;
            await saveProcessState(existing);
            console.log(
              `[meeting-summary] staged revision for published process=${existing.id} ` +
                `source_id=${entry.source_id} — awaiting admin review`,
            );
            upgraded += 1;
            continue;
          }

          state.source_id = entry.source_id;
          state.source_minutes_url = entry.source_minutes_url;
          state.source_agenda_url = entry.source_agenda_url;
          state.source_type = summary.sourceType;
          state.blocks = summary.blocks;
          state.ai_instructions_used = summary.ai_instructions_used;
          state.ai_model = summary.model;
          state.generated_at = nowIso;

          // An already-published summary keeps its published state.
          //
          // Sending it back to "pending" clears published_at, and
          // getPublicReadModel serves nothing for an unpublished summary — so
          // a page that residents already had links to would 404 from the
          // moment the upgrade ran until an admin happened to re-approve it.
          // Re-approval then emits a SECOND result_published, leaving a stale
          // duplicate card in the feed. Both happened on Floyd's 2026-06-23
          // summary.
          //
          // Upgrading in place is safe because the swap is strictly toward
          // authority — official minutes replacing an agenda or a transcript —
          // and the content is regenerated by the same reviewed pipeline. The
          // update is announced so the change is on the record and the admin
          // surfaces can show it; an unpublished summary still routes through
          // review as before.
          // Still in review: it stays in review with better content.
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

    // Any summary still describing a meeting it predates, after the upgrade
    // pass has had its chance to replace it. Recomputed from storage rather
    // than tracked through the loop so it also catches records this run never
    // touched.
    const staleSummaries = (await getAllProcesses().catch(() => []))
      .filter((p) => p.definition.type === "civic.meeting_summary")
      .map((p) => summaryState(p))
      .filter((st) => summaryPredatesMeeting(st))
      .map((st) => ({
        meeting_date: st.meeting_date,
        meeting_title: st.meeting_title,
        generated_at: st.generated_at,
      }));
    if (staleSummaries.length > 0) {
      console.error(
        `[meeting-summary] ${staleSummaries.length} summary/summaries predate their ` +
          `own meeting: ${staleSummaries.map((t) => t.meeting_date).join(", ")}`,
      );
    }

    // Revisions nobody has reviewed. Not a failure — the published version is
    // still serving correctly — but an improvement that is not reaching anyone.
    const nowMs = Date.now();
    const staleRevisions = (await getAllProcesses().catch(() => []))
      .filter((p) => p.definition.type === "civic.meeting_summary")
      .map((p) => summaryState(p))
      .filter((st) => st.pending_revision)
      .map((st) => ({
        meeting_date: st.meeting_date,
        meeting_title: st.meeting_title,
        waiting_days: Math.floor(
          (nowMs - Date.parse(st.pending_revision!.generated_at)) / 86_400_000,
        ),
      }))
      .filter((r) => Number.isFinite(r.waiting_days) && r.waiting_days >= REVISION_NAG_DAYS);
    if (staleRevisions.length > 0) {
      console.warn(
        `[meeting-summary] ${staleRevisions.length} revision(s) waiting > ${REVISION_NAG_DAYS} days: ` +
          staleRevisions.map((r) => `${r.meeting_date} (${r.waiting_days}d)`).join(", "),
      );
    }

    // Verify the reader-facing invariant before declaring the run clean: every
    // published card still resolves. This is the check the counters cannot do —
    // the run that unpublished two live pages reported zero failures.
    try {
      brokenLinks = await findBrokenPublications();
      if (brokenLinks.length > 0) {
        console.error(
          `[meeting-summary] ${brokenLinks.length} published feed card(s) point ` +
            `at a page that 404s: ${brokenLinks
              .map((b) => `${b.process_id} (${b.reason})`)
              .join("; ")}`,
        );
      } else {
        console.log("[meeting-summary] feed link check: all published cards resolve");
      }
    } catch (err) {
      // A failed health check must never fail the run that produced good work.
      console.warn(
        `[meeting-summary] feed link check errored: ${err instanceof Error ? err.message : "unknown"}`,
      );
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
      broken_links: brokenLinks.length,
      stale_summaries: staleSummaries.length,
      pending_revisions_overdue: staleRevisions.length,
      duration_ms,
    });

    notifyCronOutcome({
      discovered,
      created,
      skippedExisting,
      failed,
      failures,
      duration_ms,
      connector_id: usedConnectorId,
      brokenLinks,
      staleSummaries,
      staleRevisions,
    }).catch((err) => {
      console.warn(
        `[meeting-summary] notification send error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const duration_ms = Date.now() - started;
    // A throw here used to return 500 to a cron caller that reads nobody's
    // response — the loudest possible failure, delivered to no one. Alert.
    await failRun(res, 500, message, {
      discovered,
      created,
      skippedExisting,
      failed,
      failures,
      duration_ms,
      connector_id: usedConnectorId,
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
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.meeting_summary") {
      res.status(404).json({ error: "Meeting summary not found" });
      return;
    }
    const state = summaryState(record);
    if (!state.pending_revision) {
      res.status(409).json({ error: "No revision is waiting for review." });
      return;
    }
    apply(state);
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
        { keepRawId: true },
      ),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export async function handleAcceptMeetingSummaryRevision(
  req: Request,
  res: Response,
): Promise<void> {
  // No publication event: the summary was already published and stays
  // published. The feed marks it "Updated" from revised_at rather than
  // floating a month-old meeting back to the top.
  await withRevision(
    req,
    res,
    (state) => acceptRevision(state),
    "Revision accepted. The published summary now reflects it.",
  );
}

export async function handleDiscardMeetingSummaryRevision(
  req: Request,
  res: Response,
): Promise<void> {
  await withRevision(
    req,
    res,
    (state) => discardRevision(state),
    "Revision discarded. The published summary is unchanged.",
  );
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
