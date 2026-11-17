// The `geocoder` adapter (ADR-012; districts and demographics, 2026-11-16):
// which county subdivision an address is in, so a member can find their
// district by typing their address once.
//
// Hosting: src/hosting/censusGeocoder.ts (the US Census Bureau's free
// geocoder). Fake: src/adapters/fakes/geocoder.ts.
//
// THE ADDRESS IS NEVER KEPT: an implementation sends it once, keeps it in no
// variable that outlives the call, and never puts it in an error, a log line
// or a report. A failure says only that the lookup failed.

/** Where an address is, as far as the district lookup needs. */
export interface AddressPlace {
  /** The county subdivision's name, e.g. "Court House district". */
  countySubdivision: string | null;
  /** The county's name, e.g. "Floyd County". */
  county: string | null;
}

export interface DistrictGeocoder {
  readonly name: string;
  /** Whether lookups can be made on this deployment. */
  configured(): boolean;
  /** Where an address is, or null when it can't be found. Throws (without the address) when the service fails. */
  locate(address: string): Promise<AddressPlace | null>;
  /**
   * The county subdivisions of one county (state and county FIPS, "51063"),
   * by name as the Census writes them ("Court House district"), or null when
   * they can't be had. Fills a hub's district list without anyone uploading
   * a map.
   */
  countySubdivisions(countyGeoid: string): Promise<string[] | null>;
}
