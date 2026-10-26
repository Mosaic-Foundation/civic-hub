// The "meeting_summary" job (src/jobs/registry.ts): finds a hub's new
// meetings and writes a draft civic.meeting_summary for each.
//
// Runs once per active hub, inside that hub's scope (src/jobs/runJob.ts), which
// has already checked the cron credential and plugin.meeting_summary.enabled.
// Every setting it reads is that hub's `plugin.meeting_summary.*` (see
// ./config.ts). Loads the hub's configured MeetingSourceConnector, discovers
// meeting entries, summarizes new ones via Claude and creates one summary
// process per entry; re-summarizes provisional (agenda- or recording-sourced)
// summaries once better sources appear.
// Per-meeting failures are isolated: one bad meeting does not abort the batch.
// Returns a JobOutcome: 200 with the counts (or a skip reason), or 500 with an
// error when the run could not start or aborted. Runs worth an admin's
// attention are mailed to the hub's admins (src/services/cronAlerts.ts).
// The admin review queue and the public read are the handlers in
// controller.ts.

import {
  emitEvent,
  createProcess,
  getAllProcesses,
  getArchivedProcesses,
  saveProcessState,
  findBrokenPublications,
  type BrokenPublication,
  REVISION_NAG_DAYS,
  type CronOutcome,
  type FlaggedSummary,
  type WaitingMeeting,
  getSettingSync,
  KEYS,
  processJurisdiction,
  type AiSingleTurnInput,
  type JobOutcome,
  type JobRunner,
  type PluginAdapters,
} from "../../src/sdk/index.js";
import {
  approveMeetingSummary,
  effectiveQualityFlag,
  buildCreateInput,
  buildDescription,
  discoverMeetings,
  emitCreationEvents,
  sourceFingerprints,
  stageRevision,
  summarizeMeeting,
  UPGRADEABLE_SOURCE_TYPES,
  AUTO_ORDER,
  CONNECTORS,
  isConfigured,
  resolveMeetingSummaryConfig,
  daysSinceMeeting,
  newestMeetingDate,
  isMeetingNotReady,
  meetingHasHappened,
  RECORD_GRACE_DAYS,
  SOURCE_QUIET_DAYS,
  daysSetting,
  summaryPredatesMeeting,
  todayIso,
  type MeetingEntry,
  type MeetingSourceType,
  type MeetingSummaryConfig,
  type MeetingSummaryProcessState,
} from "./api.js";
import { meetingSummaryHost } from "./host.js";
/** The meeting summary's model calls, through the ai adapter's gate, as a job. */
const callClaude = (input: AiSingleTurnInput) => meetingSummaryHost.get().adapter("ai").complete("job.meeting_summary", input);
/** A recording's transcript, through the video adapter. */
const fetchYouTubeTranscript = (url: string) => meetingSummaryHost.get().adapter("video").transcript(url);
// The meeting pages, through the hub's fetchers (the grant's `web`), and the
// admins told, through its mail (the grant's `mail`).
const web = () => meetingSummaryHost.get().adapter("web");
const fetchHtml = (url: string) => web().fetchHtml(url);
const fetchXml = (url: string) => web().fetchXml(url);
const fetchJson: ReturnType<typeof web>["fetchJson"] = (...args) => web().fetchJson(...args);
const fetchPdf: ReturnType<typeof web>["fetchPdf"] = (...args) => web().fetchPdf(...args);
const notifyCronOutcome: PluginAdapters["mail"]["notifyJobOutcome"] = (...args) =>
  meetingSummaryHost.get().adapter("mail").notifyJobOutcome(...args);

const CRON_ACTOR = "system:meeting-summary-cron";
const DEFAULT_MAX_PER_RUN = 3;

/** How long a meeting may wait for its record before the run reports it (record_grace_days). */
function recordGraceDays(): number {
  return daysSetting(getSettingSync(KEYS.PLUGIN_MEETING_RECORD_GRACE_DAYS), RECORD_GRACE_DAYS);
}

/** How long without a new meeting before the run asks for a check (source_quiet_days). */
function sourceQuietDays(): number {
  return daysSetting(getSettingSync(KEYS.PLUGIN_MEETING_SOURCE_QUIET_DAYS), SOURCE_QUIET_DAYS);
}

function maxPerRun(): number {
  const raw = getSettingSync(KEYS.PLUGIN_MEETING_MAX_PER_RUN)?.trim();
  if (!raw) return DEFAULT_MAX_PER_RUN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PER_RUN;
  return Math.floor(n);
}

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

// todayIso, meetingHasHappened and summaryPredatesMeeting live in the module
// (./readiness.ts) since 2026-09-29, so the
// tests exercise the real rules rather than copies of them.

/**
 * Does the freshly discovered entry carry a source the stored summary lacks?
 *
 * A record is written from whatever existed at the time. Jurisdictions publish
 * asynchronously — Floyd posts an agenda days ahead, the recording a day after
 * the meeting, minutes weeks later — so a summary written early is missing
 * sources that exist now. That gap is itself the reason to re-summarize, and
 * checking it directly is more honest than enumerating which document happened
 * to arrive.
 *
 * It also repairs records silently: the 2026-08-25 summary was regenerated
 * FROM the transcript (its blocks carry real timestamps) while the row kept
 * `source_video_url: null` from creation, so the timestamps had no video to
 * link into and the page claimed no recording existed.
 */
function offersNewSources(
  entry: MeetingEntry,
  state: MeetingSummaryProcessState,
): boolean {
  if (entry.source_minutes_url && !state.source_minutes_url) return true;
  if (entry.source_video_url && !state.source_video_url) return true;
  if (entry.source_agenda_url && !state.source_agenda_url) return true;
  return false;
}

export function summaryState(
  record: { state: Record<string, unknown> },
): MeetingSummaryProcessState {
  return record.state as unknown as MeetingSummaryProcessState;
}

function modelName(): string {
  return meetingSummaryHost.get().adapter("ai").defaultModel();
}

function autoPublish(): boolean {
  const v = getSettingSync(KEYS.PLUGIN_MEETING_AUTO_PUBLISH)?.trim().toLowerCase();
  return v === "true";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cutoffDate(): string | null {
  const v = getSettingSync(KEYS.PLUGIN_MEETING_CUTOFF_DATE)?.trim();
  if (!v || !ISO_DATE_RE.test(v)) return null;
  return v;
}

/**
 * Fire the alert and return the outcome for a run that never got off
 * the ground (missing key, unknown connector, discovery threw). These used
 * to return 500 and tell nobody.
 */
async function failRun(
  status: number,
  message: string,
  partial: Partial<CronOutcome> = {},
): Promise<JobOutcome> {
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
  const result: JobOutcome = {
    status,
    body: {
      error: message,
      discovered: outcome.discovered,
      created: outcome.created,
      skipped_existing: outcome.skippedExisting,
      failed: outcome.failed,
      duration_ms: outcome.duration_ms,
    },
  };
  await notifyCronOutcome(outcome).catch((err) => {
    console.warn(
      `[meeting-summary] notification send error: ${err instanceof Error ? err.message : "unknown"}`,
    );
  });
  return result;
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

/**
 * One hub's run, inside that hub's scope: its connector, its source, its
 * filters, its admins for the alert, its jurisdiction on what it creates.
 */
export const meetingSummaryJob: JobRunner = async () => {
  const resolved = resolveMeetingSummaryConfig(modelName());
  if (resolved.status === "skipped") {
    return { status: 200, body: { skipped: true, reason: resolved.reason } };
  }
  if (resolved.status === "invalid") {
    return await failRun(500, resolved.reason, { connector_id: resolved.connectorId });
  }

  if (!meetingSummaryHost.get().adapter("ai").configured()) {
    return await failRun(
      500,
      "ANTHROPIC_API_KEY must be set. Create a key at https://console.anthropic.com and add it to Vercel env vars.",
    );
  }

  const { connectorId, cfg } = resolved;

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

    // Zero discovered entries is "nothing new" (review M7): a quiet source,
    // or a filter that matches nothing recent. Logged with the ladder so a
    // source that really stopped parsing can still be traced from here.
    if (discovered === 0) {
      const ladder = discovery.attempts.length > 0
        ? ` Tried: ${discovery.attempts.map((a) => `${a.id} → ${a.outcome}`).join("; ")}.`
        : "";
      console.warn(
        `[meeting-summary] discovery empty — no connector returned meetings.` +
          ladder +
          ` If the source does list meetings, run ` +
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
    // An archived summary is one an admin deleted, and the delete must stick
    // (review M5): it counts as "already covered" for every match below, so
    // the meeting is not summarized again, but it is never upgraded.
    // getAllProcesses() leaves archived rows out, so they are read here.
    const archivedSummaries = await getArchivedProcesses(["civic.meeting_summary"]);
    const archivedIds = new Set(archivedSummaries.map((p) => p.id));
    for (const p of [...allProcesses, ...archivedSummaries]) {
      if (p.definition.type !== "civic.meeting_summary") continue;
      const s = summaryState(p);
      if (typeof s?.source_id === "string") {
        existingSourceIds.add(s.source_id);
        for (const fp of sourceFingerprints(s)) {
          if (!bySourceFingerprint.has(fp)) bySourceFingerprint.set(fp, p);
        }
        const slotKey = meetingKey(s.meeting_date, s.meeting_title);
        existingSlots.set(slotKey, (existingSlots.get(slotKey) ?? 0) + 1);
        if (archivedIds.has(p.id)) continue;
        // Agenda- and recording-sourced summaries are provisional: both get
        // re-summarized when the official minutes for that date appear.
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
    const today = todayIso(new Date(), getSettingSync(KEYS.IDENTITY_TIMEZONE));
    const graceDays = recordGraceDays();
    const flagged: FlaggedSummary[] = [];
    const waiting: WaitingMeeting[] = [];
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
      // Strictly before today: on the meeting day itself the 11:30 UTC run is
      // the morning, US time, and the meeting may not have been held yet (the
      // 2026-09-22 summary was written that way).
      if (!meetingHasHappened(entry.meeting_date, today)) {
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
      const waitedDays = daysSinceMeeting(entry.meeting_date, today);
      try {
        const summary = await summarizeMeeting(
          entry,
          cfg,
          { fetchPdf, fetchYouTubeTranscript, callClaude },
          // Past the grace period, official minutes may go ahead without the
          // video's transcript — flagged, so an admin still decides.
          { allowMissingTranscript: waitedDays > graceDays },
        );

        const createInput = buildCreateInput(entry, summary);
        const description = buildDescription(summary.blocks);

        const newProcess = await createProcess({
          definition: { type: "civic.meeting_summary", version: "0.1" },
          title: `Meeting summary: ${entry.meeting_date}`,
          description,
          jurisdiction: processJurisdiction(),
          createdBy: CRON_ACTOR,
          state: createInput as unknown as Record<string, unknown>,
        });

        const state = summaryState(newProcess);
        const ctx = {
          process_id: newProcess.id,
          jurisdiction: newProcess.jurisdiction,
          emit: emitEvent,
        };
        await emitCreationEvents(ctx, CRON_ACTOR, state);

        // A flagged summary is held for review even when auto-publish is on.
        const publishNow = willAutoPublish && !state.quality_flag;
        if (publishNow) {
          await approveMeetingSummary(state, CRON_ACTOR, ctx);
          newProcess.status = "finalized";
          await saveProcessState(newProcess);
        }
        if (state.quality_flag) {
          flagged.push({
            process_id: newProcess.id,
            meeting_date: entry.meeting_date,
            meeting_title: entry.meeting_title,
            message: state.quality_flag.message,
          });
        }

        console.log(
          `[meeting-summary] created process=${newProcess.id} source_id=${entry.source_id} blocks=${summary.blocks.length} published=${publishNow} flagged=${state.quality_flag?.kind ?? "no"} duration_ms=${Date.now() - meetingStart}`,
        );
        created += 1;
      } catch (err) {
        if (isMeetingNotReady(err)) {
          // Not a failure: there is no record to summarize yet. Retried on
          // every run; reported once it has waited past the grace period.
          waiting.push({
            meeting_date: entry.meeting_date,
            meeting_title: entry.meeting_title,
            reason: err.message,
            days_since_meeting: waitedDays,
          });
          console.log(
            `[meeting-summary] waiting source_id=${entry.source_id} (${waitedDays}d since meeting): ${err.message}`,
          );
          continue;
        }
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

        // Skip only when there is genuinely nothing new: no source the record
        // is missing, the summary was already written after the meeting, and
        // it is not flagged. A flagged summary (no video timestamps) is tried
        // again while it is still within the grace period — the transcript
        // that was missing may exist now.
        const retryFlagged =
          !!effectiveQualityFlag(existingState) &&
          !!entry.source_video_url &&
          daysSinceMeeting(entry.meeting_date, today) <= graceDays;
        if (
          !offersNewSources(entry, existingState) &&
          !summaryPredatesMeeting(existingState) &&
          !retryFlagged
        ) {
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
          const summary = await summarizeMeeting(
            entry,
            cfg,
            { fetchPdf, fetchYouTubeTranscript, callClaude },
            {
              allowMissingTranscript:
                daysSinceMeeting(entry.meeting_date, today) > graceDays,
            },
          );
          const state = summaryState(existing);
          const nowIso = new Date().toISOString();
          if (summary.quality_flag) {
            flagged.push({
              process_id: existing.id,
              meeting_date: entry.meeting_date,
              meeting_title: entry.meeting_title,
              message: summary.quality_flag.message,
            });
          }
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
              source_video_url: entry.source_video_url,
              additional_video_urls: entry.additional_video_urls,
              source_type: summary.sourceType,
              reason,
              ai_instructions_used: summary.ai_instructions_used,
              ai_model: summary.model,
              generated_at: nowIso,
              quality_flag: summary.quality_flag,
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
          // Refreshing these is what makes block timestamps clickable: the UI
          // only links a timestamp when the record knows its video.
          state.source_video_url = entry.source_video_url;
          state.additional_video_urls = entry.additional_video_urls;
          state.source_type = summary.sourceType;
          state.blocks = summary.blocks;
          state.ai_instructions_used = summary.ai_instructions_used;
          state.ai_model = summary.model;
          state.generated_at = nowIso;
          state.quality_flag = summary.quality_flag;

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
          if (isMeetingNotReady(err)) {
            // The existing summary keeps serving; the stale-summary check
            // below still reports it if it predates its meeting.
            console.log(
              `[meeting-summary] upgrade waiting source_id=${entry.source_id}: ${err.message}`,
            );
            continue;
          }
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

    // How long since the newest meeting the hub knows of: what discovery
    // listed, and every summary it already has (archived ones too). describe.ts
    // flags the run past SOURCE_QUIET_DAYS: the source may have stopped working.
    const newestMeeting = newestMeetingDate([
      ...entries.map((e) => e.meeting_date),
      ...[...allProcesses, ...archivedSummaries]
        .filter((p) => p.definition.type === "civic.meeting_summary")
        .map((p) => summaryState(p)?.meeting_date),
    ]);
    const daysSinceNewestMeeting = newestMeeting ? daysSinceMeeting(newestMeeting, today) : null;

    const duration_ms = Date.now() - started;
    console.log(
      `[meeting-summary] run complete discovered=${discovered} created=${created} upgraded=${upgraded} skipped=${skippedExisting} failed=${failed} duration_ms=${duration_ms}`,
    );
    const resultBody = {
      discovered,
      created,
      upgraded,
      skipped_existing: skippedExisting,
      failed,
      // The list, not a count (review M4): process id, type, title and the
      // reason, which describe.ts turns into one problem line each.
      broken_links: brokenLinks.map(({ process_id, process_type, title, reason }) => ({
        process_id,
        process_type,
        title,
        reason,
      })),
      stale_summaries: staleSummaries.length,
      pending_revisions_overdue: staleRevisions.length,
      flagged,
      waiting,
      failures,
      newest_meeting_date: newestMeeting,
      days_since_newest_meeting: daysSinceNewestMeeting,
      // The hub's thresholds, so describe.ts judges the run by them (2026-10-16).
      record_grace_days: graceDays,
      source_quiet_days: sourceQuietDays(),
      duration_ms,
    };

    // Awaited, so a serverless function cannot be frozen before the mail goes.
    await notifyCronOutcome({
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
      flagged,
      waiting,
      graceDays,
    }).catch((err) => {
      console.warn(
        `[meeting-summary] notification send error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    });

    return { status: 200, body: resultBody };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const duration_ms = Date.now() - started;
    // A throw here used to return 500 to a cron caller that reads nobody's
    // response — the loudest possible failure, delivered to no one. Alert.
    return await failRun(500, message, {
      discovered,
      created,
      skippedExisting,
      failed,
      failures,
      duration_ms,
      connector_id: usedConnectorId,
    });
  }
};
