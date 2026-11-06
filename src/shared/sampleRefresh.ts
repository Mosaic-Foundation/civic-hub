// Which hubs have their sample content kept fresh (Adam, 2026-11-05).
//
// The daily `sample_refresh` job and "Refresh samples" replace a live sample
// near its deadline on demo and beta hubs alike, so a beta hub's testers never
// find it dead. A live hub's samples are never refreshed: input there is real.
//
// The one place this rule lives. src/services/sampleRefresh.ts, the console's
// route and card, and the hub admin's Settings read it. Shared by the server,
// the console and the hub UI. Pure.

export const SAMPLE_REFRESH_MODES: readonly string[] = ["demo", "beta"];

/**
 * Does the daily job refresh this hub's samples, by `samples.auto_refresh`
 * (2026-11-05)? On unless it is "false", so every demo and beta hub is kept
 * fresh until its admin says otherwise.
 */
export function autoRefreshOn(setting: string | null | undefined): boolean {
  return setting !== "false";
}

/** Does a hub in this mode have its samples refreshed? */
export function refreshesSamples(mode: unknown): boolean {
  return typeof mode === "string" && SAMPLE_REFRESH_MODES.includes(mode);
}
