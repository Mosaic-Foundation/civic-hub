// Which mode notice this browser closed (split from ModeNotice.tsx).

const CLOSED_KEY = "civic:mode-notice-closed";

/** The mode whose notice was closed in this browser, or null. */
export function readClosed(): string | null {
  try {
    return localStorage.getItem(CLOSED_KEY);
  } catch {
    return null;
  }
}

export function writeClosed(mode: string | null): void {
  try {
    if (mode) localStorage.setItem(CLOSED_KEY, mode);
    else localStorage.removeItem(CLOSED_KEY);
  } catch {
    /* storage blocked: the notice shows in full next time, as before */
  }
}

/**
 * Called on every render of the hub's frame: on a live hub, forget which
 * notice was closed, so the next notice this browser sees is shown in full.
 */
export function forgetClosedNoticeOnLive(mode: string | null | undefined): void {
  if (mode === "live" && readClosed() !== null) writeClosed(null);
}
