// The hub's date and time control (design pass, decision 7, 2026-10-29): the
// one place every form's date-time field is drawn, the hub's and every
// package's (kit/index.tsx re-exports it).
//
// The field itself is the browser's datetime-local input, styled by the kit,
// so typing, its value ("YYYY-MM-DDTHH:MM") and how a screen reader reads it
// stay as they were; the browser's own picker icon is hidden. Beside it, the
// hub's button opens the hub's picker: a month of days and a time, drawn with
// the tokens. In the popover the arrow keys move a day or a week, Page Up and
// Page Down a month, Enter or Space chooses, Escape closes and gives focus
// back; Tab stays inside it while it is open.

import { useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { fromLocalInput, toLocalInput } from "./datetime";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  /** The IANA zone the time is entered in (an event's own); the reader's when absent. */
  timeZone?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = (() => {
  // Monday first; the reader's language for the short names.
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getFullYear(), 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }),
  );
})();

/** Every quarter hour of a day, as "HH:MM", plus `keep` when it is off the grid. */
function times(keep: string | null): string[] {
  const all = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
  if (keep && !all.includes(keep)) {
    all.push(keep);
    all.sort();
  }
  return all;
}

export default function DateTimeInput({ value, onChange, timeZone, className, id, disabled, ...rest }: Props) {
  const local = toLocalInput(value, timeZone);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const autoId = useId();
  const fieldId = id ?? autoId;

  function choose(next: string) {
    onChange(fromLocalInput(next, timeZone));
  }

  return (
    <span className="kit-datetime">
      <input
        type="datetime-local"
        id={fieldId}
        className={["form-input", "kit-datetime-field", className].filter(Boolean).join(" ")}
        value={local}
        disabled={disabled}
        onChange={(e) => choose(e.target.value)}
        {...rest}
      />
      <button
        ref={button}
        type="button"
        className="kit-datetime-button"
        aria-label="Choose a date and time"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${fieldId}-picker` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && (
        <Picker
          id={`${fieldId}-picker`}
          local={local}
          onPick={(next) => choose(next)}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </span>
  );
}

function Picker({
  id,
  local,
  onPick,
  onClose,
}: {
  id: string;
  local: string;
  onPick: (local: string) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [datePart, timePart] = local ? local.split("T") : [localDate(now), null];
  const chosen = datePart ?? localDate(now);
  const [focusDay, setFocusDay] = useState(chosen);
  const [time, setTime] = useState(timePart ?? "18:00");
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const [y, m] = focusDay.split("-").map(Number) as [number, number];
  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = useMemo(() => {
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const count = new Date(y, m, 0).getDate();
    return [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => localDate(new Date(y, m - 1, i + 1)))];
  }, [y, m]);

  // Focus the day in focus, on open and as it moves.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  // A click outside closes it.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  function move(days: number, months = 0) {
    const [fy, fm, fd] = focusDay.split("-").map(Number) as [number, number, number];
    const d = new Date(fy, fm - 1 + months, months ? Math.min(fd, new Date(fy, fm + months, 0).getDate()) : fd + days);
    setFocusDay(localDate(d));
  }

  function pick(day: string) {
    onPick(`${day}T${time}`);
    onClose();
  }

  function onGridKey(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      ArrowUp: () => move(-7),
      ArrowDown: () => move(7),
      PageUp: () => move(0, -1),
      PageDown: () => move(0, 1),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]!();
    }
  }

  // Escape closes; Tab cycles inside the popover.
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !root.current) return;
    const stops = [...root.current.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), select")].filter(
      (el) => !el.hasAttribute("disabled"),
    );
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  const today = localDate(now);
  return (
    <div ref={root} id={id} className="kit-datetime-picker" role="dialog" aria-label="Choose a date and time" onKeyDown={onKey}>
      <div className="kit-datetime-head">
        <button type="button" className="kit-datetime-nav" aria-label="Previous month" onClick={() => move(0, -1)}>
          ‹
        </button>
        <span className="kit-datetime-month" aria-live="polite">
          {monthName}
        </span>
        <button type="button" className="kit-datetime-nav" aria-label="Next month" onClick={() => move(0, 1)}>
          ›
        </button>
      </div>
      <div className="kit-datetime-weekdays" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div ref={grid} className="kit-datetime-grid" role="group" aria-label={monthName} onKeyDown={onGridKey}>
        {days.map((day, i) =>
          day === null ? (
            <span key={`lead-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              data-day={day}
              className={["kit-datetime-day", day === chosen && "is-chosen", day === today && "is-today"].filter(Boolean).join(" ")}
              tabIndex={day === focusDay ? 0 : -1}
              aria-pressed={day === chosen}
              aria-label={new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              onClick={() => pick(day)}
            >
              {Number(day.slice(8))}
            </button>
          ),
        )}
      </div>
      <label className="kit-datetime-time">
        <span>Time</span>
        <select className="form-select" value={time} onChange={(e) => setTime(e.target.value)}>
          {times(timePart).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <div className="kit-datetime-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => pick(focusDay)}>
          Done
        </button>
      </div>
    </div>
  );
}
