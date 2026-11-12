// What the hub keeps of the start page (session 4b, 2026-10-08) since the
// console split: "start" stays a reserved slug, and the time zone choices
// its form shared with the hub's Settings. The start page itself is the
// console's (Mosaic-Foundation/mosaic-console).

import { describe, expect, it } from "vitest";
import { hubSlugRejectionReason } from "../../src/models/hub.js";

describe("start is reserved", () => {
  it("cannot be a hub's slug", () => {
    expect(hubSlugRejectionReason("start")).toMatch(/reserved \(the start page/);
  });
});

describe("time zone choices (2026-10-08)", () => {
  it("list the US zones in words first, then every other zone, keeping an unknown current one", async () => {
    const { US_TIME_ZONES, otherTimeZones } = await import("../../src/shared/stateTimeZones.js");
    expect(US_TIME_ZONES.map((z) => z.id)).toContain("America/New_York");
    const rest = otherTimeZones();
    expect(rest).toContain("Europe/London");
    expect(rest).not.toContain("America/New_York");
    expect(otherTimeZones("Mars/Olympus_Mons")[0]).toBe("Mars/Olympus_Mons");
  });
});
