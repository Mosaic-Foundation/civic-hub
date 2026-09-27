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
import { hubKindOf, isHubKind, participantNoun } from "../../src/shared/hubKind.js";
import { kindsWithSamples, templatesFor } from "../../src/services/sampleTemplates.js";
import { applySubstitutions, resolveKindSections } from "../../src/services/hubDocuments.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

  it("derives the jurisdiction code from the OCD id: a county keeps us-<state>-<name>, anything smaller adds its type", () => {
    const code = (ocd_id: string, type: Parameters<typeof jurisdictionCodeFor>[0]["type"]) => jurisdictionCodeFor({ ocd_id, type });
    // The two Adam named: the county keeps the code Floyd has always published.
    expect(code("ocd-division/country:us/state:va/county:floyd", "county")).toBe("us-va-floyd");
    expect(code("ocd-division/country:us/state:va/place:floyd", "town")).toBe("us-va-floyd-town");
    expect(code("ocd-division/country:us/state:la/parish:orleans", "county")).toBe("us-la-orleans");
    expect(code("ocd-division/country:us/state:ak/borough:juneau", "borough")).toBe("us-ak-juneau-borough");
    // A school district carries the county it sits under (names recur across counties).
    expect(code("ocd-division/country:us/state:va/county:floyd/school_district:floyd_co_pblc_schs", "school_district")).toBe(
      "us-va-floyd-floyd-co-pblc-schs-schools",
    );
    expect(code("ocd-division/country:us/state:va", "state")).toBe("us-va");
    expect(code("ocd-division/country:us/district:dc", "state")).toBe("us-dc");
    expect(code("ocd-division/country:us", "state")).toBeNull();
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

describe("hub kinds", () => {
  it("reads unset or unknown as a place hub", () => {
    expect(hubKindOf(undefined)).toBe("place");
    expect(hubKindOf("club")).toBe("place");
    expect(hubKindOf("issue")).toBe("issue");
    expect(isHubKind("organization")).toBe(true);
  });

  it("calls people residents only in a place hub", () => {
    expect(participantNoun("place", 1)).toBe("resident");
    expect(participantNoun("place", 2)).toBe("residents");
    expect(participantNoun("issue", 3)).toBe("participants");
    expect(participantNoun("organization", 1)).toBe("participant");
  });

  it("has sample templates for place hubs only, today", () => {
    expect(kindsWithSamples()).toEqual(["place"]);
    expect(templatesFor("county", "place").length).toBeGreaterThan(0);
    for (const k of ["issue", "organization", "other"] as const) expect(templatesFor(null, k)).toEqual([]);
  });
});

describe("the shared documents, by hub kind", () => {
  const dir = join(__dirname, "../../config/legal");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  it("keep {{#place}} sections for a place hub and {{^place}} ones for any other", () => {
    const t = "A{{#place}} in {PLACE}{{/place}}{{^place}} anywhere{{/place}}.";
    expect(resolveKindSections(t, "place")).toBe("A in {PLACE}.");
    expect(resolveKindSections(t, undefined)).toBe("A in {PLACE}.");
    expect(resolveKindSections(t, "issue")).toBe("A anywhere.");
    expect(resolveKindSections("x\n{{#place}}- a line\n{{/place}}y", "organization")).toBe("x\ny");
  });

  it("name no place, state or government body for a hub that is not a place", () => {
    for (const f of files) {
      const out = applySubstitutions(readFileSync(join(dir, f), "utf8"), { HUB_KIND: "organization", HUB_NAME: "Example Club" });
      expect(out, f).not.toMatch(/\{(PLACE|STATE|JURISDICTION|GOVERNING_BODY)\}/);
      expect(out, f).not.toMatch(/\{\{[#^/]?place\}\}/);
      expect(out, f).not.toMatch(/resident of|residents of|local government/);
    }
  });

  it("read exactly as before for a place hub", () => {
    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf8");
      const out = resolveKindSections(raw, "place");
      expect(out, f).not.toMatch(/\{\{[#^/]?place\}\}/);
      // Every place sentence survives: the section markers are the only change.
      const markersOnly = raw.replace(/\{\{\^place\}\}[\s\S]*?\{\{\/place\}\}/g, "").replace(/\{\{#place\}\}|\{\{\/place\}\}/g, "");
      expect(out, f).toBe(markersOnly);
    }
  });
});
