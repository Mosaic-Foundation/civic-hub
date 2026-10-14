import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** The address's #fragment without the "#", lower-case ("" when none). */
export function useHashId(): string {
  return useLocation().hash.replace(/^#/, "").toLowerCase();
}

/**
 * Open state for a panel a link can point at: starts open when the address
 * names it (#<anchor>), and opens when a later link does. The admin can close
 * it again; nothing reopens it until the address changes.
 */
export function useAnchoredOpen(anchor: string): [boolean, (open: boolean) => void] {
  const hash = useHashId();
  const [open, setOpen] = useState(hash === anchor);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a link to this panel opens it
    if (hash === anchor) setOpen(true);
  }, [hash, anchor]);
  return [open, setOpen];
}

/**
 * Scroll to the element the address names once it is on the page. Sections
 * load their data first, so this looks for it for a few seconds. The target
 * carries `data-anchor` (scroll-margin under the sticky header, index.css).
 */
export function useScrollToHash(): void {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    const id = hash.replace(/^#/, "").toLowerCase();
    if (!id) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (++tries < 40) timer = setTimeout(look, 100);
    };
    // After the panel that holds it has had a frame to open.
    timer = setTimeout(look, 50);
    return () => clearTimeout(timer);
  }, [hash, pathname]);
}
