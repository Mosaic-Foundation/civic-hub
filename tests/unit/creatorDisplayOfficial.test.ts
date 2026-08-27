import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rowToDisplay } from "../../src/services/creatorDisplay.js";

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
