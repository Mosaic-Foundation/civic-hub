/**
 * React access to the hub configuration fetched at boot.
 *
 * The config is loaded once in main.tsx before the first render, so this
 * context never holds a loading state and consumers never render a spinner
 * for it. Which hub you are looking at never changes under a running app (it
 * is the hostname); what the hub says about itself can, when its admin saves
 * Settings. refreshHubConfig() re-fetches it, and this provider passes the
 * new value down, so everything reading the context re-renders. AppContent
 * reads it, which re-renders the whole tree, so plain `pluginEnabled()` and
 * `hub.name` reads pick the change up too.
 *
 * Most code does not need this. `import hub from "../config/hub"` reads the
 * same data with the same property names it always had, and is the right
 * choice for branding and copy. Reach for this hook when a component needs
 * the hub's identity as such — its slug, its place code, its DID — or a
 * settings key that has no entry in the branding object.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { getLoadedHubConfig, subscribeHubConfig, type HubConfig } from "./hubConfig";

const HubConfigContext = createContext<HubConfig | null>(null);

export function HubConfigProvider({
  value,
  children,
}: {
  /** Omit to use whatever loadHubConfig() resolved at boot. */
  value?: HubConfig | null;
  children: ReactNode;
}) {
  // getLoadedHubConfig() returns the same object until a refresh replaces
  // it, which is the snapshot identity useSyncExternalStore needs.
  const live = useSyncExternalStore(subscribeHubConfig, getLoadedHubConfig);
  const resolved = value !== undefined ? value : live;
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
