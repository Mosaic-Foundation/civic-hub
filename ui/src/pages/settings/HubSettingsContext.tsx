// One load of GET /admin/hub/settings for the whole Settings page, shared by
// every section that edits those keys, plus the page-wide record of which
// section has unsaved changes (for the guard in useUnsavedChangesGuard).

import { useCallback, useState } from "react";
import { useApi } from "../../hooks/useApi";
import {
  adminGetHubSettings,
  adminPutHubSettings,
  type HubSettings,
} from "../../services/api";
import { refreshHubConfig } from "../../config/hubConfig";
import { HubSettingsCtx } from "./hubSettingsState";

export function HubSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: loaded, error: loadError, setData } = useApi<HubSettings>("admin/hub/settings", () =>
    adminGetHubSettings(),
  );
  const data = loaded ?? null;
  const error = loadError ? `Could not load settings: ${loadError.message}` : null;
  const [dirty, setDirtySet] = useState<ReadonlySet<string>>(new Set());

  // After every save (and every reload, which follows a change made through
  // another endpoint, such as the mode), the public hub config is fetched
  // again so the admin's own page reflects the change at once: a plugin
  // switched off leaves the nav, a new name is in the header. Not awaited:
  // the save has succeeded whether or not the refresh does.
  const save = useCallback(
    async (section: string, values: Record<string, string | boolean | number>) => {
      const fresh = await adminPutHubSettings(section, values);
      setData(fresh);
      void refreshHubConfig();
      return fresh;
    },
    [setData],
  );

  const reload = useCallback(async () => {
    setData(await adminGetHubSettings());
    void refreshHubConfig();
  }, [setData]);

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
    <HubSettingsCtx.Provider value={{ data, error, save, reload, dirty, setDirty }}>{children}</HubSettingsCtx.Provider>
  );
}
