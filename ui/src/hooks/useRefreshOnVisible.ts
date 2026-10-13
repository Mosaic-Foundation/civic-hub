// useRefreshOnVisible — read the page's data again when its tab comes back
// into view, so a second tab (or a phone that slept) catches up without a
// manual reload (Adam's Oct 10 walk). At most once per `minGapMs`, counted
// from when the page last read it, so switching tabs back and forth doesn't
// send a read each time. The feed doesn't use it: a re-read would lose the
// reader's place.

import { useEffect, useRef } from "react";

export function useRefreshOnVisible(refresh: () => unknown, minGapMs = 15_000): void {
  // When the page last read it: its first load, set on mount.
  const lastRead = useRef(0);
  const latest = useRef(refresh);

  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    lastRead.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRead.current < minGapMs) return;
      lastRead.current = Date.now();
      void latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    // A page restored from the back/forward cache is a return too.
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [minGapMs]);
}
