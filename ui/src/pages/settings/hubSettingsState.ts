// What the Settings page's sections read from the shared load (split from
// HubSettingsContext.tsx, which holds only the provider): the context, the
// hook, and the guard against losing unsaved edits.
import { createContext, useContext, useEffect } from "react";
import type { HubSettings } from "../../services/api";

export interface HubSettingsState {
  data: HubSettings | null;
  error: string | null;
  /** Save one section's changed keys; resolves to the fresh settings. */
  save: (
    section: string,
    values: Record<string, string | boolean | number>,
  ) => Promise<HubSettings>;
  /** Fetch again — after a change made through another endpoint (mode). */
  reload: () => Promise<void>;
  /** Sections with edits that have not been saved. */
  dirty: ReadonlySet<string>;
  setDirty: (section: string, isDirty: boolean) => void;
  /** "Leave without saving?", in the kit's confirm. */
  askDiscard: () => Promise<boolean>;
}

export const HubSettingsCtx = createContext<HubSettingsState | null>(null);

export function useHubSettings(): HubSettingsState {
  const value = useContext(HubSettingsCtx);
  if (!value) throw new Error("useHubSettings outside HubSettingsProvider");
  return value;
}

/** The answer a "leave without saving?" question waits for. */
export type AskDiscard = () => Promise<boolean>;

/** Set on the way out once the admin has said leave, so nothing asks twice. */
let leaving = false;

function markLeaving() {
  leaving = true;
  window.setTimeout(() => {
    leaving = false;
  }, 1000);
}

/** The history entry the guard adds, so Back lands on this page and can ask. */
const GUARD_ENTRY = "civicUnsavedGuard";

function onGuardEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[GUARD_ENTRY]);
}

function pushGuardEntry() {
  window.history.pushState({ ...(window.history.state as object | null), [GUARD_ENTRY]: true }, "", window.location.href);
}

/**
 * Warn before unsaved edits are lost: closing or reloading the tab (the
 * browser's own prompt, the only one it allows), following any link inside the
 * app, and Back. The others ask with the kit's confirm (the provider's
 * askDiscard, ConfirmDialog).
 *
 * The app uses <BrowserRouter>, which has no navigation blocker. So in-app
 * links are caught with one capture-phase click listener rather than by
 * wrapping every <Link>, and followed again if the admin says leave. Back is
 * caught with one extra history entry while there are unsaved edits: Back lands
 * on the same address, the guard asks, and staying puts the entry back. The
 * Settings page's own section list asks through askDiscard directly.
 */
export function useUnsavedChangesGuard(hasUnsaved: boolean): void {
  const askDiscard = useContext(HubSettingsCtx)?.askDiscard;

  useEffect(() => {
    if (!hasUnsaved) return;
    const ask: AskDiscard = askDiscard ?? (() => Promise.resolve(true));

    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (leaving) return;
      e.preventDefault();
      // Required by some browsers to show the prompt at all.
      e.returnValue = "";
    }

    function onClick(e: MouseEvent) {
      if (leaving || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("data-settings-nav")) return; // asks for itself
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      void ask().then((leave) => {
        if (!leave) return;
        markLeaving();
        anchor.click();
      });
    }

    function onPopState() {
      if (leaving) return;
      void ask().then((leave) => {
        if (leave) {
          markLeaving();
          window.history.back();
        } else {
          pushGuardEntry();
        }
      });
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    pushGuardEntry();
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      // Saved or discarded, still on the page: take the extra entry away again.
      if (onGuardEntry()) window.history.back();
    };
  }, [hasUnsaved, askDiscard]);
}

/** Going to another section: over the guard's entry, so it leaves no dead Back press. */
export function replaceGuardEntry(): boolean {
  return onGuardEntry();
}

/** A "Saved" says its piece and goes (an error stays). */
export function useBriefMessage(message: string | null, clear: () => void, ms = 5000): void {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(clear, ms);
    return () => window.clearTimeout(t);
    // `clear` is a fresh closure each render; the message is what starts the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, ms]);
}
