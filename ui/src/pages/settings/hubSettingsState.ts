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
}

export const HubSettingsCtx = createContext<HubSettingsState | null>(null);

export function useHubSettings(): HubSettingsState {
  const value = useContext(HubSettingsCtx);
  if (!value) throw new Error("useHubSettings outside HubSettingsProvider");
  return value;
}

/**
 * Warn before unsaved edits are lost: closing or reloading the tab, and
 * following any link inside the app.
 *
 * The app uses <BrowserRouter>, which has no navigation blocker, so in-app
 * links are caught with one capture-phase click listener rather than by
 * wrapping every <Link>. The Settings page's own section list asks through
 * `confirmDiscard` directly.
 */
export function useUnsavedChangesGuard(hasUnsaved: boolean): void {
  useEffect(() => {
    if (!hasUnsaved) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required by some browsers to show the prompt at all.
      e.returnValue = "";
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("data-settings-nav")) return; // asks for itself
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      if (!confirmDiscard()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [hasUnsaved]);
}

export function confirmDiscard(): boolean {
  return window.confirm("You have unsaved changes on this page. Leave without saving?");
}
