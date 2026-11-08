// The kit's calendar views (Events 3, 2026-11-08): a month of days with what
// falls on each (MonthGrid, for a wide screen) and a week of days above a list
// (WeekStrip, for a phone). The weeks start on Monday, as the date picker's do
// (kit/DateTimeInput.tsx). Both work in calendar days ("YYYY-MM-DD"): the page
// says which day each item falls on, in the zone it means (dayKey in
// kit/patterns.tsx), so the grid never meets a time zone itself.
//
// Tokens only (kit.css, "Calendar"); keyboard: the arrows move a day or a
// week, Page Up and Page Down a month, Enter or Space chooses.

import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { shiftDay } from "./dates";

export interface CalendarItem {
  id: string;
  /** The calendar day it falls on, "YYYY-MM-DD". */
  day: string;
  /** What the chip says: a time and a title. */
  label: ReactNode;
  /** Its kind's colour key, as a ListCard's. */
  kind?: string;
  /** Called off: the chip is struck through. */
  cancelled?: boolean;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday on or before the day. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftDay(day, -dow);
}

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });

function byDay(items: readonly CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const i of items) map.set(i.day, [...(map.get(i.day) ?? []), i]);
  return map;
}

function useGridKeys(selected: string, onSelect: (day: string) => void) {
  return (e: KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [-7, 0],
      ArrowDown: [7, 0],
      PageUp: [0, -1],
      PageDown: [0, 1],
    };
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    onSelect(shiftDay(selected, mv[0], mv[1]));
  };
}

function useFocusSelected(selected: string) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // Only once the reader has moved with the keys: the page does not jump to the grid as it opens.
    if (!moved.current) {
      moved.current = true;
      return;
    }
    if (ref.current?.contains(document.activeElement)) {
      ref.current.querySelector<HTMLButtonElement>(`[data-day="${selected}"]`)?.focus();
    }
  }, [selected]);
  return ref;
}

/**
 * A month of days, each with its items as chips; choosing a day calls
 * `onSelect` (the page shows that day's list under it). The month shown is
 * the selected day's.
 */
export function MonthGrid({
  items,
  selected,
  onSelect,
  today,
  maxPerDay = 3,
  label = "Calendar",
}: {
  items: readonly CalendarItem[];
  /** The chosen day, "YYYY-MM-DD"; its month is the one shown. */
  selected: string;
  onSelect: (day: string) => void;
  /** Today in the page's zone, "YYYY-MM-DD". */
  today: string;
  /** Chips shown in a day before "+ n more". */
  maxPerDay?: number;
  label?: string;
}) {
  const month = selected.slice(0, 7);
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  const days = useMemo(() => {
    const first = `${month}-01`;
    const start = mondayOf(first);
    const lastDay = shiftDay(first, 0, 1);
    const end = shiftDay(mondayOf(shiftDay(lastDay, -1)), 6);
    const out: string[] = [];
    for (let d = start; d <= end; d = shiftDay(d, 1)) out.push(d);
    return out;
  }, [month]);
  const map = useMemo(() => byDay(items), [items]);
  const grid = useFocusSelected(selected);
  const onKey = useGridKeys(selected, onSelect);

  return (
    <div className="kit-month" aria-label={label} role="region">
      <div className="kit-month-head">
        <button type="button" className="kit-month-nav" aria-label="Previous month" onClick={() => onSelect(shiftDay(selected, 0, -1))}>
          ‹
        </button>
        <h2 className="kit-month-name" aria-live="polite">
          {monthName}
        </h2>
        <button type="button" className="kit-month-nav" aria-label="Next month" onClick={() => onSelect(shiftDay(selected, 0, 1))}>
          ›
        </button>
        {today.slice(0, 7) !== month && (
          <button type="button" className="kit-month-today" onClick={() => onSelect(today)}>
            Today
          </button>
        )}
      </div>
      <div className="kit-month-weekdays" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div ref={grid} className="kit-month-grid" role="group" aria-label={monthName} onKeyDown={onKey}>
        {days.map((day) => {
          const here = map.get(day) ?? [];
          const shown = here.slice(0, maxPerDay);
          const more = here.length - shown.length;
          const outside = day.slice(0, 7) !== month;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              className={[
                "kit-month-day",
                outside && "is-outside",
                day === today && "is-today",
                day === selected && "is-chosen",
              ]
                .filter(Boolean)
                .join(" ")}
              tabIndex={day === selected ? 0 : -1}
              aria-pressed={day === selected}
              aria-label={`${longDay(day)}${here.length ? `, ${here.length} ${here.length === 1 ? "event" : "events"}` : ""}`}
              onClick={() => onSelect(day)}
            >
              <span className="kit-month-num">{Number(day.slice(8))}</span>
              {shown.map((i) => (
                <span
                  key={i.id}
                  className={`kit-month-chip${i.cancelled ? " is-cancelled" : ""}`}
                  style={i.kind ? { borderColor: `var(--type-${i.kind}-fg)` } : undefined}
                >
                  {i.label}
                </span>
              ))}
              {more > 0 && <span className="kit-month-more">+ {more} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A week of days in a row, each with a dot when something falls on it; for a
 * phone, above the chosen day's list. The week shown is the selected day's.
 */
export function WeekStrip({
  items,
  selected,
  onSelect,
  today,
  label = "Week",
}: {
  items: readonly CalendarItem[];
  selected: string;
  onSelect: (day: string) => void;
  today: string;
  label?: string;
}) {
  const start = mondayOf(selected);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(start, i)), [start]);
  const map = useMemo(() => byDay(items), [items]);
  const strip = useFocusSelected(selected);
  const onKey = useGridKeys(selected, onSelect);
  const range = `${new Date(`${days[0]}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} – ${new Date(`${days[6]}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}`;

  return (
    <div className="kit-week" role="region" aria-label={label}>
      <div className="kit-week-head">
        <button type="button" className="kit-month-nav" aria-label="Previous week" onClick={() => onSelect(shiftDay(selected, -7))}>
          ‹
        </button>
        <span className="kit-week-range" aria-live="polite">
          {range}
        </span>
        <button type="button" className="kit-month-nav" aria-label="Next week" onClick={() => onSelect(shiftDay(selected, 7))}>
          ›
        </button>
      </div>
      <div ref={strip} className="kit-week-days" role="group" aria-label={range} onKeyDown={onKey}>
        {days.map((day, i) => {
          const n = map.get(day)?.length ?? 0;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              className={["kit-week-day", day === today && "is-today", day === selected && "is-chosen"].filter(Boolean).join(" ")}
              tabIndex={day === selected ? 0 : -1}
              aria-pressed={day === selected}
              aria-label={`${longDay(day)}${n ? `, ${n} ${n === 1 ? "event" : "events"}` : ""}`}
              onClick={() => onSelect(day)}
            >
              <span className="kit-week-name">{WEEKDAYS[i]!.slice(0, 1)}</span>
              <span className="kit-week-num">{Number(day.slice(8))}</span>
              <span className={`kit-week-dot${n ? " has-items" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
