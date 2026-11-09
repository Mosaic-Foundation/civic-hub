// The time zones TimeZoneSelect offers (Events 0.4.1): the short list, every
// zone the browser knows, and a zone's name in the list.

/** The short list, in this order, in plain words. */
export const SHORT_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Phoenix", label: "Arizona" },
];

/** Every zone the browser knows, UTC among them. */
export function allTimeZones(): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return all.includes("UTC") ? all : ["UTC", ...all];
}

/** A zone as the list names it: "Eastern" for the short list, else its id in words. */
export function timeZoneLabel(zone: string): string {
  return SHORT_TIME_ZONES.find((z) => z.id === zone)?.label ?? zone.replace(/_/g, " ");
}
