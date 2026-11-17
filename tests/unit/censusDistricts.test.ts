// Districts (Adam, 2026-11-17): a county hub with no list of its own uses the
// Census's with no admin work. ensureCensusDistricts keeps it in
// about.census_districts; aboutConfig falls back to it; an admin's list wins.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let county: string | null = "51063";

vi.mock("../../src/services/hubSettings.js", () => ({
  KEYS: { ABOUT_DISTRICTS: "about.districts", ABOUT_CENSUS_DISTRICTS: "about.census_districts" },
  getSetting: async (_hub: string, key: string) => store.get(key),
  setSetting: async (_hub: string, key: string, value: string) => {
    if (value === "") store.delete(key);
    else store.set(key, value);
  },
}));
vi.mock("../../src/db/hubs.js", () => ({ countyGeoidForHub: async () => county }));

const { installAdapters } = await import("../../src/adapters/index.js");
const { fakeGeocoder } = await import("../../src/adapters/fakes/geocoder.js");
const { ensureCensusDistricts, resetCensusDistrictChecks, CENSUS_RECHECK_MS, CENSUS_RETRY_MS } = await import(
  "../../src/services/districtLookup.js"
);
const { aboutConfig, parseCensusDistricts } = await import("../../src/shared/aboutYou.js");

const FLOYD_IDS = ["burks-fork", "court-house", "indian-valley", "little-river", "locust-grove"];
const read = (key: string) => store.get(key);

describe("a county hub's Census districts", () => {
  beforeEach(() => {
    store.clear();
    county = "51063";
    resetCensusDistrictChecks();
    installAdapters({ geocoder: fakeGeocoder() });
  });

  it("are kept on first need, so a new Floyd County hub asks for its five districts at once", async () => {
    expect(aboutConfig(read).questions.district).toBe(false);
    await ensureCensusDistricts("floyd");
    const config = aboutConfig(read);
    expect(config.districtSource).toBe("census");
    expect(config.districts.map((d) => d.id)).toEqual(FLOYD_IDS);
    expect(config.districts.map((d) => d.name)).toContain("Court House");
    expect(config.questions.district).toBe(true);
  });

  it("give the same ids every time, so ballot tags survive a refetch", async () => {
    await ensureCensusDistricts("floyd");
    const first = store.get("about.census_districts");
    store.clear();
    resetCensusDistrictChecks();
    await ensureCensusDistricts("floyd");
    expect(store.get("about.census_districts")).toBe(first);
  });

  it("give way to the admin's own list, which keeps the Census ids it started from", async () => {
    await ensureCensusDistricts("floyd");
    const census = parseCensusDistricts(store.get("about.census_districts"))!.districts;
    const own = census.map((d) => (d.id === "court-house" ? { ...d, name: "Courthouse" } : d));
    store.set("about.districts", JSON.stringify(own));
    const config = aboutConfig(read);
    expect(config.districtSource).toBe("hub");
    expect(config.districts.find((d) => d.id === "court-house")?.name).toBe("Courthouse");
  });

  it("are not fetched for a hub with its own list, or one that is not a county", async () => {
    const geocoder = fakeGeocoder();
    const spy = vi.spyOn(geocoder, "countySubdivisions");
    installAdapters({ geocoder });
    store.set("about.districts", JSON.stringify([{ id: "sparta", name: "Sparta" }]));
    await ensureCensusDistricts("athens");
    store.clear();
    resetCensusDistrictChecks();
    county = null;
    await ensureCensusDistricts("athens");
    expect(spy).not.toHaveBeenCalled();
    expect(store.has("about.census_districts")).toBe(false);
  });

  it("are cleared when the hub stops being a county, and refetched when its county changes", async () => {
    await ensureCensusDistricts("floyd", 0);
    county = "51067";
    await ensureCensusDistricts("floyd", CENSUS_RECHECK_MS + 1);
    expect(parseCensusDistricts(store.get("about.census_districts"))?.county).toBe("51067");
    county = null;
    await ensureCensusDistricts("floyd", 2 * CENSUS_RECHECK_MS + 2);
    expect(store.has("about.census_districts")).toBe(false);
  });

  it("are checked once per instance until the recheck time; a Census failure keeps nothing and is retried in minutes", async () => {
    county = "00000"; // the fake's "Census unreachable"
    await ensureCensusDistricts("floyd", 0);
    expect(store.has("about.census_districts")).toBe(false);
    county = "51063";
    await ensureCensusDistricts("floyd", 1000);
    expect(store.has("about.census_districts")).toBe(false);
    await ensureCensusDistricts("floyd", CENSUS_RETRY_MS + 1);
    expect(store.has("about.census_districts")).toBe(true);
    // Once kept, the next look is hours away.
    county = "51067";
    await ensureCensusDistricts("floyd", CENSUS_RETRY_MS + 2 + CENSUS_RETRY_MS);
    expect(parseCensusDistricts(store.get("about.census_districts"))?.county).toBe("51063");
  });
});
