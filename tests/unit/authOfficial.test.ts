import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// resolveAuthorship decides two independent things — "can this person post
// an announcement" and "what shows next to their name". Its predecessor
// short-circuited on admin, so a hub admin who also sat on the Board could
// never show their office. These tests pin the split open.

const mocks = vi.hoisted(() => ({
  lookupOfficialByEmail: vi.fn(),
  lookupAuthor: vi.fn(),
  areOfficialsMigrated: vi.fn(),
}));

vi.mock("../../src/services/officials.js", () => ({
  lookupOfficialByEmail: mocks.lookupOfficialByEmail,
}));

vi.mock("../../src/services/hubSettings.js", () => ({
  lookupAuthor: mocks.lookupAuthor,
  areOfficialsMigrated: mocks.areOfficialsMigrated,
}));

const { resolveAuthorship, resolveOfficial, isAdminEmail } = await import(
  "../../src/middleware/auth.js"
);

const ORIGINAL_ADMINS = process.env.CIVIC_ADMIN_EMAILS;

beforeEach(() => {
  process.env.CIVIC_ADMIN_EMAILS = "boss@floyd.gov";
  mocks.lookupOfficialByEmail.mockResolvedValue(null);
  mocks.lookupAuthor.mockResolvedValue(null);
  mocks.areOfficialsMigrated.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_ADMINS === undefined) delete process.env.CIVIC_ADMIN_EMAILS;
  else process.env.CIVIC_ADMIN_EMAILS = ORIGINAL_ADMINS;
});

const BOARD = { type: "board_of_supervisors" as const, title: "Board of Supervisors" };

describe("resolveAuthorship — the admin × official matrix", () => {
  it("a resident has no posting privilege", async () => {
    expect(await resolveAuthorship("nobody@example.com")).toBeNull();
  });

  it("no email is not an author", async () => {
    expect(await resolveAuthorship(null)).toBeNull();
    expect(await resolveAuthorship(undefined)).toBeNull();
    expect(await resolveAuthorship("")).toBeNull();
  });

  it("a plain admin posts as Admin with no office", async () => {
    const a = await resolveAuthorship("boss@floyd.gov");
    expect(a).not.toBeNull();
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toBeNull();
    expect(a!.role).toBe("admin");
    expect(a!.label).toBe("Admin");
  });

  it("an official who is not an admin posts under their office", async () => {
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    const a = await resolveAuthorship("sup@floyd.gov");
    expect(a!.isAdmin).toBe(false);
    expect(a!.official).toEqual(BOARD);
    expect(a!.role).toBe("author");
    expect(a!.label).toBe("Board of Supervisors");
  });

  it("designating someone an official grants announcement posting", async () => {
    // Identity and the posting capability are deliberately fused for now.
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    expect(await resolveAuthorship("sup@floyd.gov")).not.toBeNull();
  });

  it("an admin who is ALSO an official keeps BOTH halves", async () => {
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    const a = await resolveAuthorship("boss@floyd.gov");
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toEqual(BOARD);
  });

  it("the office wins the single-valued announcement label", async () => {
    // author_role drives the feed pill and the page eyebrow, which hold
    // exactly one string. A supervisor's post reads as the Board's.
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    const a = await resolveAuthorship("boss@floyd.gov");
    expect(a!.label).toBe("Board of Supervisors");
    expect(a!.label).not.toBe("Admin");
  });

  it("an admin+official still edits as an admin, not as an author", async () => {
    // role gates the announcement edit-ownership check: "admin" may edit
    // anyone's post. Losing that on someone who gained an office would
    // quietly demote them.
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    expect((await resolveAuthorship("boss@floyd.gov"))!.role).toBe("admin");
  });

  it("matches the admin allowlist case-insensitively", async () => {
    expect(isAdminEmail("BOSS@FLOYD.GOV")).toBe(true);
    expect((await resolveAuthorship("BOSS@FLOYD.GOV"))!.isAdmin).toBe(true);
  });
});

describe("resolveOfficial — the fallback chain", () => {
  it("prefers the managed role on the user row", async () => {
    mocks.lookupOfficialByEmail.mockResolvedValue(BOARD);
    mocks.lookupAuthor.mockResolvedValue({ email: "x", label: "Stale Label" });
    expect(await resolveOfficial("sup@floyd.gov")).toEqual(BOARD);
    // The legacy list is not even consulted once the row answers.
    expect(mocks.lookupAuthor).not.toHaveBeenCalled();
  });

  it("falls back to the legacy list before migration, inferring the type", async () => {
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    mocks.lookupAuthor.mockResolvedValue({
      email: "sup@floyd.gov",
      label: "Board member",
    });
    expect(await resolveOfficial("sup@floyd.gov")).toEqual({
      type: "board_of_supervisors",
      title: "Board member",
    });
  });

  it("keeps a free-form legacy label verbatim as the title", async () => {
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    mocks.lookupAuthor.mockResolvedValue({
      email: "c@floyd.gov",
      label: "Planning Committee",
    });
    expect(await resolveOfficial("c@floyd.gov")).toEqual({
      type: "planning_commission",
      title: "Planning Committee",
    });
  });

  it("STOPS consulting the legacy list once migrated, so demotion sticks", async () => {
    // Without the latch, removing someone in the admin panel would be
    // undone on the next request by the stale list still naming them.
    mocks.areOfficialsMigrated.mockResolvedValue(true);
    mocks.lookupAuthor.mockResolvedValue({
      email: "gone@floyd.gov",
      label: "Board member",
    });
    expect(await resolveOfficial("gone@floyd.gov")).toBeNull();
    expect(mocks.lookupAuthor).not.toHaveBeenCalled();
  });

  it("a demoted admin+official drops to plain Admin, not to nothing", async () => {
    mocks.lookupOfficialByEmail.mockResolvedValue(null);
    const a = await resolveAuthorship("boss@floyd.gov");
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toBeNull();
    expect(a!.label).toBe("Admin");
  });
});
