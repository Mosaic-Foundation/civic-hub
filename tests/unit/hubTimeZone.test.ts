import { describe, it, expect } from "vitest";
import { effectiveHubTimeZone, placeTimeZone, zonePlainName } from "../../src/shared/hubTimeZone";

// The hub's clock in one place (Events 3): the setting, else the place's
// zone, else UTC.
describe("effectiveHubTimeZone", () => {
  it("takes the setting when it is a real zone", () => {
    expect(effectiveHubTimeZone("America/Chicago", "us-va-floyd")).toEqual({ zone: "America/Chicago", source: "set" });
  });

  it("falls back to the place's zone, from the code or the OCD id", () => {
    expect(effectiveHubTimeZone("", "us-va-floyd")).toEqual({ zone: "America/New_York", source: "place" });
    expect(effectiveHubTimeZone(undefined, null, "ocd-division/country:us/state:co/county:x")).toEqual({ zone: "America/Denver", source: "place" });
    expect(effectiveHubTimeZone("Not/AZone", "us-ca-x").zone).toBe("America/Los_Angeles");
  });

  it("is UTC only for a hub with no place", () => {
    expect(effectiveHubTimeZone(null, null)).toEqual({ zone: "UTC", source: "default" });
    expect(placeTimeZone("custom-thing")).toBe("");
  });
});

describe("zonePlainName", () => {
  it("says the US zones as people do, and others by their city", () => {
    expect(zonePlainName("America/New_York")).toBe("Eastern");
    expect(zonePlainName("America/Phoenix")).toBe("Mountain");
    expect(zonePlainName("Europe/London")).toBe("London");
    expect(zonePlainName("UTC")).toBe("UTC");
  });
});
