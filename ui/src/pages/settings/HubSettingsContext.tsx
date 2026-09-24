// One load of GET /admin/hub/settings for the whole Settings page, shared by
// every section that edits those keys, plus the page-wide record of which
// section has unsaved changes (for the guard in useUnsavedChangesGuard).

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  adminGetHubSettings,
  adminPutHubSettings,
  type HubSettings,
} from "../../services/api";

interface HubSettingsState {
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

const Ctx = createContext<HubSettingsState | null>(null);

export function HubSettingsProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<HubSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirtySet] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    adminGetHubSettings()
      .then(setData)
      .catch((err: Error) => setError(`Could not load settings: ${err.message}`));
  }, []);

  const save = useCallback(
    async (section: string, values: Record<string, string | boolean | number>) => {
      const fresh = await adminPutHubSettings(section, values);
      setData(fresh);
      return fresh;
    },
    [],
  );

  const reload = useCallback(async () => {
    setData(await adminGetHubSettings());
  }, []);

  const setDirty = useCallback((section: string, isDirty: boolean) => {
    setDirtySet((cur) => {
      if (cur.has(section) === isDirty) return cur;
      const next = new Set(cur);
      if (isDirty) next.add(section);
      else next.delete(section);
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ data, error, save, reload, dirty, setDirty }}>{children}</Ctx.Provider>
  );
}

export function useHubSettings(): HubSettingsState {
  const value = useContext(Ctx);
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
