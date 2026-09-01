import { useSyncExternalStore } from "react";

/**
 * Read-only "preview" mode for the private beta.
 *
 * The backend allow-list (CIVIC_BETA_MODE) is the real account gate — it
 * decides who can receive a sign-in code and create an account. This flag
 * is purely a front-end "let me look around" toggle: when set, a logged-out
 * visitor gets to browse the full public app read-only instead of being held
 * at the BetaLanding splash. It grants no write access (every write is still
 * gated server-side by requireResident), so it is safe to keep client-side.
 *
 * Stored in sessionStorage so it lasts a browsing session but resets on a
 * fresh visit — every new visitor still lands on the splash first. A custom
 * event keeps the App wall and the BetaBanner in sync within the tab, and
 * the native `storage` event syncs across tabs.
 */

const KEY = "civic_preview";
const EVENT = "civic-preview-change";

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function enterPreview(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private-mode / storage-disabled — preview just won't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function exitPreview(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function usePreviewMode(): boolean {
  // Server snapshot is `false` — SSR/first paint always shows the splash.
  return useSyncExternalStore(subscribe, read, () => false);
}
