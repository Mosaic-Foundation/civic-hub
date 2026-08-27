import { describe, it, expect } from "vitest";
import {
  DEFAULT_OFFICIAL_TYPE,
  OFFICIAL_TYPES,
  OFFICIAL_TYPE_LABELS,
  authorBadges,
  inferOfficialType,
  normalizeOfficialType,
  officialPillKind,
  toOfficialIdentity,
  type OfficialType,
} from "../../src/shared/officialTypes.js";

describe("officialTypes — the enum", () => {
  it("labels every type (adding one to the union forces a label)", () => {
    for (const type of OFFICIAL_TYPES) {
      expect(OFFICIAL_TYPE_LABELS[type]).toBeTruthy();
    }
    expect(Object.keys(OFFICIAL_TYPE_LABELS).sort()).toEqual(
      [...OFFICIAL_TYPES].sort(),
    );
  });

  it("mirrors the DB CHECK constraint exactly", () => {
    // Drift here means a save the admin panel accepts and Postgres rejects.
    expect(OFFICIAL_TYPES).toEqual([
      "board_of_supervisors",
      "town_council",
      "planning_commission",
      "school_board",
      "other",
    ]);
  });
});

describe("normalizeOfficialType", () => {
  it("passes through every known type", () => {
    for (const type of OFFICIAL_TYPES) {
      expect(normalizeOfficialType(type)).toBe(type);
    }
  });

  it("returns null for absent values, not the default", () => {
    // A resident has no type at all — distinct from an unrecognized one.
    expect(normalizeOfficialType(null)).toBeNull();
    expect(normalizeOfficialType(undefined)).toBeNull();
    expect(normalizeOfficialType("")).toBeNull();
    expect(normalizeOfficialType("   ")).toBeNull();
    expect(normalizeOfficialType(42)).toBeNull();
  });

  it("degrades an unknown type to the default instead of dropping it", () => {
    // A DB ahead of this build (a type added by a newer deploy) must still
    // render a pill — losing the badge is worse than showing a plain one.
    expect(normalizeOfficialType("water_authority")).toBe(DEFAULT_OFFICIAL_TYPE);
  });
});

describe("officialPillKind", () => {
  it("kebab-cases the type for the CSS modifier", () => {
    expect(officialPillKind("board_of_supervisors")).toBe("board-of-supervisors");
    expect(officialPillKind("school_board")).toBe("school-board");
  });

  it("never emits an empty or unknown modifier", () => {
    expect(officialPillKind(null)).toBe("other");
    expect(officialPillKind("water_authority")).toBe("other");
  });
});

describe("inferOfficialType — legacy free-form labels", () => {
  it.each<[string, OfficialType]>([
    ["Board member", "board_of_supervisors"],
    ["BOARD OF SUPERVISORS", "board_of_supervisors"],
    ["Supervisor, District 3", "board_of_supervisors"],
    ["Town Council", "town_council"],
    ["Planning Committee", "planning_commission"],
    ["School Board", "school_board"],
    ["Guest speaker", "other"],
    ["", "other"],
  ])("%s → %s", (label, expected) => {
    expect(inferOfficialType(label)).toBe(expected);
  });

  it("maps the CIVIC_BOARD_EMAILS default label to the board", () => {
    // hubSettings labels every env-var entry "Board member"; that must not
    // land in "other" or the seeded roster is wrong from day one.
    expect(inferOfficialType("Board member")).toBe("board_of_supervisors");
  });
});

describe("toOfficialIdentity — the both-or-neither rule", () => {
  it("builds an identity from a type and a title", () => {
    expect(toOfficialIdentity("town_council", "Town Council")).toEqual({
      type: "town_council",
      title: "Town Council",
    });
  });

  it("is null without a title — the title is the half that renders", () => {
    expect(toOfficialIdentity("town_council", null)).toBeNull();
    expect(toOfficialIdentity("town_council", "   ")).toBeNull();
  });

  it("keeps the title and defaults the type when the type is missing", () => {
    expect(toOfficialIdentity(null, "Board of Supervisors")).toEqual({
      type: "other",
      title: "Board of Supervisors",
    });
  });

  it("trims the title", () => {
    expect(toOfficialIdentity("school_board", "  School Board  ")?.title).toBe(
      "School Board",
    );
  });
});

describe("authorBadges — what renders next to a name", () => {
  it("gives a plain resident no badges", () => {
    expect(authorBadges({})).toEqual([]);
    expect(
      authorBadges({ isAdmin: false, officialType: null, officialTitle: null }),
    ).toEqual([]);
  });

  it("gives a plain admin only the Admin badge", () => {
    const badges = authorBadges({ isAdmin: true });
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe("admin");
    expect(badges[0].text).toBe("Admin");
    expect(badges[0].className).toBe("creator-admin-badge");
  });

  it("gives an official the title, not the type", () => {
    const badges = authorBadges({
      officialType: "board_of_supervisors",
      officialTitle: "Supervisor, District 3",
    });
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe("official");
    expect(badges[0].text).toBe("Supervisor, District 3");
    expect(badges[0].className).toContain("creator-official-badge");
    expect(badges[0].className).toContain(
      "creator-official-badge--board-of-supervisors",
    );
  });

  it("gives an admin who is ALSO an official BOTH badges, office first", () => {
    // The regression this whole change exists to fix: the old
    // resolveAuthorship short-circuited on admin and the office vanished.
    const badges = authorBadges({
      isAdmin: true,
      officialType: "board_of_supervisors",
      officialTitle: "Board of Supervisors",
    });
    expect(badges.map((b) => b.kind)).toEqual(["official", "admin"]);
    expect(badges.map((b) => b.text)).toEqual([
      "Board of Supervisors",
      "Admin",
    ]);
  });

  it("never merges the two into one badge", () => {
    const badges = authorBadges({
      isAdmin: true,
      officialType: "town_council",
      officialTitle: "Town Council",
    });
    expect(badges).toHaveLength(2);
    expect(badges[0].className).not.toContain("creator-admin-badge");
    expect(badges[1].className).not.toContain("creator-official-badge");
  });

  it("drops the office badge when there is a type but no title", () => {
    const badges = authorBadges({
      isAdmin: true,
      officialType: "school_board",
      officialTitle: "",
    });
    expect(badges.map((b) => b.kind)).toEqual(["admin"]);
  });

  it("emits a stable key per badge kind (no duplicate React keys)", () => {
    const badges = authorBadges({
      isAdmin: true,
      officialType: "other",
      officialTitle: "Guest",
    });
    expect(new Set(badges.map((b) => b.kind)).size).toBe(badges.length);
  });
});
