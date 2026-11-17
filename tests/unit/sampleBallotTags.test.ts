// District and age tags on a demo hub's sample ballots (2026-11-17): a fixed
// spread with one group under 5 in each table, so a demo's closed sample vote
// shows counted groups and a "Fewer than 5".

import { describe, expect, it } from "vitest";
import { sampleBallotTags } from "../../src/services/sampleBallotTags.js";

const count = (values: Array<string | null>) =>
  values.reduce<Record<string, number>>((m, v) => ({ ...m, [String(v)]: (m[String(v)] ?? 0) + 1 }), {});

describe("sample ballot tags", () => {
  it("put 3 ballots in the last district and spread the rest over the others", () => {
    const byDistrict = count(sampleBallotTags(50, ["a", "b", "c", "d", "e"]).map((t) => t.district_id));
    expect(byDistrict.e).toBe(3);
    for (const d of ["a", "b", "c", "d"]) expect(byDistrict[d]).toBeGreaterThanOrEqual(5);
  });

  it("put 2 ballots in 75 and over and at least 5 in each other age group of a 50-ballot vote", () => {
    const byAge = count(sampleBallotTags(50, ["a"]).map((t) => t.age_bracket));
    expect(byAge["75+"]).toBe(2);
    for (const a of ["18-24", "25-34", "35-49", "50-64", "65-74"]) expect(byAge[a]).toBeGreaterThanOrEqual(5);
  });

  it("leave the district empty on a hub with none, and use the only one when there is one", () => {
    expect(sampleBallotTags(4, []).every((t) => t.district_id === null)).toBe(true);
    expect(sampleBallotTags(4, ["only"]).every((t) => t.district_id === "only")).toBe(true);
  });
});
