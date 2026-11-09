// A time zone choice (Events 0.4.1, Adam 2026-11-08): seven zones in plain
// words first, and "More time zones…" opening every zone the browser knows.
// The Events form and Hub settings → Identity both use it; a page puts its
// own choices above the short list through `first` (the hub's own zone, or
// "Not set"). A saved zone that is not on the short list is kept as a choice
// of its own, so it is never silently changed.

import { useEffect, useRef, useState, type SelectHTMLAttributes } from "react";
import { SHORT_TIME_ZONES, allTimeZones, timeZoneLabel } from "./timeZones";

const MORE = "__more_time_zones__";

export interface TimeZoneSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children"> {
  /** The chosen zone ("" for a `first` choice that means none). */
  value: string;
  onChange: (zone: string) => void;
  /** Choices above the short list: the hub's own zone, or "Not set". */
  first?: ReadonlyArray<{ value: string; label: string }>;
}

export function TimeZoneSelect({ value, onChange, first = [], className, ...rest }: TimeZoneSelectProps) {
  const ref = useRef<HTMLSelectElement>(null);
  const [more, setMore] = useState(false);
  const reopen = useRef(false);

  const pinned = new Set(first.map((o) => o.value));
  const short = SHORT_TIME_ZONES.filter((z) => !pinned.has(z.id));
  const shown = new Set([...pinned, ...short.map((z) => z.id)]);
  const unusual = value !== "" && !shown.has(value);

  // Open the full list straight away where the browser can (the press that
  // chose "More time zones…" still counts as the person's).
  useEffect(() => {
    if (!more || !reopen.current) return;
    reopen.current = false;
    try {
      (ref.current as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
    } catch {
      // Not every browser opens a list from script; the next press does.
    }
  }, [more]);

  return (
    <select
      ref={ref}
      className={["form-select", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(e) => {
        if (e.target.value === MORE) {
          reopen.current = true;
          setMore(true);
          return;
        }
        onChange(e.target.value);
      }}
      {...rest}
    >
      {first.map((o) => (
        <option key={`first-${o.value}`} value={o.value}>
          {o.label}
        </option>
      ))}
      {short.map((z) => (
        <option key={z.id} value={z.id}>
          {z.label}
        </option>
      ))}
      {more ? (
        <optgroup label="All time zones">
          {allTimeZones()
            .filter((z) => !shown.has(z))
            .map((z) => (
              <option key={z} value={z}>
                {timeZoneLabel(z)}
              </option>
            ))}
          {unusual && !allTimeZones().includes(value) && <option value={value}>{timeZoneLabel(value)}</option>}
        </optgroup>
      ) : (
        <>
          {unusual && <option value={value}>{timeZoneLabel(value)}</option>}
          <option value={MORE}>More time zones…</option>
        </>
      )}
    </select>
  );
}
