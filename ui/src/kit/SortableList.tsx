// A list someone puts in order (layout session, 2026-11-07): drag a row by its
// handle with a mouse, a pen or a finger, or use its Move up and Move down
// buttons from the keyboard. Each move gives the whole new order; the page
// stores it. A screen reader hears where the row landed.
//
// Hub UI only for now: not in @civic-social/plugin-sdk/ui (Adam, 2026-11-07).

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { moveTo } from "./sortableOrder";

export interface SortableItem {
  id: string;
  /** The row's name, as "Move <name> up" reads it. */
  name: string;
  /** Drawn after the name: a switch, a note. */
  extra?: ReactNode;
}

export function SortableList({
  items,
  onChange,
  label,
  disabled,
  className,
}: {
  items: readonly SortableItem[];
  /** The whole new order, by id. */
  onChange: (ids: string[]) => void;
  /** Names the list for a screen reader. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const ids = items.map((i) => i.id);
  const rows = useRef(new Map<string, HTMLLIElement | null>());
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  function announce(id: string, to: number) {
    const name = items.find((i) => i.id === id)?.name ?? id;
    setSaid(`${name}, ${to + 1} of ${items.length}`);
  }

  function step(id: string, by: -1 | 1) {
    const to = ids.indexOf(id) + by;
    if (to < 0 || to >= ids.length) return;
    onChange(moveTo(ids, id, to));
    announce(id, to);
    // Keep the keyboard on the row that moved; at an end, on its other button.
    requestAnimationFrame(() => {
      const same = buttons.current.get(`${id}:${by}`);
      const other = buttons.current.get(`${id}:${-by}`);
      (same && !same.disabled ? same : other)?.focus();
    });
  }

  // Pointer drag: the row follows the pointer one place at a time, each time
  // it passes the middle of the row beside it.
  function onPointerDown(e: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(id);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (dragging !== id) return;
    const at = ids.indexOf(id);
    const y = e.clientY;
    const above = at > 0 ? rows.current.get(ids[at - 1]!) : null;
    const below = at < ids.length - 1 ? rows.current.get(ids[at + 1]!) : null;
    const mid = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    if (above && y < mid(above)) {
      onChange(moveTo(ids, id, at - 1));
      announce(id, at - 1);
    } else if (below && y > mid(below)) {
      onChange(moveTo(ids, id, at + 1));
      announce(id, at + 1);
    }
  }

  function endDrag() {
    setDragging(null);
  }

  return (
    <>
      <ol className={["kit-sortable", className].filter(Boolean).join(" ")} aria-label={label}>
        {items.map((item, i) => (
          <li
            key={item.id}
            ref={(el) => {
              rows.current.set(item.id, el);
            }}
            className={["kit-sortable-row", dragging === item.id && "is-dragging"].filter(Boolean).join(" ")}
            data-id={item.id}
          >
            {/* The pointer's way to move a row; the keyboard's is the buttons. */}
            <span
              className="kit-sortable-handle"
              aria-hidden="true"
              title={`Drag ${item.name}`}
              data-disabled={disabled || undefined}
              onPointerDown={(e) => onPointerDown(e, item.id)}
              onPointerMove={(e) => onPointerMove(e, item.id)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" />
                <circle cx="15" cy="18" r="1.5" />
              </svg>
            </span>
            <span className="kit-sortable-name">{item.name}</span>
            {item.extra && <span className="kit-sortable-extra">{item.extra}</span>}
            <span className="kit-sortable-moves">
              {([-1, 1] as const).map((by) => {
                const word = by < 0 ? "up" : "down";
                return (
                  <Button
                    key={by}
                    ref={(el: HTMLButtonElement | null) => {
                      buttons.current.set(`${item.id}:${by}`, el);
                    }}
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${item.name} ${word}`}
                    disabled={disabled || (by < 0 ? i === 0 : i === items.length - 1)}
                    onClick={() => step(item.id, by)}
                  >
                    {by < 0 ? "Up" : "Down"}
                  </Button>
                );
              })}
            </span>
          </li>
        ))}
      </ol>
      <p className="visually-hidden" role="status" aria-live="polite">
        {said}
      </p>
    </>
  );
}
