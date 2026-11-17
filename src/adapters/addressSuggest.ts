// The `addressSuggest` adapter (ADR-012; Adam, 2026-11-17): street addresses
// that match what a member is typing, so they can pick theirs and find their
// district (src/services/districtLookup.ts) without typing it in full.
//
// Hosting: src/hosting/mapboxAddresses.ts (Mapbox, MAPBOX_ACCESS_TOKEN).
// Fake: src/adapters/fakes/addressSuggest.ts. Unset: not configured, and the
// member card keeps its type-and-Find box.
//
// WHAT IS TYPED IS NEVER KEPT: an implementation sends it once and keeps it
// in no variable that outlives the call, no error, no log line and no report.
// Its token never leaves the server.

export interface AddressSuggester {
  readonly name: string;
  /** Whether suggestions can be had on this deployment. */
  configured(): boolean;
  /**
   * Up to five US street addresses matching `text`, nearest `near` (the
   * hub's place, "Floyd County, Virginia") first when it is given. Throws
   * (with no part of `text`) when the service fails.
   */
  suggest(text: string, near: string | null): Promise<string[]>;
}
