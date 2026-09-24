// The Floyd names used below are fixture values for the test, not defaults.

import { describe, expect, it } from "vitest";
import { GREEN_BOX_VOTE, FLOCK_CAMERA_VOTE } from "../../src/debug/seedData.js";
import { localizeScenario } from "../../src/debug/localizeScenario.js";

const FLOYD_NAMES = {
  place: "Floyd County",
  governing_body: "Board of Supervisors",
  jurisdiction: "us-va-floyd",
};

const ATHENS_NAMES = {
  place: "Town of Athens",
  governing_body: "Town Council",
  jurisdiction: "us-va-athens",
};

/** Collects every string value found anywhere in a deeply nested value. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

describe("localizeScenario on the seed vote scenarios", () => {
  it("fills Floyd's own names in unchanged, with no leftover template tokens", () => {
    const localized = localizeScenario(GREEN_BOX_VOTE, FLOYD_NAMES);

    expect(localized.process.description).toContain("Should Floyd County invest");
    expect(localized.process.jurisdiction).toBe("us-va-floyd");

    for (const scenario of [
      localizeScenario(GREEN_BOX_VOTE, FLOYD_NAMES),
      localizeScenario(FLOCK_CAMERA_VOTE, FLOYD_NAMES),
    ]) {
      for (const s of collectStrings(scenario)) {
        expect(s).not.toContain("{PLACE}");
        expect(s).not.toContain("{GOVERNING_BODY}");
        expect(s).not.toContain("{JURISDICTION}");
      }
    }
  });

  it("carries no Floyd-specific language when filled with another hub's names", () => {
    for (const scenario of [
      localizeScenario(GREEN_BOX_VOTE, ATHENS_NAMES),
      localizeScenario(FLOCK_CAMERA_VOTE, ATHENS_NAMES),
    ]) {
      for (const s of collectStrings(scenario)) {
        expect(s).not.toMatch(/floyd|supervisors/i);
      }
    }
  });
});
