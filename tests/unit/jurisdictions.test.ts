// The jurisdiction reference list's pure pieces (2026-09-27): slug
// candidates in Adam's order, the names and codes the console derives from a
// row, how a reference type maps onto a hub's type, the platform postal
// address fallback, what "points at a hub" means for the purge, and the CSV
// reader the loader uses.

import { describe, expect, it } from "vitest";
import { baseName, jurisdictionCodeFor, slugCandidates, slugify } from "../../src/shared/jurisdictionNames.js";
import {
  defaultGoverningBody,
  hubTypeFor,
  isReferenceJurisdictionType,
  stateOfOcdId,
} from "../../src/shared/jurisdictionType.js";
import { postalAddressFrom } from "../../src/services/hubSettings.js";
import { redirectPointsAt } from "../../scripts/lib/hubPurge.js";
import { parseCsv, parseCsvObjects, toCsv } from "../../scripts/lib/csv.js";

describe("slug candidates", () => {
  it("plain name, then name + type, then name + state, then a number", () => {
    expect(slugCandidates("Example", "town", "zz", 6)).toEqual([
      "example",
      "example-town",
      "example-zz",
      "example-2",
      "example-3",
      "example-4",
    ]);
    expect(slugCandidates("Example", "county", "zz", 3)).toEqual(["example", "example-county", "example-zz"]);
    expect(slugCandidates("Example Unified", "school_district", null, 3)).toEqual([
      "example-unified",
      "example-unified-schools",
      "example-unified-2",
    ]);
  });

  it("stays within 32 characters and never ends in a hyphen", () => {
    for (const s of slugCandidates("A very long place name that goes on and on", "town", "zz", 12)) {
      expect(s.length).toBeLessThanOrEqual(32);
      expect(s).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    }
  });

  it("slugifies accents and punctuation", () => {
    expect(slugify("Cañon City's  North")).toBe("canon-city-s-north");
    expect(slugCandidates("!!!", null, null)).toEqual([]);
  });
});

describe("names from a reference row", () => {
  it("drops the Census's type word", () => {
    expect(baseName("Example town", "town")).toBe("Example");
    expect(baseName("Example County", "county")).toBe("Example");
    expect(baseName("Example Parish", "county")).toBe("Example");
    expect(baseName("Example city", "city")).toBe("Example");
    expect(baseName("Example CDP", "cdp")).toBe("Example");
    expect(baseName("Example City and Borough", "borough")).toBe("Example");
    // A name that is only the word is kept whole.
    expect(baseName("Town", "town")).toBe("Town");
  });

  it("fills the jurisdiction code in the existing us-<state>-<name> form", () => {
    expect(jurisdictionCodeFor({ state: "zz", type: "county", official_name: "Example County" })).toBe("us-zz-example");
    expect(jurisdictionCodeFor({ state: "zz", type: "town", official_name: "Example town" })).toBe("us-zz-example");
    expect(jurisdictionCodeFor({ state: "zz", type: "state", official_name: "Zedland" })).toBe("us-zz");
  });
});

describe("reference types and hub types", () => {
  it("collapses census-designated places and states to other", () => {
    expect(hubTypeFor("cdp")).toBe("other");
    expect(hubTypeFor("state")).toBe("other");
    expect(hubTypeFor("borough")).toBe("borough");
    expect(hubTypeFor("school_district")).toBe("school_district");
    expect(isReferenceJurisdictionType("cdp")).toBe(true);
    expect(isReferenceJurisdictionType("parish")).toBe(false);
  });

  it("reads the state from an OCD id, and the county default follows it", () => {
    expect(stateOfOcdId("ocd-division/country:us/state:zz/county:example")).toBe("zz");
    expect(stateOfOcdId("ocd-division/country:us/state:zz")).toBe("zz");
    expect(stateOfOcdId("ocd-division/country:us")).toBeNull();
    expect(defaultGoverningBody("county", null, "ocd-division/country:us/state:va/county:example")).toBe("Board of Supervisors");
    expect(defaultGoverningBody("county", "us-va-example", "ocd-division/country:us/state:nc/county:example")).toBe("County Commission");
    expect(defaultGoverningBody("borough")).toBe("Borough Council");
  });
});

describe("the postal address a digest footer prints", () => {
  const env = { HUB_POSTAL_ADDRESS: "", CIVIC_PLATFORM_POSTAL_ADDRESS: "1 Platform Way" };

  it("is the hub's own, else the legacy env var, else the platform's, else none", () => {
    expect(postalAddressFrom({ "email.postal_address": "2 Hub Street" }, env)).toEqual({ value: "2 Hub Street", source: "hub" });
    expect(postalAddressFrom({}, { ...env, HUB_POSTAL_ADDRESS: "3 Legacy Road" })).toEqual({ value: "3 Legacy Road", source: "environment" });
    expect(postalAddressFrom({}, env)).toEqual({ value: "1 Platform Way", source: "platform" });
    expect(postalAddressFrom({ "email.postal_address": "  " }, env)).toEqual({ value: "1 Platform Way", source: "platform" });
    expect(postalAddressFrom(null, {})).toEqual({ value: "", source: null });
  });
});

describe("a redirect pointing at a hub", () => {
  const hub = { id: "example", hostname: "example.civic.test" };
  it("matches the slug, the hostname, or a URL on it", () => {
    for (const r of ["example", "example.civic.test", "https://example.civic.test", "https://example.civic.test/path", "EXAMPLE.civic.test:443"]) {
      expect(redirectPointsAt(r, hub), r).toBe(true);
    }
    for (const r of [null, "", "other.civic.test", "https://notexample.civic.test", "example-2"]) {
      expect(redirectPointsAt(r, hub), String(r)).toBe(false);
    }
  });
});

describe("the CSV reader", () => {
  it("reads quotes, commas, newlines and a BOM, and writes what it reads", () => {
    const text = '﻿a,b,c\n1,"x, y","say ""hi"""\r\n2,"line\nbreak",\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "line\nbreak", ""],
    ]);
    expect(parseCsvObjects(text)[0]).toEqual({ a: "1", b: "x, y", c: 'say "hi"' });
    const rows = parseCsv(text).slice(1);
    expect(parseCsv(toCsv(["a", "b", "c"], rows)).slice(1)).toEqual(rows);
  });

  it("reads a pipe-delimited file", () => {
    expect(parseCsv("a|b\n1|2\n", "|")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
