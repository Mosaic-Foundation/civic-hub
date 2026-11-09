// A pill that opens a short menu of links (Events 0.4.3, Adam 2026-11-09:
// "Add to my calendar" as a pill, and a pop-up to pick which calendar). The
// look is the hub's own header menus': an outlined pill, and a panel on the
// surface with the popover shadow. It closes on a click outside, Escape (focus
// back to the pill), Tab, or a choice; arrow keys, Home and End move between
// its links. Stands alone: it reaches nothing of the hub's (kitPortable).

import { useEffect, useId, useRef, useState, type HTMLAttributes, type KeyboardEvent } from "react";

export interface MenuLink {
  label: string;
  href: string;
  /** Saved by the browser (an .ics file), not opened. */
  download?: boolean;
  /** Opened in a new tab (another site). */
  newTab?: boolean;
}

export interface MenuButtonProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The pill's words. */
  label: string;
  links: ReadonlyArray<MenuLink>;
}

export function MenuButton({ label, links, className, ...rest }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") focus(i + 1);
    else if (e.key === "ArrowUp") focus(i - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(items.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={["kit-menu-wrap", className].filter(Boolean).join(" ")} {...rest}>
      <button
        ref={button}
        type="button"
        className={`kit-menu-button${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div ref={menu} id={id} className="kit-menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {links.map((l) => (
            <a
              key={l.label}
              role="menuitem"
              className="kit-menu-item"
              href={l.href}
              download={l.download || undefined}
              target={l.newTab ? "_blank" : undefined}
              rel={l.newTab ? "noopener noreferrer" : undefined}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
