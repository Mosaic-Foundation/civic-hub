// civic.meeting_summary module — cron-run pipeline
//
// Pure functions taking injected callbacks. No I/O of its own — the host
// hub wires the real fetchHtml / fetchPdf / fetchYouTubeTranscript /
// callClaude implementations (see civic-hub/src/utils/anthropic,
// youtube, http). Keeps the module portable and testable.

import type {
  CallClaudeFn,
  CreateMeetingSummaryInput,
  FetchPdfFn,
  FetchYouTubeTranscriptFn,
  FetchXmlFn,
  FetchJsonFn,
  MeetingEntry,
  MeetingSourceConnector,
  MeetingSummaryConfig,
  SummaryBlock,
  SummarizeMeetingResult,
  TranscriptSegment,
  FetchHtmlFn,
} from "./models.js";
import {
  buildSummarizationPrompt,
  resolveEffectiveInstructions,
} from "./prompts.js";
import { buildProcessDescription } from "./service.js";
import {
  blocksHaveTimestamps,
  isTimedTranscript,
  MeetingNotReadyError,
  qualityFlag,
  type SummaryQualityFlag,
} from "./readiness.js";

// --- Discovery -------------------------------------------------------------

export async function discoverMeetings(
  connector: MeetingSourceConnector,
  cfg: MeetingSummaryConfig,
  deps: {
    fetchHtml: FetchHtmlFn;
    fetchXml: FetchXmlFn;
    fetchJson: FetchJsonFn;
    callClaude: CallClaudeFn;
  },
): Promise<MeetingEntry[]> {
  return connector.discover(cfg, deps);
}

// --- Summarization ---------------------------------------------------------

// Base64 inflates bytes ~33%; Anthropic's request limit is ~32MB.
// 20MB raw leaves headroom for the prompt text, transcript, and JSON overhead.
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Fetches the minutes PDF and (if present) the YouTube transcript, then
 * asks Claude for a list of topic blocks. Returns the blocks plus the
 * snapshot of instructions used and the model name the API reported.
 *
 * READINESS (2026-09-29, see readiness.ts). A summary is written only from a
 * record of the meeting: official minutes, or a transcript with timings. When
 * the entry lists a video, its timed transcript is required — a missing or
 * untimed transcript means the meeting is not ready, not that the transcript
 * is optional. Both throw MeetingNotReadyError, which the run counts as
 * waiting and retries. `allowMissingTranscript` (set by the run once a meeting
 * has waited RECORD_GRACE_DAYS) lets official minutes go ahead without the
 * video, with the summary flagged for review.
 *
 * TIMESTAMPS. A summary built from a timed transcript must come out with
 * timestamps. If the model drops them, it is asked once more; if they are
 * still missing the summary is kept but flagged, and a flagged summary is
 * never published without an admin confirming it.
 *
 * Any other thrown error aborts this one meeting; the cron controller catches
 * and continues.
 */
export async function summarizeMeeting(
  entry: MeetingEntry,
  cfg: MeetingSummaryConfig,
  deps: {
    fetchPdf: FetchPdfFn;
    fetchYouTubeTranscript: FetchYouTubeTranscriptFn;
    callClaude: CallClaudeFn;
  },
  opts: { allowMissingTranscript?: boolean } = {},
): Promise<SummarizeMeetingResult> {
  const instructions = resolveEffectiveInstructions(cfg.extraction_instructions);

  // --- Pick the authoritative source (minutes > agenda > recording) ---
  //
  // Feed-based connectors (youtube-channel) surface meetings that have no
  // document at all. That is a first-class case, not an error: the video
  // transcript is what actually records the meeting, and the minutes PDF —
  // when a jurisdiction eventually posts one — arrives weeks later and is
  // folded in by the cron's upgrade pass.
  const pdfUrl = entry.source_minutes_url ?? entry.source_agenda_url;
  const sourceType: "minutes" | "agenda" | "recording" = entry.source_minutes_url
    ? "minutes"
    : entry.source_agenda_url
      ? "agenda"
      : "recording";

  if (!pdfUrl && !entry.source_video_url) {
    throw new Error(
      "Nothing to summarize: the entry has no minutes PDF, no agenda PDF, and no recording",
    );
  }

  // An agenda says what was PLANNED. Without a recording to show what
  // happened, it is not a record of the meeting; wait for minutes.
  if (sourceType === "agenda" && !entry.source_video_url) {
    throw new MeetingNotReadyError(
      "Only the agenda is available; waiting for the minutes or a recording",
    );
  }

  // --- Transcript first: it decides whether there is anything to do ---
  //
  // Fetched before the PDF and before any model call, so a meeting that is
  // not ready costs one transcript request and nothing else.
  let transcript: TranscriptSegment[] = [];
  let transcriptProblem: string | null = null;
  if (entry.source_video_url) {
    try {
      transcript = await deps.fetchYouTubeTranscript(entry.source_video_url);
      console.log(
        `[meeting-summary] transcript fetched source_id=${entry.source_id} segments=${transcript.length}`,
      );
      if (transcript.length === 0) {
        transcriptProblem = "the transcript came back empty (no captions yet)";
      } else if (!isTimedTranscript(transcript)) {
        transcriptProblem = "the transcript came back without timings";
      }
    } catch (err) {
      transcriptProblem = err instanceof Error ? err.message : "unknown error";
    }
  }

  let flag: SummaryQualityFlag | null = null;
  if (transcriptProblem) {
    console.warn(
      `[meeting-summary] no usable transcript for ${entry.source_video_url}: ${transcriptProblem}`,
    );
    // Only official minutes may go ahead without the video, and only once the
    // run has waited long enough. Everything else waits.
    if (sourceType === "minutes" && opts.allowMissingTranscript) {
      flag = qualityFlag("transcript_unavailable", transcriptProblem);
      transcript = [];
    } else {
      throw new MeetingNotReadyError(
        `Waiting for the video's transcript: ${transcriptProblem}`,
      );
    }
  }
  const timed = transcript.length > 0;

  let pdfBase64: string | null = null;
  let pdfMime = "application/pdf";
  if (pdfUrl) {
    const pdf = await deps.fetchPdf(pdfUrl);
    if (pdf.bytes.length > MAX_PDF_BYTES) {
      const sizeMb = (pdf.bytes.length / (1024 * 1024)).toFixed(1);
      throw new Error(
        `PDF too large: ${sizeMb}MB exceeds ${MAX_PDF_BYTES / (1024 * 1024)}MB limit — skipping`,
      );
    }
    pdfBase64 = uint8ToBase64(pdf.bytes);
    pdfMime = pdf.mime || "application/pdf";
  }

  const transcriptText = formatTranscript(transcript);

  // Meeting length, taken from the last transcript timestamp. Drives how many
  // topic blocks the prompt asks for — a fixed range squeezed long meetings
  // and silently lost their later hours. Null when there is no transcript.
  const durationSeconds = timed
    ? Math.max(...transcript.map((t) => t.start))
    : null;

  const prompt = buildSummarizationPrompt({
    extraction_instructions: instructions,
    meeting_title: entry.meeting_title,
    meeting_date: entry.meeting_date,
    transcript_text: transcriptText,
    has_video: timed,
    source_type: sourceType,
    transcript_duration_seconds: durationSeconds,
  });

  const ask = (userText: string) =>
    deps.callClaude({
      model: cfg.model,
      userText,
      // Omitted entirely for recording-sourced meetings — there is no document.
      ...(pdfBase64 && pdfUrl
        ? {
            documentBase64: {
              data: pdfBase64,
              mediaType: pdfMime,
              filename:
                filenameFromUrl(pdfUrl) ??
                (sourceType === "minutes" ? "minutes.pdf" : "agenda.pdf"),
            },
          }
        : {}),
      // 16k gives headroom for verbose minutes with 15+ topic blocks
      // without ever flirting with the model's per-response ceiling.
      maxTokens: 16_000,
    });

  let { text, model } = await ask(prompt);
  let blocks = parseSummarizationResponse(text, timed);

  // A timed transcript went in; timestamps must come out. One more try with
  // the requirement restated, then keep the result and flag it.
  if (timed && !blocksHaveTimestamps(blocks)) {
    console.warn(
      `[meeting-summary] source_id=${entry.source_id}: the transcript had timings but no block ` +
        `came back with start_time_seconds — asking once more`,
    );
    ({ text, model } = await ask(prompt + TIMESTAMP_RETRY_NOTE));
    const retried = parseSummarizationResponse(text, timed);
    blocks = retried;
    if (!blocksHaveTimestamps(retried)) {
      console.warn(
        `[meeting-summary] source_id=${entry.source_id}: still no timestamps after a retry — flagging for review`,
      );
      flag = qualityFlag("timestamps_missing");
    }
  }

  return {
    blocks,
    ai_instructions_used: instructions,
    model,
    sourceType,
    quality_flag: flag,
  };
}

/** Appended to the prompt on the one retry. */
const TIMESTAMP_RETRY_NOTE = `

IMPORTANT — RETRY: your previous answer left start_time_seconds null on every
block, but the transcript above is timestamped. Every block that the recording
covers MUST carry the start_time_seconds (an integer number of seconds) of the
transcript line where that topic begins. Read the [HH:MM:SS] / [MM:SS] prefixes
and convert them to seconds.`;

// --- Convert pipeline output → module-createState input --------------------

export function buildCreateInput(
  entry: MeetingEntry,
  summary: SummarizeMeetingResult,
): CreateMeetingSummaryInput {
  return {
    source_id: entry.source_id,
    source_minutes_url: entry.source_minutes_url,
    source_agenda_url: entry.source_agenda_url,
    source_type: summary.sourceType,
    source_video_url: entry.source_video_url,
    additional_video_urls: entry.additional_video_urls,
    meeting_title: entry.meeting_title,
    meeting_date: entry.meeting_date,
    blocks: summary.blocks,
    ai_instructions_used: summary.ai_instructions_used,
    ai_model: summary.model,
    quality_flag: summary.quality_flag,
  };
}

/** Small pipeline helper — derive a one-line feed/description blurb. */
export function buildDescription(blocks: SummaryBlock[]): string {
  return buildProcessDescription(blocks);
}

// --- Helpers ---------------------------------------------------------------

function formatTranscript(segments: TranscriptSegment[]): string {
  // Compact timestamp-prefixed lines — easier for Claude to ground
  // timestamps to topics than a full JSON dump.
  return segments
    .map((s) => {
      const t = Math.max(0, Math.floor(s.start));
      return `[${formatSeconds(t)}] ${s.text.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/**
 * Node 20 has Buffer available globally; we use it for a simple, correct
 * base64 encode. (Avoiding `btoa(String.fromCharCode(...))` which chokes
 * on large buffers and non-ASCII.)
 */
function uint8ToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse Claude's response into a list of SummaryBlock. Rejects malformed
 * or empty output by throwing — caller logs and counts as a per-meeting
 * failure.
 */
function parseSummarizationResponse(
  raw: string,
  hasVideo: boolean,
): SummaryBlock[] {
  const json = extractJsonObject(raw);
  if (!json || typeof json !== "object") {
    throw new Error("Claude response was not valid JSON");
  }
  const arr = (json as { blocks?: unknown }).blocks;
  if (!Array.isArray(arr)) {
    throw new Error("Claude response missing 'blocks' array");
  }
  const out: SummaryBlock[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const topic_title =
      typeof r.topic_title === "string" ? r.topic_title.trim() : "";
    const topic_summary =
      typeof r.topic_summary === "string" ? r.topic_summary.trim() : "";
    if (topic_title.length === 0 && topic_summary.length === 0) continue;
    const start =
      hasVideo &&
      typeof r.start_time_seconds === "number" &&
      Number.isFinite(r.start_time_seconds) &&
      r.start_time_seconds >= 0
        ? Math.round(r.start_time_seconds)
        : null;
    const action =
      typeof r.action_taken === "string" && r.action_taken.trim().length > 0
        ? r.action_taken.trim()
        : null;
    out.push({
      topic_title,
      topic_summary,
      start_time_seconds: start,
      action_taken: action,
    });
  }
  if (out.length === 0) {
    throw new Error("Claude response contained no usable blocks");
  }
  return out;
}

/**
 * Tolerant JSON extractor — handles the common case where Claude wraps
 * the JSON in ```json fences despite instructions, adds a leading/
 * trailing line, or embeds literal newlines inside string values.
 * Mirrors parseJsonArray's tolerance ladder for the object case.
 */
function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const direct = tryParseObject(trimmed);
  if (direct) return direct;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const slice = trimmed.slice(first, last + 1);

  const sliced = tryParseObject(slice);
  if (sliced) return sliced;

  const sanitized = sanitizeClaudeJson(slice);
  const cleaned = tryParseObject(sanitized);
  if (cleaned) return cleaned;

  const failAt = locateParseFailure(sanitized);
  if (failAt !== null) {
    const start = Math.max(0, failAt - 120);
    const end = Math.min(sanitized.length, failAt + 120);
    console.warn(
      `[meeting-summary] summarization JSON parse failed at position ${failAt}. Context:\n${sanitized.slice(start, end)}`,
    );
  }
  return null;
}

function tryParseObject(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Shared JSON-array extractor for the discovery leg (connector calls
 * into this via the module index). Returns the parsed array or throws.
 *
 * Tries progressively more tolerant parsing steps before giving up:
 *   1. JSON.parse on the raw trimmed string.
 *   2. JSON.parse on the slice between the first `[` and the last `]`.
 *   3. Same slice with common Claude formatting quirks sanitized
 *      (literal \n/\r/\t inside strings, smart quotes, trailing
 *      commas). If even that fails, we throw and log a snippet
 *      around the failure point so the Vercel logs can be diagnosed.
 */
export function parseJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim();

  // Step 1: happy path.
  const direct = tryParseArray(trimmed);
  if (direct) return direct;

  // Step 2: salvage from first `[` to last `]`.
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first < 0 || last <= first) {
    throw new Error("Claude response was not a JSON array");
  }
  const slice = trimmed.slice(first, last + 1);

  const sliced = tryParseArray(slice);
  if (sliced) return sliced;

  // Step 3: sanitize + retry.
  const sanitized = sanitizeClaudeJson(slice);
  const cleaned = tryParseArray(sanitized);
  if (cleaned) return cleaned;

  // Step 4: give up, but log the failure point so we can diagnose.
  const failAt = locateParseFailure(sanitized);
  if (failAt !== null) {
    const start = Math.max(0, failAt - 120);
    const end = Math.min(sanitized.length, failAt + 120);
    console.warn(
      `[meeting-summary] JSON parse failed at position ${failAt}. Context:\n${sanitized.slice(start, end)}`,
    );
  } else {
    console.warn(
      `[meeting-summary] JSON parse failed. First 400 chars:\n${sanitized.slice(0, 400)}`,
    );
  }
  throw new Error("Claude response was not valid JSON array (after sanitization)");
}

function tryParseArray(s: string): unknown[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Fix the most common Claude JSON quirks:
 *   - smart quotes → plain quotes (but NOT inside string literals, handled via scan)
 *   - literal CR/LF/TAB characters inside string literals → spaces
 *   - trailing commas before `]` or `}`
 *
 * This is a targeted sanitizer, not a full JSON rewriter. It scans the
 * string and tracks whether we're inside a string literal; outside of
 * strings it's a no-op except for trailing-comma removal.
 */
function sanitizeClaudeJson(raw: string): string {
  // First pass: replace literal newlines/tabs/returns inside strings.
  const out: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      out.push(ch);
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out.push(ch);
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r")) {
      // Literal newline inside a string — break JSON. Replace with space.
      out.push(" ");
      continue;
    }
    if (inString && ch === "\t") {
      out.push(" ");
      continue;
    }
    out.push(ch);
  }
  // Second pass: strip trailing commas before `]` or `}`.
  return out.join("").replace(/,\s*([}\]])/g, "$1");
}

/** Best-effort locate the character offset where JSON.parse fails. */
function locateParseFailure(s: string): number | null {
  try {
    JSON.parse(s);
    return null;
  } catch (err) {
    if (err instanceof Error) {
      const m = err.message.match(/position (\d+)/);
      if (m) return Number(m[1]);
    }
    return null;
  }
}
