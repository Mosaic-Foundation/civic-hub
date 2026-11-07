import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches now, live as the window changes. True where there is no window. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === "undefined" ? true : window.matchMedia(query).matches),
    () => true,
  );
}
