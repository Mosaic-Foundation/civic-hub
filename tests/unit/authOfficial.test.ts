import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// authorshipOf decides two independent things — "can this person post an
// announcement" and "what shows next to their name". Its predecessor
// short-circuited on admin, so a hub admin who also sat on the Board could
// never show their office. These tests pin the split open. Since
// Architecture 4 (ADR-011) both halves are asked of the ACTOR: the admin role
// is a grant on the account (hub_roles), the legacy author list is an
// announcement_author grant, and the managed office is looked up by account.

const mocks = vi.hoisted(() => ({
  lookupOfficialBySubject: vi.fn(),
  areOfficialsMigrated: vi.fn(),
}));

vi.mock("../../src/services/officials.js", () => ({
  lookupOfficialBySubject: mocks.lookupOfficialBySubject,
}));

vi.mock("../../src/services/hubSettings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/hubSettings.js")>();
  return { ...actual, areOfficialsMigrated: mocks.areOfficialsMigrated };
});

const { authorshipOf, officialOf } = await import("../../src/authz/canActor.js");
const { SIGNED_OUT } = await import("../../src/authz/actor.js");
type AccountActor = import("../../src/authz/actor.js").AccountActor;
type HubRole = import("../../src/authz/actor.js").HubRole;

function account(roles: Partial<Record<HubRole, { label?: string; name?: string }>> = {}): AccountActor {
  return {
    kind: "account",
    subject: "user_x",
    assurance: "code",
    roles: new Map(Object.entries(roles) as Array<[HubRole, { label?: string; name?: string }]>),
    resident: true,
    named: true,
  };
}

const ADMIN = () => account({ admin: {} });

beforeEach(() => {
  mocks.lookupOfficialBySubject.mockResolvedValue(null);
  mocks.areOfficialsMigrated.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

const BOARD = { type: "board_of_supervisors" as const, title: "Board of Supervisors" };

describe("authorshipOf — the admin × official matrix", () => {
  it("a resident has no posting privilege", async () => {
    expect(await authorshipOf(account())).toBeNull();
  });

  it("nobody signed in is not an author", async () => {
    expect(await authorshipOf(SIGNED_OUT)).toBeNull();
  });

  it("a plain admin posts as Admin with no office", async () => {
    const a = await authorshipOf(ADMIN());
    expect(a).not.toBeNull();
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toBeNull();
    expect(a!.role).toBe("admin");
    expect(a!.label).toBe("Admin");
  });

  it("an official who is not an admin posts under their office", async () => {
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    const a = await authorshipOf(account());
    expect(a!.isAdmin).toBe(false);
    expect(a!.official).toEqual(BOARD);
    expect(a!.role).toBe("author");
    expect(a!.label).toBe("Board of Supervisors");
  });

  it("designating someone an official grants announcement posting", async () => {
    // Identity and the posting capability are deliberately fused for now.
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    expect(await authorshipOf(account())).not.toBeNull();
  });

  it("an admin who is ALSO an official keeps BOTH halves", async () => {
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    const a = await authorshipOf(ADMIN());
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toEqual(BOARD);
  });

  it("the office wins the single-valued announcement label", async () => {
    // author_role drives the feed pill and the page eyebrow, which hold
    // exactly one string. A supervisor's post reads as the Board's.
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    const a = await authorshipOf(ADMIN());
    expect(a!.label).toBe("Board of Supervisors");
    expect(a!.label).not.toBe("Admin");
  });

  it("an admin+official still edits as an admin, not as an author", async () => {
    // role gates the announcement edit-ownership check: "admin" may edit
    // anyone's post. Losing that on someone who gained an office would
    // quietly demote them.
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    expect((await authorshipOf(ADMIN()))!.role).toBe("admin");
  });

  it("asks for the office by account, never by address", async () => {
    await authorshipOf(account());
    expect(mocks.lookupOfficialBySubject).toHaveBeenCalledWith("user_x");
  });
});

describe("officialOf — the fallback chain", () => {
  it("prefers the managed role on the account", async () => {
    mocks.lookupOfficialBySubject.mockResolvedValue(BOARD);
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    expect(await officialOf(account({ announcement_author: { label: "Stale Label" } }))).toEqual(BOARD);
  });

  it("falls back to the legacy list's grant before migration, inferring the type", async () => {
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    expect(await officialOf(account({ announcement_author: { label: "Board member" } }))).toEqual({
      type: "board_of_supervisors",
      title: "Board member",
    });
  });

  it("keeps a free-form legacy label verbatim as the title", async () => {
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    expect(await officialOf(account({ announcement_author: { label: "Planning Committee" } }))).toEqual({
      type: "planning_commission",
      title: "Planning Committee",
    });
  });

  it("STOPS consulting the legacy list once migrated, so demotion sticks", async () => {
    // Without the latch, removing someone in the admin panel would be
    // undone on the next request by the stale list still naming them.
    mocks.areOfficialsMigrated.mockResolvedValue(true);
    expect(await officialOf(account({ announcement_author: { label: "Board member" } }))).toBeNull();
  });

  it("a legacy author's curated name rides along, but not for an admin", async () => {
    mocks.areOfficialsMigrated.mockResolvedValue(false);
    const author = await authorshipOf(account({ announcement_author: { label: "Clerk", name: "Pat" } }));
    expect(author!.name).toBe("Pat");
    const both = await authorshipOf(account({ admin: {}, announcement_author: { label: "Clerk", name: "Pat" } }));
    expect(both!.name).toBeNull();
  });

  it("a demoted admin+official drops to plain Admin, not to nothing", async () => {
    mocks.lookupOfficialBySubject.mockResolvedValue(null);
    const a = await authorshipOf(ADMIN());
    expect(a!.isAdmin).toBe(true);
    expect(a!.official).toBeNull();
    expect(a!.label).toBe("Admin");
  });
});
