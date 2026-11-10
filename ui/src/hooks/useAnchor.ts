import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** The address's #fragment without the "#", lower-case ("" when none). */
export function useHashId(): string {
  return useLocation().hash.replace(/^#/, "").toLowerCase();
}

/**
 * Open state for a panel a link can point at: starts open when the address
 * names it (#<anchor>, or any of the anchors it holds), and opens when a
 * later link does. The admin can close it again; nothing reopens it until the
 * address changes.
 */
export function useAnchoredOpen(anchor: string | readonly string[]): [boolean, (open: boolean) => void] {
  const hash = useHashId();
  const anchors = typeof anchor === "string" ? [anchor] : anchor;
  const named = hash !== "" && anchors.includes(hash);
  const [open, setOpen] = useState(named);
  const { key } = useLocation();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a link to this panel opens it
    if (named) setOpen(true);
  }, [named, key]);
  return [open, setOpen];
}

/** How long a marked setting stays marked (index.css, .is-link-target). */
const MARK_MS = 2400;

/**
 * Where #<id> is on the page: the element with that id, else the "?" of the
 * setting whose anchor it is (HelpButton's data-help-anchor; settings
 * search, 2026-11-10). `fallback` also takes a panel that holds it
 * (data-anchors), for a setting its panel shows only sometimes.
 */
export function findAnchor(id: string, fallback = false): HTMLElement | null {
  const css = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  const el =
    document.getElementById(id) ?? document.querySelector<HTMLElement>(`[data-help-anchor="${css}"]`);
  if (el || !fallback) return el;
  return document.querySelector<HTMLElement>(`[data-anchors~="${css}"]`);
}

/**
 * What to mark for a "?" a link found: the setting's whole field, the panel
 * whose heading it is in, or else the line it is on.
 */
function markTarget(help: HTMLElement): HTMLElement {
  return (
    help.closest<HTMLElement>(".settings-field") ??
    help.closest("summary")?.parentElement ??
    help.parentElement ??
    help
  );
}

/**
 * Scroll to the element the address names once it is on the page. Sections
 * load their data first, so this looks for it for a few seconds; after one
 * second a panel that holds it will do. A setting found by its "?" is marked
 * for a moment, so the admin sees which one the link meant.
 * The target carries `data-anchor` (scroll-margin under the sticky header,
 * index.css); a "?" scrolls with the same margin.
 */
export function useScrollToHash(): void {
  const { hash, pathname, key } = useLocation();
  useEffect(() => {
    const id = hash.replace(/^#/, "").toLowerCase();
    if (!id) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unmark: ReturnType<typeof setTimeout> | undefined;
    let marked: HTMLElement | null = null;
    const look = () => {
      const el = findAnchor(id, tries >= 10);
      if (el) {
        if (!el.hasAttribute("data-help-anchor")) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        const target = markTarget(el);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        marked = target;
        target.classList.add("is-link-target");
        unmark = setTimeout(() => target.classList.remove("is-link-target"), MARK_MS);
        return;
      }
      if (++tries < 40) timer = setTimeout(look, 100);
    };
    // After the panel that holds it has had a frame to open.
    timer = setTimeout(look, 50);
    return () => {
      clearTimeout(timer);
      clearTimeout(unmark);
      marked?.classList.remove("is-link-target");
    };
  }, [hash, pathname, key]);
}
