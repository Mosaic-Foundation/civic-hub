// Districts and demographics (2026-11-16): the shared rules in
// src/shared/aboutYou.ts, the district list's settings validation, and the
// module's coarse tags.

import { describe, expect, it } from "vitest";
import {
  aboutConfig,
  ageBracket,
  asksAnything,
  DEFAULT_DISTRICT_TERM,
  districtIdFrom,
  matchDistrict,
  parseDistricts,
  pluralOf,
} from "../../src/shared/aboutYou.js";
import { normalizeValue } from "../../src/models/hubSettingsWrite.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";
import { tagsFrom } from "../../src/modules/civic.about/index.js";

const FLOYD = [
  { id: "burks-fork", name: "Burks Fork" },
  { id: "courthouse", name: "Courthouse" },
  { id: "indian-valley", name: "Indian Valley" },
  { id: "little-river", name: "Little River" },
  { id: "locust-grove", name: "Locust Grove" },
];

const reader = (values: Record<string, string>) => (key: string) => values[key];

describe("what a district is called", () => {
  it("is District on every kind of place", () => {
    expect(DEFAULT_DISTRICT_TERM).toEqual({ singular: "District", plural: "Districts" });
    for (const t of ["county", "city", "town", "village", "borough", "school_district", "other"]) {
      expect(aboutConfig(reader({ "identity.jurisdiction_type": t })).term).toEqual({ singular: "District", plural: "Districts" });
    }
  });

  it("takes the admin's word, and makes its plural when none is given", () => {
    expect(aboutConfig(reader({ "about.district_term": "Precinct" })).term).toEqual({ singular: "Precinct", plural: "Precincts" });
    expect(aboutConfig(reader({ "about.district_term": "Ward", "about.district_term_plural": "The wards" })).term.plural).toBe("The wards");
    expect(pluralOf("Borough")).toBe("Boroughs");
    expect(pluralOf("Parish")).toBe("Parishes");
    expect(pluralOf("County")).toBe("Counties");
  });
});

describe("which questions are on", () => {
  it("asks district and birth year, not race, unless the hub says otherwise", () => {
    const c = aboutConfig(reader({ "about.districts": JSON.stringify(FLOYD) }));
    expect(c.questions).toEqual({ district: true, birth_year: true, race: false });
    expect(asksAnything(c)).toBe(true);
  });

  it("does not ask for a district when there are none to choose", () => {
    expect(aboutConfig(reader({})).questions.district).toBe(false);
  });

  it("asks nothing when every question is off", () => {
    const c = aboutConfig(reader({ "about.ask_district": "false", "about.ask_birth_year": "false", "about.ask_race": "false" }));
    expect(asksAnything(c)).toBe(false);
  });
});

describe("age groups", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("puts a birth year in its bracket at the time asked", () => {
    expect(ageBracket(2008, now)).toBe("18-24");
    expect(ageBracket(2002, now)).toBe("18-24");
    expect(ageBracket(2001, now)).toBe("25-34");
    expect(ageBracket(1977, now)).toBe("35-49");
    expect(ageBracket(1962, now)).toBe("50-64");
    expect(ageBracket(1952, now)).toBe("65-74");
    expect(ageBracket(1951, now)).toBe("75+");
  });

  it("gives no bracket under 18 or without a year", () => {
    expect(ageBracket(2010, now)).toBeNull();
    expect(ageBracket(null, now)).toBeNull();
  });
});

describe("matching a Census name to the hub's list", () => {
  it("matches loosely: case, a trailing 'district', spaces", () => {
    expect(matchDistrict("Court House district", FLOYD)?.id).toBe("courthouse");
    expect(matchDistrict("Little River district", FLOYD)?.id).toBe("little-river");
    expect(matchDistrict("BURKS FORK DISTRICT", FLOYD)?.id).toBe("burks-fork");
    expect(matchDistrict("Locust Grove magisterial district", FLOYD)?.id).toBe("locust-grove");
  });

  it("finds nothing for a name not on the list", () => {
    expect(matchDistrict("Alum Ridge district", FLOYD)).toBeNull();
    expect(matchDistrict("district", FLOYD)).toBeNull();
  });
});

describe("the district list setting", () => {
  const spec = fieldSpec("about.districts")!;

  it("keeps ids and names", () => {
    expect(normalizeValue(spec, FLOYD)).toBe(JSON.stringify(FLOYD));
    expect(normalizeValue(spec, "")).toBe("");
    expect(parseDistricts(JSON.stringify(FLOYD))).toEqual(FLOYD);
  });

  it("refuses a repeated id or name, a bad id and an empty name", () => {
    expect(normalizeValue(spec, [FLOYD[0], FLOYD[0]])).toHaveProperty("error");
    expect(normalizeValue(spec, [FLOYD[0], { id: "other", name: "burks fork" }])).toHaveProperty("error");
    expect(normalizeValue(spec, [{ id: "Bad Id", name: "X" }])).toHaveProperty("error");
    expect(normalizeValue(spec, [{ id: "x", name: "  " }])).toHaveProperty("error");
  });

  it("makes an id from a name, unique in the list", () => {
    expect(districtIdFrom("Court House")).toBe("court-house");
    expect(districtIdFrom("Court House", ["court-house"])).toBe("court-house-2");
  });
});

describe("a member's tags", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const config = aboutConfig(reader({ "about.districts": JSON.stringify(FLOYD) }));
  const answers = { district_id: "courthouse", birth_year: 1980, race: ["white"], declined: [], asked_at: null };

  it("are a district, an age group, and race only when the hub asks", () => {
    expect(tagsFrom(answers, config, now)).toEqual({ district_id: "courthouse", age_bracket: "35-49", race: null });
    const withRace = aboutConfig(reader({ "about.districts": JSON.stringify(FLOYD), "about.ask_race": "true" }));
    expect(tagsFrom(answers, withRace, now).race).toEqual(["white"]);
  });

  it("drop a district no longer on the list, and a question switched off", () => {
    expect(tagsFrom({ ...answers, district_id: "gone" }, config, now).district_id).toBeNull();
    const noAge = aboutConfig(reader({ "about.districts": JSON.stringify(FLOYD), "about.ask_birth_year": "false" }));
    expect(tagsFrom(answers, noAge, now).age_bracket).toBeNull();
  });

  it("are all not provided for someone with no answers", () => {
    expect(tagsFrom(null, config, now)).toEqual({ district_id: null, age_bracket: null, race: null });
  });
});

describe("reading the Census geocoder's answer", () => {
  it("takes the county subdivision and county names from the first match", async () => {
    const { placeFromCensus } = await import("../../src/hosting/censusGeocoder.js");
    const body = {
      result: {
        addressMatches: [
          {
            geographies: {
              "County Subdivisions": [{ NAME: "Court House district", BASENAME: "Court House" }],
              Counties: [{ NAME: "Floyd County" }],
            },
          },
        ],
      },
    };
    expect(placeFromCensus(body)).toEqual({ countySubdivision: "Court House district", county: "Floyd County" });
    expect(placeFromCensus({ result: { addressMatches: [] } })).toBeNull();
    expect(placeFromCensus(null)).toBeNull();
  });
});

describe("filling the district list from the Census", () => {
  it("reads a county's subdivisions from a TIGERweb answer", async () => {
    const { subdivisionNamesFromCensus } = await import("../../src/hosting/censusGeocoder.js");
    const body = {
      features: [
        { attributes: { NAME: "Little River district" } },
        { attributes: { NAME: "Burks Fork district" } },
        { attributes: { NAME: "County subdivisions not defined" } },
      ],
    };
    expect(subdivisionNamesFromCensus(body)).toEqual(["Burks Fork district", "Little River district"]);
    expect(subdivisionNamesFromCensus({ error: { code: 400 } })).toBeNull();
  });

  it("names a district as people say it", async () => {
    const { plainDistrictName } = await import("../../src/services/districtLookup.js");
    expect(plainDistrictName("Court House district")).toBe("Court House");
    expect(plainDistrictName("Locust Grove magisterial district")).toBe("Locust Grove");
    expect(plainDistrictName("Ward 3")).toBe("Ward 3");
    expect(plainDistrictName("district")).toBe("district");
  });

  it("still matches a plain name the admin renamed, to the Census's name for it", () => {
    const listed = [{ id: "court-house", name: "Courthouse" }];
    expect(matchDistrict("Court House district", listed)?.id).toBe("court-house");
  });
});
