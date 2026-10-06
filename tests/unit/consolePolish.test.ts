// Console and sample-content polish (2026-10-06): the governing body's short
// form and a new place hub's default name. Pure; no database.

import { describe, expect, it } from "vitest";
import { defaultGoverningBody, defaultGoverningBodyShort, JURISDICTION_TYPES } from "../../src/shared/jurisdictionType.js";
import { defaultHubName } from "../../src/shared/jurisdictionNames.js";
import { affiliationClause, personLabel } from "../../src/shared/hubKind.js";
import { fieldSpec } from "../../src/shared/hubSettingsSections.js";
import { validateSettingsWrite } from "../../src/models/hubSettingsWrite.js";

describe("the governing body's short form", () => {
  it("is the distinctive word of each usual name", () => {
    expect(defaultGoverningBodyShort("Board of Supervisors")).toBe("Supervisors");
    expect(defaultGoverningBodyShort("City Council")).toBe("Council");
    expect(defaultGoverningBodyShort("Town Council")).toBe("Council");
    expect(defaultGoverningBodyShort("Borough Council")).toBe("Council");
    expect(defaultGoverningBodyShort("County Commission")).toBe("Commission");
    expect(defaultGoverningBodyShort("Village Board")).toBe("Board");
    expect(defaultGoverningBodyShort("School Board")).toBe("School Board");
  });

  it("has one for every type that has a usual governing body", () => {
    for (const { id } of JURISDICTION_TYPES) {
      const body = defaultGoverningBody(id, "us-va-x");
      expect(Boolean(defaultGoverningBodyShort(body))).toBe(Boolean(body));
    }
  });

  it("keeps an unusual name readable", () => {
    expect(defaultGoverningBodyShort("Board of County Commissioners")).toBe("County Commissioners");
    expect(defaultGoverningBodyShort("Select Board")).toBe("Board");
    expect(defaultGoverningBodyShort("Selectboard")).toBe("Selectboard");
    expect(defaultGoverningBodyShort("Tribal Council of the Example Nation")).toBe("Council");
    expect(defaultGoverningBodyShort("Town Board of Trustees")).toBe("Trustees");
    expect(defaultGoverningBodyShort("Board of Education")).toBe("Board");
    expect(defaultGoverningBodyShort("  City   Council ")).toBe("Council");
  });

  it("is empty when there is no governing body", () => {
    expect(defaultGoverningBodyShort("")).toBe("");
    expect(defaultGoverningBodyShort(null)).toBe("");
    expect(defaultGoverningBodyShort(undefined)).toBe("");
  });
});

describe("a new place hub's default name", () => {
  it("is the place without its state, then Civic Hub", () => {
    expect(defaultHubName("Floyd County, Virginia")).toBe("Floyd County Civic Hub");
    expect(defaultHubName("Town of Floyd, Virginia")).toBe("Town of Floyd Civic Hub");
    expect(defaultHubName("City of Asheville, North Carolina")).toBe("City of Asheville Civic Hub");
  });

  it("keeps a typed name with no state whole", () => {
    expect(defaultHubName("The Northside neighbourhood")).toBe("The Northside neighbourhood Civic Hub");
    expect(defaultHubName("  ")).toBe("");
  });
});

describe("affiliation by hub kind", () => {
  const names = { place: "Example County", hub: "Example Civic Hub" };
  it("asks residence of a place hub and membership of an organization", () => {
    expect(affiliationClause("place", names)).toBe("I confirm that I am a resident of Example County");
    expect(affiliationClause("organization", names)).toBe("I confirm that I am a member of Example Civic Hub");
  });
  it("asks nothing of an issue campaign or another kind", () => {
    expect(affiliationClause("issue", names)).toBeNull();
    expect(affiliationClause("other", names)).toBeNull();
  });
  it("names an unnamed person by the kind", () => {
    expect(personLabel("place")).toBe("Resident");
    expect(personLabel("organization")).toBe("Member");
    expect(personLabel("issue")).toBe("Participant");
    expect(personLabel("other")).toBe("Participant");
  });
});

describe("a process setting", () => {
  it("is a word cloud, by id, or empty", () => {
    expect(fieldSpec("plugin.wordcloud.onboarding_id")).toEqual({
      key: "plugin.wordcloud.onboarding_id",
      kind: "process",
      processType: "civic.wordcloud",
    });
    const ok = validateSettingsWrite("plugins", { "plugin.wordcloud.onboarding_id": " proc_abc-1 " });
    expect(ok.ok && ok.entries).toEqual([{ key: "plugin.wordcloud.onboarding_id", value: "proc_abc-1" }]);
    expect(validateSettingsWrite("plugins", { "plugin.wordcloud.onboarding_id": "" }).ok).toBe(true);
    expect(validateSettingsWrite("plugins", { "plugin.wordcloud.onboarding_id": "not an id!" }).ok).toBe(false);
  });
});
