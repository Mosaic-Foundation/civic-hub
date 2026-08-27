import { describe, it, expect } from "vitest";
import { normalizeOfficialRecords } from "../../src/services/officials.js";

// The validation the admin PATCH relies on. Anything this lets through is
// written straight to users.official_type / official_title, so it has to
// agree with the DB's CHECK constraints rather than fight them.

describe("normalizeOfficialRecords", () => {
  it("keeps a complete row and lowercases the email", () => {
    expect(
      normalizeOfficialRecords([
        {
          email: "  Sup@Floyd.GOV ",
          name: " Dana Reed ",
          official_type: "board_of_supervisors",
          official_title: " Board of Supervisors ",
        },
      ]),
    ).toEqual([
      {
        email: "sup@floyd.gov",
        name: "Dana Reed",
        official_type: "board_of_supervisors",
        official_title: "Board of Supervisors",
      },
    ]);
  });

  it("treats a blank name as absent", () => {
    const [row] = normalizeOfficialRecords([
      { email: "a@b.co", name: "   ", official_type: "other", official_title: "Guest" },
    ]);
    expect(row.name).toBeNull();
  });

  it("drops a row with no title (the DB's both-or-neither rule)", () => {
    expect(
      normalizeOfficialRecords([
        { email: "a@b.co", official_type: "school_board", official_title: "" },
      ]),
    ).toEqual([]);
  });

  it("drops a row with no email — there is no account to attach it to", () => {
    expect(
      normalizeOfficialRecords([
        { email: "  ", official_type: "other", official_title: "Guest" },
      ]),
    ).toEqual([]);
  });

  it("narrows an unrecognized type instead of rejecting the save", () => {
    // An operator typo must not cost them the whole roster edit.
    const [row] = normalizeOfficialRecords([
      { email: "a@b.co", official_type: "wat", official_title: "Water Authority" },
    ]);
    expect(row.official_type).toBe("other");
    expect(row.official_title).toBe("Water Authority");
  });

  it("defaults a missing type but keeps the title", () => {
    const [row] = normalizeOfficialRecords([
      { email: "a@b.co", official_title: "Town Council" },
    ]);
    expect(row.official_type).toBe("other");
  });

  it("dedupes by email, first entry winning, preserving order", () => {
    expect(
      normalizeOfficialRecords([
        { email: "a@b.co", official_type: "town_council", official_title: "Council" },
        { email: "c@d.co", official_type: "other", official_title: "Guest" },
        { email: "A@B.CO", official_type: "school_board", official_title: "Board" },
      ]).map((r) => [r.email, r.official_title]),
    ).toEqual([
      ["a@b.co", "Council"],
      ["c@d.co", "Guest"],
    ]);
  });

  it("ignores junk entries without throwing", () => {
    expect(
      normalizeOfficialRecords([null, undefined, "nope", 7, [], {}]),
    ).toEqual([]);
  });

  it("an empty list is a valid roster — it means demote everyone", () => {
    expect(normalizeOfficialRecords([])).toEqual([]);
  });
});
