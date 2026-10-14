import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { helpEntry, helpUrl } from "../../../src/shared/helpRegistry";
import "./HelpButton.css";

/**
 * The "?" beside a setting or a section (admin menu slice, 2026-10-13). It
 * opens a short note from the help registry (src/shared/helpRegistry.json)
 * with a link to the right place in the docs. Renders nothing for a key the
 * registry doesn't have; tests/unit/helpRegistry.test.ts makes sure every
 * setting and section has one.
 *
 * Never put it inside a <label> or a <button>: a click would reach them.
 */
export default function HelpButton({ k, label }: { k: string; label: string }) {
  const entry = helpEntry(k);
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noteId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep the note on screen: it starts under the "?" and moves left when the
  // "?" is near the right edge of a phone.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const left = buttonRef.current.getBoundingClientRect().left;
    const width = Math.min(300, window.innerWidth - 32);
    const wanted = Math.min(Math.max(16, left - 8), window.innerWidth - width - 16);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured after layout, before paint
    setShift(wanted - left);
  }, [open]);

  if (!entry) return null;
  return (
    <span className="help" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="help-button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? noteId : undefined}
        onClick={(e) => {
          // Inside a <summary>, a click would also open or close its <details>.
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <span id={noteId} role="note" className="help-note" style={{ left: shift }}>
          <span className="help-note-text">{entry.text}</span>{" "}
          <a href={helpUrl(entry)} target="_blank" rel="noopener" className="help-note-link">
            More in the docs
          </a>
        </span>
      )}
    </span>
  );
}
