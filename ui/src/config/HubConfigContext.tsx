/**
 * React access to the hub configuration fetched at boot.
 *
 * The config is loaded once in main.tsx before the first render, so this
 * context never holds a loading state and consumers never render a spinner
 * for it. The value is fixed for the life of the page: which hub you are
 * looking at is decided by the hostname, and a hostname does not change
 * under a running app.
 *
 * Most code does not need this. `import hub from "../config/hub"` reads the
 * same data with the same property names it always had, and is the right
 * choice for branding and copy. Reach for this hook when a component needs
 * the hub's identity as such — its slug, its place code, its DID — or a
 * settings key that has no entry in the branding object.
 */

import { createContext, useContext, type ReactNode } from "react";
import { getLoadedHubConfig, type HubConfig } from "./hubConfig";

const HubConfigContext = createContext<HubConfig | null>(null);

export function HubConfigProvider({
  value,
  children,
}: {
  /** Omit to use whatever loadHubConfig() resolved at boot. */
  value?: HubConfig | null;
  children: ReactNode;
}) {
  const resolved = value !== undefined ? value : getLoadedHubConfig();
  return (
    <HubConfigContext.Provider value={resolved}>
      {children}
    </HubConfigContext.Provider>
  );
}

/**
 * The hub configuration, or null when it could not be fetched and the app is
 * running on build-time fallbacks. Callers must handle null rather than
 * assume a hub — a network failure at boot is not an error worth a blank
 * page, so the app renders without it.
 */
export function useHubConfig(): HubConfig | null {
  return useContext(HubConfigContext);
}

/** One settings key, or undefined when this hub has not configured it. */
export function useHubSetting(key: string): string | undefined {
  const config = useContext(HubConfigContext);
  const value = config?.settings[key];
  return value === undefined || value === "" ? undefined : value;
}
