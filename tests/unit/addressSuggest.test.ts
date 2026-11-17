// Address suggestions (Adam, 2026-11-17): what a member types goes to Mapbox
// through the hub, never from the browser, and only the text and the hub's
// place go out. Unset token: no suggestions, the card keeps type-and-Find.

import { beforeEach, describe, expect, it, vi } from "vitest";

let refuse = false;
vi.mock("../../src/db/rateLimit.js", () => ({
  HOUR_MS: 3_600_000,
  takeRateLimit: async (checks: unknown[]) => (refuse ? checks[0] : null),
}));

const { installAdapters, noneAdapters } = await import("../../src/adapters/index.js");
const { fakeAddressSuggest } = await import("../../src/adapters/fakes/addressSuggest.js");
const { suggestAddresses } = await import("../../src/services/districtLookup.js");
const { aboutConfig } = await import("../../src/shared/aboutYou.js");
const { addressesFromMapbox, pointFromMapbox } = await import("../../src/hosting/mapboxAddresses.js");

const asks = aboutConfig((key) => (key === "about.districts" ? JSON.stringify([{ id: "court-house", name: "Court House" }]) : undefined));
const asksNothing = aboutConfig(() => undefined);

describe("address suggestions", () => {
  beforeEach(() => {
    refuse = false;
    installAdapters({ addressSuggest: fakeAddressSuggest() });
  });

  it("suggest addresses near the hub's place", async () => {
    const r = await suggestAddresses("u1", "223 Tanager", asks, "Floyd County, Virginia");
    expect(r.available).toBe(true);
    expect(r.suggestions).toHaveLength(3);
    expect(r.suggestions[0]).toBe("223 Tanager 1 in Floyd County, Virginia");
  });

  it("send only the text and the place, never who is asking", async () => {
    const fake = fakeAddressSuggest();
    const spy = vi.spyOn(fake, "suggest");
    installAdapters({ addressSuggest: fake });
    await suggestAddresses("member-123", "  223   Tanager Ln ", asks, "Floyd County, Virginia");
    expect(spy).toHaveBeenCalledWith("223 Tanager Ln", "Floyd County, Virginia");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("member-123");
  });

  it("are not available without a token, or on a hub that doesn't ask for a district", async () => {
    installAdapters({ addressSuggest: noneAdapters().addressSuggest });
    expect(await suggestAddresses("u1", "223 Tanager", asks, null)).toEqual({ available: false, suggestions: [] });
    installAdapters({ addressSuggest: fakeAddressSuggest() });
    expect(await suggestAddresses("u1", "223 Tanager", asksNothing, null)).toEqual({ available: false, suggestions: [] });
  });

  it("ask nothing for under three characters, over the hourly limit, or when Mapbox fails", async () => {
    const fake = fakeAddressSuggest();
    installAdapters({ addressSuggest: fake });
    expect((await suggestAddresses("u1", "22", asks, null)).suggestions).toEqual([]);
    expect(fake.calls).toBe(0);
    refuse = true;
    expect((await suggestAddresses("u1", "223 Tanager", asks, null)).suggestions).toEqual([]);
    expect(fake.calls).toBe(0);
    refuse = false;
    expect(await suggestAddresses("u1", "1 mapbox down", asks, null)).toEqual({ available: true, suggestions: [] });
  });
});

describe("reading Mapbox's answer", () => {
  it("takes each feature's full address, without the country, at most five", () => {
    const feature = (full: string) => ({ properties: { full_address: full } });
    const body = {
      features: [
        feature("223 Tanager Lane, Floyd, Virginia 24091, United States"),
        feature("223 Tanager Lane, Floyd, Virginia 24091, United States"),
        { properties: { name: "223 Tanager Court", place_formatted: "Christiansburg, Virginia 24073, United States" } },
        ...["a", "b", "c", "d"].map((x) => feature(`${x} St, Floyd, Virginia`)),
      ],
    };
    expect(addressesFromMapbox(body)).toEqual([
      "223 Tanager Lane, Floyd, Virginia 24091",
      "223 Tanager Court, Christiansburg, Virginia 24073",
      "a St, Floyd, Virginia",
      "b St, Floyd, Virginia",
      "c St, Floyd, Virginia",
    ]);
    expect(addressesFromMapbox({ message: "Not Authorized" })).toEqual([]);
  });

  it("takes the hub place's point for ranking", () => {
    expect(pointFromMapbox({ features: [{ geometry: { coordinates: [-80.3201234, 36.9112345] } }] })).toBe("-80.3201,36.9112");
    expect(pointFromMapbox({ features: [] })).toBeNull();
  });
});
