// A time zone dropdown (2026-10-08): the US zones in plain words first, then
// every other zone. Shared by the console's Create hub and the start page.
// `value` is what was chosen; until something is, the dropdown shows
// `suggestion` (from the place, or the browser) and that is what is saved.

import { US_TIME_ZONES, otherTimeZones } from "../../../src/shared/stateTimeZones";

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
    <select id={id} value={shown} onChange={(e) => onChange(e.target.value)}>
      {!shown && <option value="">Choose…</option>}
      <optgroup label="United States">
        {US_TIME_ZONES.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Everywhere else">
        {otherTimeZones(shown).map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
