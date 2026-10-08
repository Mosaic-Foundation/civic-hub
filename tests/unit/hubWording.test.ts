import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  briefPillFor,
  defaultBetaBanner,
  defaultIntroBody,
  defaultTagline,
  defaultWelcomeStrip,
  fillSampleText,
  governmentPhrase,
  theName,
  welcomeStripTitle,
  type HubCopyContext,
} from "../../src/shared/hubCopy.js";
import { participantNoun, personLabel, type HubKind } from "../../src/shared/hubKind.js";
import { fitSlug, slugCandidates } from "../../src/shared/jurisdictionNames.js";
import { defaultGoverningBody } from "../../src/shared/jurisdictionType.js";
import { hubDocumentsWithNotes, splitDraftNotes } from "../../src/services/hubDocuments.js";
import { runWithHub } from "../../src/config/hubContext.js";
import { renderCodeEmail } from "../../src/modules/civic.auth/otp.js";
import { onboardingTarget, safeReturnPath } from "../../ui/src/config/pluginRules.js";
import { PLACE_NAME_PATTERNS, COUNTY_WORDING_PATTERNS, findPlaceNameHits } from "../../scripts/check-place-names.js";
import type { Hub } from "../../src/models/hub.js";

// Review 2026-10-06, session 3a (2026-10-07): every word an evaluator or a
// new admin reads fits the hub's kind and type of place, and nothing shows a
// placeholder or draft text. One case per kind and place type the review
// created on the console.

interface Case {
  label: string;
  kind: HubKind;
  type: string | null;
  name: string;
  jurisdiction: string | null;
}

const CASES: Case[] = [
  { label: "county", kind: "place", type: "county", name: "Example County Civic Hub", jurisdiction: "Example County, Zedland" },
  { label: "town", kind: "place", type: "town", name: "Town of Example Civic Hub", jurisdiction: "Town of Example, Zedland" },
  { label: "school district", kind: "place", type: "school_district", name: "Example School District Civic Hub", jurisdiction: "Example School District, Zedland" },
  { label: "organization", kind: "organization", type: null, name: "Example Tenants Association", jurisdiction: null },
  { label: "issue campaign", kind: "issue", type: null, name: "Fair Votes Now", jurisdiction: null },
];

const ctx = (c: Case): HubCopyContext => ({ kind: c.kind, jurisdictionType: c.type, hubName: c.name });

/** Words that belong to some other kind of hub than `c`. */
function foreignWording(c: Case): RegExp[] {
  const out: RegExp[] = [/\{[A-Z_]+\}/, /pilot program/i];
  if (c.type !== "county") out.push(/\bcounty\b/i);
  if (c.kind !== "place") out.push(/\bgovernment\b/i, /\bresidents?\b/i, /\bresidency\b/i);
  return out;
}

function hubRow(c: Case): Hub {
  return {
    id: "example",
    name: c.name,
    hostname: "example.civic.test",
    jurisdiction_code: null,
    jurisdiction_name: c.jurisdiction,
    space_did: "did:web:example.civic.test",
    protocol_hub_id: "civic-hub-example",
    space_type: "civic-hub",
    status: "active",
    mode: "demo",
    created_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:00:00Z",
  } as Hub;
}

describe.each(CASES)("a $label hub's own words", (c) => {
  it("welcome strip, tagline, intro and beta bar carry no placeholder or other kind's wording", () => {
    const texts = [
      welcomeStripTitle(ctx(c)),
      defaultWelcomeStrip(ctx(c)),
      defaultTagline(ctx(c)),
      defaultIntroBody(ctx(c)),
      defaultBetaBanner({ ...ctx(c), hasSamples: true }),
      defaultBetaBanner({ ...ctx(c), hasSamples: false }),
    ];
    for (const t of texts) for (const bad of foreignWording(c)) expect(t, t).not.toMatch(bad);
  });

  it("legal pages: every placeholder filled, no draft note in the public text", async () => {
    const settings: Record<string, string> = { "identity.hub_kind": c.kind };
    if (c.type) settings["identity.jurisdiction_type"] = c.type;
    const { documents, draft_notes } = await runWithHub(hubRow(c), settings, () => hubDocumentsWithNotes(hubRow(c)));
    for (const key of ["legal.terms", "legal.privacy", "legal.code_of_conduct", "copy.about"]) {
      const doc = documents[key];
      expect(doc, key).toBeTruthy();
      expect(doc, key).not.toMatch(/\{[A-Z_]+\}/);
      expect(doc, key).not.toMatch(/\{\{/);
      expect(doc, key).not.toMatch(/Draft starter content/);
      expect(doc, key).not.toMatch(/Consumer Data Protection Act|county employees|pilot program/);
      if (c.kind !== "place") expect(doc, key).not.toMatch(/\bresidents?\b/i);
    }
    // The note is still there for admins.
    expect(draft_notes["legal.terms"]?.[0]).toMatch(/^\*\*Draft starter content/);
    if (c.kind === "issue") expect(documents["copy.about"]).not.toMatch(/advocacy effort/);
  });

  it("names its people by kind", () => {
    const one = participantNoun(c.kind, 1);
    expect(one).toBe(c.kind === "place" ? "resident" : c.kind === "organization" ? "member" : "participant");
  });
});

describe("the hub's own noun (copy.resident_noun, wired 2026-10-07)", () => {
  it("overrides the kind's noun, with a regular plural", () => {
    expect(participantNoun("place", 3, "neighbor")).toBe("neighbors");
    expect(participantNoun("organization", 2, "family")).toBe("families");
    expect(participantNoun("issue", 1, "  Student ")).toBe("student");
    expect(personLabel("place", "neighbor")).toBe("Neighbor");
    expect(participantNoun("place", 2, "")).toBe("residents");
  });
});

describe("the place's article (review R19, R40)", () => {
  it("adds 'the' where English wants one", () => {
    expect(theName("Town of Example")).toBe("the Town of Example");
    expect(theName("Example Administrative School District 1")).toBe("the Example Administrative School District 1");
    expect(theName("Example County Civic Hub")).toBe("the Example County Civic Hub");
    expect(theName("Example Tenants Association")).toBe("the Example Tenants Association");
    expect(theName("Example County")).toBe("Example County");
    expect(theName("Exampleville")).toBe("Exampleville");
    expect(theName("We The People Exampleville")).toBe("We The People Exampleville");
    expect(theName("The Example Club")).toBe("The Example Club");
    expect(theName("Town of Example", true)).toBe("The Town of Example");
  });

  it("fills sample text with it, capitalised at a sentence start", () => {
    const names = { HUB_NAME: "H", JURISDICTION: "Town of Example", GOVERNING_BODY: "Selectboard" };
    expect(fillSampleText("Which step should {JURISDICTION} take first?", names)).toBe(
      "Which step should the Town of Example take first?",
    );
    expect(fillSampleText("{JURISDICTION} is updating its plan. {JURISDICTION} wants input.", names)).toBe(
      "The Town of Example is updating its plan. The Town of Example wants input.",
    );
    expect(fillSampleText("goes to the {GOVERNING_BODY}", names)).toBe("goes to the Selectboard");
    expect(fillSampleText("What do you value about {JURISDICTION}?", { ...names, JURISDICTION: "Example County" })).toBe(
      "What do you value about Example County?",
    );
  });

  it("the sign-in email does not put 'the' before every hub name", () => {
    const plain = renderCodeEmail("123456", "We The People Exampleville");
    expect(plain).toContain("Enter this code in We The People Exampleville to");
    expect(plain).toContain("— We The People Exampleville");
    const hub = renderCodeEmail("123456", "Example County Civic Hub");
    expect(hub).toContain("Enter this code in the Example County Civic Hub to");
    expect(hub).toContain("— The Example County Civic Hub");
  });
});

describe("the suggested web address (review R20)", () => {
  it("never cuts a word in half", () => {
    const [first] = slugCandidates("Bend-La Pine Administrative School District 1", "school_district", "zz");
    expect(first).toBe("bend-la-pine-school-district-1");
    expect(first.length).toBeLessThanOrEqual(32);
    for (const s of slugCandidates("Bend-La Pine Administrative School District 1", "school_district", "zz", 12)) {
      expect(s.length, s).toBeLessThanOrEqual(32);
      expect(s, s).not.toMatch(/-scho\b|-adm\b/);
    }
  });

  it("drops whole words from the end once filler is gone", () => {
    expect(fitSlug("alpha-bravo-charlie-delta-echo-foxtrot-golf")).toBe("alpha-bravo-charlie-delta-echo");
    expect(fitSlug("short-name")).toBe("short-name");
    expect(fitSlug("a".repeat(40))).toBe("a".repeat(32));
  });
});

describe("the governing body a town is offered (review R33)", () => {
  it("is a Selectboard in New England, a Town Council elsewhere", () => {
    expect(defaultGoverningBody("town", "us-vt-example")).toBe("Selectboard");
    expect(defaultGoverningBody("town", null, "ocd-division/country:us/state:ma/place:example")).toBe("Selectboard");
    expect(defaultGoverningBody("town", "us-nc-example")).toBe("Town Council");
  });
});

describe("governmentPhrase", () => {
  it("names the place's own kind of government", () => {
    expect(governmentPhrase("town")).toBe("town government");
    expect(governmentPhrase("county")).toBe("county government");
    expect(governmentPhrase("school_district")).toBe("the school district");
    expect(governmentPhrase(null)).toBe("local government");
  });
});

describe("a vote brief's label (Adam, 2026-10-07)", () => {
  it("is addressed to the board, or plain on a hub without one", () => {
    expect(briefPillFor("civic.vote", "Supervisors", "Vote brief")).toBe("Brief to the Supervisors");
    expect(briefPillFor("civic.vote", "", "Vote brief")).toBe("Brief");
    expect(briefPillFor("civic.proposal", "Council", "Proposal results")).toBe("Proposal results");
  });
});

describe("draft notes (review R15)", () => {
  it("come out of the document, the marked ones and a stored copy's bare blockquote", () => {
    const marked = splitDraftNotes("# T\n\n{{#draft}}> **Draft starter content** review.{{/draft}}\n\nBody");
    expect(marked.body).toBe("# T\n\nBody");
    expect(marked.notes).toEqual(["**Draft starter content** review."]);
    const legacy = splitDraftNotes("# T\n\n> **Draft starter content — review before launch.** x\n\nBody");
    expect(legacy.body).toBe("# T\n\nBody");
    expect(legacy.notes).toHaveLength(1);
  });
});

describe("sign-up keeps its place (review R24)", () => {
  it("carries the page that asked for sign-in through the onboarding word cloud", () => {
    expect(onboardingTarget("wc1", true, "/process/abc?x=1")).toBe(
      "/wordcloud/wc1?onboarding=1&return=%2Fprocess%2Fabc%3Fx%3D1",
    );
    expect(onboardingTarget("wc1", true, "/")).toBe("/wordcloud/wc1?onboarding=1");
    expect(onboardingTarget("wc1", false, "/process/abc")).toBeNull();
  });

  it("returns only to a page on this site", () => {
    expect(safeReturnPath("/process/abc")).toBe("/process/abc");
    expect(safeReturnPath("//evil.example/x")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});

describe("the place-name check, extended (review R53)", () => {
  const hit = (s: string) => [...PLACE_NAME_PATTERNS, ...COUNTY_WORDING_PATTERNS].some((p) => p.test(s));

  it("catches the first hub's state, region, body and county wording", () => {
    expect(hit("This is rural Virginia")).toBe(true);
    expect(hit("Blue Ridge Concrete")).toBe(true);
    expect(hit("passing on to the Supervisors")).toBe(true);
    expect(hit("A new space to follow county government")).toBe(true);
    expect(hit("I'd like the county to assess the drainage")).toBe(true);
    expect(hit("county employees")).toBe(true);
  });

  it("leaves the word county alone as a type of place", () => {
    expect(hit('{ id: "county", label: "County" }')).toBe(false);
    expect(hit("County Commission")).toBe(false);
  });

  it("scans config/legal, where a place would reach every hub's terms page", () => {
    const files = new Set(findPlaceNameHits().map((h) => h.file));
    // defaults.json's "Virginia" is the one allow-listed value there.
    expect(files.has("config/legal/defaults.json")).toBe(true);
    const legal = readFileSync(resolve(import.meta.dirname, "../../config/legal/privacy.md"), "utf-8");
    expect(legal).not.toMatch(/Consumer Data Protection Act/);
  });
});
