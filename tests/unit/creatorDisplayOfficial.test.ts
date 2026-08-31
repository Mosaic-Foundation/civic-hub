import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  rowToDisplay,
  redactForAudience,
  type CreatorDisplay,
} from "../../src/services/creatorDisplay.js";

// rowToDisplay is the whole users-row → byline mapping with no DB in the
// way. Everything the feed, proposals, projects, and comments show next to
// a name comes out of this one function.

const ORIGINAL_ADMINS = process.env.CIVIC_ADMIN_EMAILS;

beforeEach(() => {
  process.env.CIVIC_ADMIN_EMAILS = "boss@floyd.gov";
});

afterEach(() => {
  if (ORIGINAL_ADMINS === undefined) delete process.env.CIVIC_ADMIN_EMAILS;
  else process.env.CIVIC_ADMIN_EMAILS = ORIGINAL_ADMINS;
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    full_name: "Dana Reed",
    display_name: null,
    email: "dana@example.com",
    official_type: null,
    official_title: null,
    ...over,
  } as Parameters<typeof rowToDisplay>[0];
}

describe("rowToDisplay — name resolution is unchanged", () => {
  it("prefers full_name, then display_name, then Resident", () => {
    expect(rowToDisplay(row()).name).toBe("Dana Reed");
    expect(
      rowToDisplay(row({ full_name: null, display_name: "D. Reed" })).name,
    ).toBe("D. Reed");
    expect(
      rowToDisplay(row({ full_name: null, display_name: null })).name,
    ).toBe("Resident");
  });

  it("never falls back to the email", () => {
    const display = rowToDisplay(row({ full_name: null, display_name: null }));
    expect(display.name).not.toContain("@");
    expect(display.name).toBe("Resident");
  });
});

describe("rowToDisplay — official is orthogonal to admin", () => {
  it("a resident is neither", () => {
    const d = rowToDisplay(row());
    expect(d.is_admin).toBe(false);
    expect(d.official).toBeNull();
  });

  it("an admin with no office has no title", () => {
    const d = rowToDisplay(row({ email: "boss@floyd.gov" }));
    expect(d.is_admin).toBe(true);
    expect(d.official).toBeNull();
  });

  it("an official who is not an admin has a title only", () => {
    const d = rowToDisplay(
      row({
        official_type: "board_of_supervisors",
        official_title: "Board of Supervisors",
      }),
    );
    expect(d.is_admin).toBe(false);
    expect(d.official).toEqual({
      type: "board_of_supervisors",
      title: "Board of Supervisors",
    });
  });

  it("an admin who is ALSO an official carries both", () => {
    const d = rowToDisplay(
      row({
        email: "boss@floyd.gov",
        official_type: "board_of_supervisors",
        official_title: "Supervisor, District 3",
      }),
    );
    expect(d.is_admin).toBe(true);
    expect(d.official?.title).toBe("Supervisor, District 3");
  });

  it("matches the admin list case-insensitively", () => {
    expect(rowToDisplay(row({ email: "BOSS@Floyd.GOV" })).is_admin).toBe(true);
  });
});

describe("rowToDisplay — schema drift", () => {
  it("resolves to no office when the migration has not been applied", () => {
    // The surrounding query is select("*") precisely so an un-migrated DB
    // returns rows without these columns. That must degrade to "no title",
    // never throw — a byline failure would take the content down with it.
    const legacy = {
      id: "user_1",
      full_name: "Dana Reed",
      display_name: null,
      email: "dana@example.com",
    } as Parameters<typeof rowToDisplay>[0];
    expect(() => rowToDisplay(legacy)).not.toThrow();
    expect(rowToDisplay(legacy).official).toBeNull();
    expect(rowToDisplay(legacy).name).toBe("Dana Reed");
  });

  it("ignores a half-written office (title without type, type without title)", () => {
    expect(
      rowToDisplay(row({ official_type: "school_board", official_title: null }))
        .official,
    ).toBeNull();
    // A title with no type still renders — the title is the load-bearing
    // half — and takes the default colour.
    expect(
      rowToDisplay(row({ official_type: null, official_title: "School Board" }))
        .official,
    ).toEqual({ type: "other", title: "School Board" });
  });
});

// --- Public anonymity (2026-08-31) ------------------------------------------
// redactForAudience is the single decision point between what a signed-in
// member sees (today's behavior, untouched) and what the anonymous public
// sees (no resident names, no admin flag, per-process "Resident N").

const RESIDENT: CreatorDisplay = {
  name: "Dana Reed",
  is_admin: false,
  official: null,
};
const ADMIN: CreatorDisplay = {
  name: "Adam Operator",
  is_admin: true,
  official: null,
};
const OFFICIAL: CreatorDisplay = {
  name: "Jane Doe",
  is_admin: false,
  official: { type: "board_of_supervisors", title: "Board of Supervisors" },
};
const ADMIN_OFFICIAL: CreatorDisplay = {
  name: "Pat Both",
  is_admin: true,
  official: { type: "board_of_supervisors", title: "Board of Supervisors" },
};

describe("redactForAudience — member sees today's bylines, unchanged", () => {
  it("passes every shape through verbatim", () => {
    for (const creator of [RESIDENT, ADMIN, OFFICIAL, ADMIN_OFFICIAL]) {
      expect(
        redactForAudience(creator, "user_1", { audience: "member" }),
      ).toEqual(creator);
    }
  });
});

describe("redactForAudience — public never sees a resident's name", () => {
  it("a resident becomes plain Resident (list surfaces: no number)", () => {
    expect(redactForAudience(RESIDENT, "user_1", { audience: "public" })).toEqual({
      name: "Resident",
      is_admin: false,
      official: null,
    });
  });

  it("an admin shows as the Admin ROLE — real name withheld, no pill", () => {
    // Adam, 2026-08-31: admin-authored content (announcements, meeting
    // summaries, word clouds, comments) is institutional speech — the
    // public sees "Admin", never "Resident" and never the personal name.
    const shown = redactForAudience(ADMIN, "user_2", { audience: "public" });
    expect(shown.name).toBe("Admin");
    expect(shown.is_admin).toBe(false); // the name IS the label; no pill
    expect(shown.official).toBeNull();
  });

  it("an official keeps name + office; the Admin pill still never shows", () => {
    expect(redactForAudience(OFFICIAL, "user_3", { audience: "public" })).toEqual(
      { ...OFFICIAL, is_admin: false },
    );
    const both = redactForAudience(ADMIN_OFFICIAL, "user_4", {
      audience: "public",
    });
    expect(both.name).toBe("Pat Both"); // office outranks the admin label
    expect(both.official?.title).toBe("Board of Supervisors");
    expect(both.is_admin).toBe(false);
  });

  it("an unknown / missing id resolves to plain Resident", () => {
    const shown = redactForAudience(
      { name: "Resident", is_admin: false, official: null },
      undefined,
      { audience: "public", anonNumbers: new Map([["user_1", 1]]) },
    );
    expect(shown.name).toBe("Resident");
  });
});

describe("redactForAudience — per-process numbering", () => {
  it("uses the process map on detail surfaces", () => {
    const anonNumbers = new Map([
      ["user_1", 1],
      ["user_2", 3],
    ]);
    expect(
      redactForAudience(RESIDENT, "user_2", { audience: "public", anonNumbers })
        .name,
    ).toBe("Resident 3");
  });

  it("an id absent from the map falls back to plain Resident", () => {
    expect(
      redactForAudience(RESIDENT, "user_9", {
        audience: "public",
        anonNumbers: new Map([["user_1", 1]]),
      }).name,
    ).toBe("Resident");
  });

  it("the same person can carry different numbers in different processes", () => {
    const processA = new Map([["user_1", 3]]);
    const processB = new Map([["user_1", 1]]);
    expect(
      redactForAudience(RESIDENT, "user_1", {
        audience: "public",
        anonNumbers: processA,
      }).name,
    ).toBe("Resident 3");
    expect(
      redactForAudience(RESIDENT, "user_1", {
        audience: "public",
        anonNumbers: processB,
      }).name,
    ).toBe("Resident 1");
  });
});

describe("redactForAudience — the Admin label is consistent everywhere", () => {
  it("an admin never gets a Resident number, even with a map present", () => {
    const shown = redactForAudience(ADMIN, "user_2", {
      audience: "public",
      anonNumbers: new Map([["user_2", 4]]),
    });
    expect(shown.name).toBe("Admin");
  });

  it("members still see the admin's real name + Admin pill", () => {
    expect(
      redactForAudience(ADMIN, "user_2", { audience: "member" }),
    ).toEqual(ADMIN);
  });
});
