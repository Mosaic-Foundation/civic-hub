// YouTube helpers — transcript fetch + video-id extraction.
//
// Three transcript paths, picked at call time based on env vars:
//
// 1) Supadata.ai (preferred when SUPADATA_API_KEY is set).
//    Simple REST API for YouTube transcripts. Free tier: 100 credits/month.
//    Runs from non-cloud IPs so YouTube doesn't block it.
//
// 2) SearchAPI.io (fallback when SEARCHAPI_API_KEY is set but no Supadata key).
//    Legacy path — kept for backwards compatibility but the free tier
//    (100 searches/month) has been exhausted and paid plans are $40/month.
//
// 3) `youtube-transcript` library (last resort when no API keys are set).
//    Consumes YouTube's public `timedtext` endpoint directly — works
//    from residential IPs (local dev) but typically fails on cloud
//    hosts. Kept around so dev / non-Vercel hosts still work.
//
// A transcript failure never breaks the run, and never degrades a summary
// silently either: since 2026-09-29 a meeting whose video has no usable timed
// transcript WAITS (src/modules/civic.meeting_summary/readiness.ts) and is
// retried on the next run.

// The `youtube-transcript` package declares "type": "module" but its
// "main" entry is a CJS-style bundle with `exports.X = ...` assignments,
// which Node cannot expose as named ESM imports. Pointing at the ESM
// build directly is the robust workaround and survives package updates
// so long as the ESM file name stays stable.
// @ts-expect-error — deep import has no declaration file; see above
import { YoutubeTranscript } from "youtube-transcript/dist/youtube-transcript.esm.js";
import type { TranscriptSegment } from "../modules/civic.meeting_summary/index.js";

/**
 * Extract the 11-char video id from a watch URL. Returns null on
 * anything that doesn't look like a standard watch URL.
 */
export function extractVideoId(watchUrl: string): string | null {
  try {
    const u = new URL(watchUrl);
    // youtube.com/watch?v=...
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // youtu.be/{id}
    if (/^(www\.)?youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

const SEARCHAPI_TIMEOUT_MS = 60_000;

/**
 * Fetch the auto-transcript for a YouTube watch URL. Throws on any
 * error (no transcript available, video private, endpoint changed
 * upstream). Callers catch and treat as "no transcript."
 *
 * Priority: Supadata.ai → SearchAPI.io → youtube-transcript library.
 * Cloud hosts (Vercel) need one of the API keys since YouTube blocks
 * data-center IPs from accessing transcripts directly.
 */
export async function fetchYouTubeTranscript(
  watchUrl: string,
): Promise<TranscriptSegment[]> {
  const id = extractVideoId(watchUrl);
  if (!id) {
    throw new Error(`Invalid YouTube watch URL: ${watchUrl}`);
  }

  const supadataKey = process.env.SUPADATA_API_KEY?.trim();
  if (supadataKey) {
    return fetchViaSupadata(id, supadataKey);
  }

  const searchApiKey = process.env.SEARCHAPI_API_KEY?.trim();
  if (searchApiKey) {
    return fetchViaSearchApi(id, searchApiKey);
  }
  return fetchViaLibrary(id);
}

const SUPADATA_TIMEOUT_MS = 60_000;

async function fetchViaSupadata(
  videoId: string,
  apiKey: string,
): Promise<TranscriptSegment[]> {
  const url = new URL("https://api.supadata.ai/v1/transcript");
  url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  url.searchParams.set("lang", "en");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SUPADATA_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Supadata transcript fetch exceeded ${SUPADATA_TIMEOUT_MS}ms — aborted`,
      );
    }
    throw err;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supadata ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: unknown;
    error?: string;
    jobId?: unknown;
  };

  if (data.error) {
    throw new Error(`Supadata error: ${data.error}`);
  }

  // Two answers that used to read as "no captions" and pass silently:
  //   - an asynchronous job (HTTP 202 with a jobId) — Supadata does this when
  //     it has to generate the transcript itself, e.g. a long recording or a
  //     video with no captions yet;
  //   - plain text instead of segments, which has no timings to link into.
  // Both are "not ready", so the run waits and tries again tomorrow.
  if (res.status === 202 || typeof data.jobId === "string") {
    throw new Error(
      `Supadata is still preparing this transcript (asynchronous job ${String(data.jobId ?? "")}) — try again later`,
    );
  }
  if (typeof data.content === "string") {
    throw new Error("Supadata returned the transcript as plain text, without timings");
  }

  const raw = (Array.isArray(data.content) ? data.content : []) as Array<{
    text?: unknown;
    offset?: unknown;
  }>;
  const out: TranscriptSegment[] = [];
  for (const seg of raw) {
    const text = typeof seg.text === "string" ? seg.text : "";
    if (text.trim().length === 0) continue;
    // Supadata returns offset in milliseconds — convert to seconds
    const offsetMs =
      typeof seg.offset === "number" && Number.isFinite(seg.offset) && seg.offset >= 0
        ? seg.offset
        : 0;
    out.push({ start: Math.max(0, Math.round(offsetMs / 1000)), text });
  }
  return out;
}

/**
 * Hit SearchAPI's youtube_transcripts engine. Documented response shape
 * (as of 2026-04):
 *
 *   {
 *     "transcripts": [
 *       { "text": "...", "start": 0.5, "duration": 2.3 },
 *       ...
 *     ]
 *   }
 *
 * The endpoint can return additional metadata fields we ignore. Time
 * values are in seconds (floats); we round `start` to integer seconds
 * to match the rest of our pipeline.
 */
async function fetchViaSearchApi(
  videoId: string,
  apiKey: string,
  attempt = 0,
): Promise<TranscriptSegment[]> {
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "youtube_transcripts");
  url.searchParams.set("video_id", videoId);
  url.searchParams.set("lang", "en");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SEARCHAPI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `SearchAPI transcript fetch exceeded ${SEARCHAPI_TIMEOUT_MS}ms — aborted`,
      );
    }
    throw err;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text();
    // Monthly quota exhausted — no point retrying.
    if (res.status === 429 && body.includes("all of the searches")) {
      throw new Error(
        `SearchAPI monthly quota exhausted — transcripts unavailable until quota resets`,
      );
    }
    // Transient rate limit — retry with backoff.
    if (res.status === 429 && attempt < 3) {
      const wait = (attempt + 1) * 5_000;
      console.warn(
        `[meeting-summary] SearchAPI 429 rate-limited — retrying in ${wait / 1000}s (attempt ${attempt + 1}/3)`,
      );
      await new Promise((r) => setTimeout(r, wait));
      return fetchViaSearchApi(videoId, apiKey, attempt + 1);
    }
    throw new Error(
      `SearchAPI ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    transcripts?: Array<{ text?: unknown; start?: unknown }>;
    error?: string;
  };

  if (data.error) {
    throw new Error(`SearchAPI error: ${data.error}`);
  }

  const raw = Array.isArray(data.transcripts) ? data.transcripts : [];
  const out: TranscriptSegment[] = [];
  for (const seg of raw) {
    const text = typeof seg.text === "string" ? seg.text : "";
    if (text.trim().length === 0) continue;
    const start =
      typeof seg.start === "number" && Number.isFinite(seg.start) && seg.start >= 0
        ? Math.max(0, Math.round(seg.start))
        : 0;
    out.push({ start, text });
  }
  return out;
}

const LIBRARY_TIMEOUT_MS = 30_000;

/**
 * Fallback path — uses the unofficial library. Works locally; usually
 * fails on Vercel (YouTube anti-bot challenges cloud IPs). The library
 * can hang silently when YouTube returns a captcha challenge instead of
 * a real error, so we wrap it in a hard 30-second timeout — better to
 * report "no transcript" and move on than to burn the whole Vercel
 * function budget on a single hung fetch.
 */
async function fetchViaLibrary(videoId: string): Promise<TranscriptSegment[]> {
  const raw = await Promise.race([
    YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `youtube-transcript library exceeded ${LIBRARY_TIMEOUT_MS}ms — likely cloud-IP block; set SEARCHAPI_API_KEY to use the SearchAPI path instead`,
            ),
          ),
        LIBRARY_TIMEOUT_MS,
      ),
    ),
  ]);
  const out: TranscriptSegment[] = [];
  for (const seg of raw) {
    const text = typeof seg.text === "string" ? seg.text : "";
    const offset =
      typeof seg.offset === "number" && Number.isFinite(seg.offset)
        ? seg.offset
        : 0;
    if (text.trim().length === 0) continue;
    out.push({
      start: Math.max(0, Math.round(offset / 1000)),
      text,
    });
  }
  return out;
}
