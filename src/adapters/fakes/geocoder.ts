// The `geocoder` adapter's fake (ADR-012): no network. An address containing
// "nowhere" is not found; "census down" fails; otherwise the county
// subdivision is the text after "in " ("1 Main St in Court House district"),
// or "Court House district" when there is none.

import type { AddressPlace, DistrictGeocoder } from "../geocoder.js";

export function fakeGeocoder(): DistrictGeocoder & { lookups: number } {
  const fake = {
    name: "fake",
    lookups: 0,
    configured: () => true,
    async locate(address: string): Promise<AddressPlace | null> {
      fake.lookups += 1;
      const text = address.toLowerCase();
      if (text.includes("census down")) throw new Error("fake geocoder: the service failed");
      if (text.includes("nowhere")) return null;
      const m = /\bin (.+)$/i.exec(address.trim());
      return { countySubdivision: m ? m[1]!.trim() : "Court House district", county: "Test County" };
    },
    async countySubdivisions(countyGeoid: string): Promise<string[] | null> {
      if (countyGeoid === "00000") return null;
      return ["Burks Fork district", "Court House district", "Indian Valley district", "Little River district", "Locust Grove district"];
    },
  };
  return fake;
}
