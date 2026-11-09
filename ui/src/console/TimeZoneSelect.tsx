// A time zone dropdown for the console's Create hub and the start page. It is
// the kit's TimeZoneSelect (Events 0.4.1, Adam 2026-11-09), so every zone
// choice reads the same: seven zones in plain words, then "More time zones…".
// `value` is what was chosen; until something is, the dropdown shows
// `suggestion` (from the place, or the browser) and that is what is saved. A
// suggestion off the short list (Detroit, Boise) is kept as a choice of its own.

import { NO_FILL } from "./noFill";
import { TimeZoneSelect as KitTimeZoneSelect } from "../kit/TimeZoneSelect";

export function TimeZoneSelect({
  value,
  suggestion,
  onChange,
  id,
}: {
  value: string;
  suggestion: string;
  onChange: (zone: string) => void;
  id?: string;
}) {
  const shown = value || suggestion;
  return (
    <KitTimeZoneSelect
      {...NO_FILL}
      name="cs-tz"
      id={id}
      value={shown}
      onChange={onChange}
      first={shown ? [] : [{ value: "", label: "Choose…" }]}
    />
  );
}
