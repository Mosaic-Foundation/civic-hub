// What the hub's own reports need from the meeting summary's rules (engine 2,
// B10): the engine's job describer, its cron alert and the news sync read
// these here, not in the package (ADR-014's PACKAGE_REACH_NOT_YET list
// shrinks). The package re-exports them from here, so there is one value.
// Plain data and types: shared with the UI.

/**
 * How long a meeting may wait for its missing record before the run reports
 * it, unless the hub sets `plugin.meeting_summary.record_grace_days` (the
 * cleanup slice, 2026-10-16). The first hub posts recordings within a day and
 * minutes within about four weeks; two weeks without a transcript for a
 * listed video means something is wrong (captions off, provider failing).
 */
export const RECORD_GRACE_DAYS = 14;

/**
 * A source quiet this long probably stopped working (Adam, 2026-10-07), unless
 * the hub sets `plugin.meeting_summary.source_quiet_days` (a body that meets
 * quarterly needs longer). A run that finds nothing is "nothing new", not a
 * failure (review M7); but in August 2026 the first hub's source page went
 * client-side and parsed to nothing for weeks. Once the newest meeting the hub
 * knows of is older than this, the job asks for a check (flagged, not failed).
 */
export const SOURCE_QUIET_DAYS = 45;

/**
 * Low-level Claude call used by both the extraction and the summarization
 * legs, and by the news sync's paraphrase. `system` is optional;
 * `documentBase64` is provided for the summarization leg to pass the PDF as a
 * native document block. Returns the assistant's raw text output plus the
 * model id actually used (echoed by the API).
 */
export interface CallClaudeFn {
  (input: {
    model: string;
    system?: string;
    userText: string;
    documentBase64?: { data: string; mediaType: string; filename?: string };
    maxTokens?: number;
  }): Promise<{ text: string; model: string }>;
}
