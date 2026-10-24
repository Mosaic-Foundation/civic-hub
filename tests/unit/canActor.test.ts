/**
 * The authorization seam (Architecture 4, ADR-011): canActor answers each
 * question for each kind of caller — signed out, signed in but not a member,
 * a member without a name, a member, an administrator, an official — on every
 * registered process type and every action its descriptor declares. The
 * answers are today's rules, moved: tests/api/authzParity.test.ts holds them
 * to the old email-based checks on real data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  granted: { admin: 1, board: 0, announcement_author: 0 } as Record<string, number>,
  lookupOfficialBySubject: vi.fn(),
  areOfficialsMigrated: vi.fn(),
}));

vi.mock("../../src/db/hubRolesStore.js", () => ({
  getHubRoles: async () => ({ byUser: new Map(), granted: mocks.granted }),
  invalidateHubRoles: () => {},
}));
vi.mock("../../src/services/officials.js", () => ({ lookupOfficialBySubject: mocks.lookupOfficialBySubject }));
vi.mock("../../src/services/hubSettings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/hubSettings.js")>()),
  areOfficialsMigrated: mocks.areOfficialsMigrated,
}));

const { canActor, callerMayCall } = await import("../../src/authz/canActor.js");
const { SIGNED_OUT } = await import("../../src/authz/actor.js");
const { HUB_ELIGIBILITY, satisfies } = await import("../../src/authz/eligibility.js");
const { MANIFEST_LIST } = await import("../../src/shared/processManifests.js");
const { withHubScope } = await import("../../src/config/hubContext.js");
type Actor = import("../../src/authz/actor.js").Actor;
type HubRole = import("../../src/authz/actor.js").HubRole;
type Process = import("../../src/models/process.js").Process;
type HubAction = import("../../src/authz/canActor.js").HubAction;

const HUB = {
  id: "seam", hostname: "seam.example", name: "Seam", jurisdiction_code: null, jurisdiction_name: null,
  space_did: "did:web:seam.example", protocol_hub_id: "civic-hub-seam", space_type: "civic-hub",
  status: "active", mode: "live", created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:00:00Z",
} as never;

function account(over: { roles?: HubRole[]; resident?: boolean; named?: boolean; assurance?: "code" | "demo"; subject?: string } = {}): Actor {
  return {
    kind: "account",
    subject: over.subject ?? "user_me",
    assurance: over.assurance ?? "code",
    roles: new Map((over.roles ?? []).map((r) => [r, r === "announcement_author" ? { label: "Board member" } : {}])),
    resident: over.resident ?? true,
    named: over.named ?? true,
  };
}

const PEOPLE = {
  "signed out": SIGNED_OUT,
  "signed in, not a member": account({ resident: false, named: false }),
  "a member without a name": account({ named: false }),
  member: account(),
  admin: account({ roles: ["admin"] }),
  official: account(),
} as const;

const inHub = <T>(fn: () => Promise<T>) => withHubScope(HUB, {}, fn);
const code = async (actor: Actor, action: HubAction) => {
  const d = await inHub(() => canActor(actor, action));
  return d.allowed ? "allowed" : d.error.code;
};

beforeEach(() => {
  mocks.granted = { admin: 1, board: 0, announcement_author: 0 };
  mocks.areOfficialsMigrated.mockResolvedValue(true);
  mocks.lookupOfficialBySubject.mockImplementation(async (subject: string) =>
    subject === "user_official" ? { type: "board_of_supervisors", title: "Board of Supervisors" } : null,
  );
});

describe("canActor — the hub's questions", () => {
  const expected: Record<string, Record<string, string>> = {
    "signed out": { "hub.participate": "sign_in_required", "hub.administer": "sign_in_required", "hub.see_as_admin": "admin_required", "announcement.post": "sign_in_required", "office.respond": "sign_in_required" },
    "signed in, not a member": { "hub.participate": "residency_required", "hub.administer": "admin_required", "hub.see_as_admin": "admin_required", "announcement.post": "author_required", "office.respond": "official_required" },
    "a member without a name": { "hub.participate": "name_required", "hub.administer": "admin_required", "hub.see_as_admin": "admin_required", "announcement.post": "author_required", "office.respond": "official_required" },
    member: { "hub.participate": "allowed", "hub.administer": "admin_required", "hub.see_as_admin": "admin_required", "announcement.post": "author_required", "office.respond": "official_required" },
    admin: { "hub.participate": "allowed", "hub.administer": "allowed", "hub.see_as_admin": "allowed", "announcement.post": "allowed", "office.respond": "official_required" },
    official: { "hub.participate": "allowed", "hub.administer": "admin_required", "hub.see_as_admin": "admin_required", "announcement.post": "allowed", "office.respond": "allowed" },
  };
  for (const [who, answers] of Object.entries(expected)) {
    it(`${who}`, async () => {
      const actor = who === "official" ? account({ subject: "user_official" }) : PEOPLE[who as keyof typeof PEOPLE];
      for (const [action, want] of Object.entries(answers)) {
        expect(await code(actor, action as HubAction), `${who} / ${action}`).toBe(want);
      }
    });
  }

  it("a hub with no administrators fails closed and says how to recover, a pending grant counts", async () => {
    mocks.granted = { admin: 0, board: 0, announcement_author: 0 };
    expect(await code(account({ roles: ["admin"] }), "hub.administer")).toBe("no_admins");
    expect(await code(account(), "hub.administer")).toBe("no_admins");
    mocks.granted = { admin: 1, board: 0, announcement_author: 0 };
    expect(await code(account(), "hub.administer")).toBe("admin_required");
  });

  it("a session not proved by an emailed code carries no role (Audit 2)", async () => {
    const demo = account({ roles: ["admin"], assurance: "demo" });
    expect(await code(demo, "hub.administer")).toBe("code_sign_in_required");
    expect(await code(demo, "announcement.post")).toBe("code_sign_in_required");
    expect(await code(demo, "office.respond")).toBe("code_sign_in_required");
    expect(await code(demo, "hub.see_as_admin")).toBe("admin_required");
  });

  it("an official speaks for the office; an admin as such may not", async () => {
    expect(await code(account({ roles: ["admin"] }), "office.respond")).toBe("official_required");
    expect(await code(account({ roles: ["admin"], subject: "user_official" }), "office.respond")).toBe("allowed");
  });
});

describe("canActor — every process type, every declared action", () => {
  function processOf(type: string, createdBy = "user_someone_else"): Process {
    return {
      id: "proc_x", definition: { type, version: "1" } as never, title: "t", description: "", status: "active", hubId: "seam",
      jurisdiction: "", createdBy, createdAt: "", updatedAt: "", state: {},
    };
  }

  for (const m of MANIFEST_LIST) {
    const type = m.descriptor.type;
    it(`${type}`, async () => {
      for (const declared of m.descriptor.actions) {
        for (const [who, actor] of Object.entries(PEOPLE)) {
          for (const mine of [false, true]) {
            const process = processOf(type, mine && actor.kind === "account" ? actor.subject : "user_someone_else");
            const d = await inHub(() => canActor(actor, "process.act", { process, action: declared.name }));
            const label = `${type} ${declared.name} / ${who}${mine ? " (creator)" : ""}`;
            if (who === "signed out") { expect(d.allowed, label).toBe(false); continue; }
            if (who === "signed in, not a member") { expect(!d.allowed && d.error.code, label).toBe("residency_required"); continue; }
            if (who === "a member without a name") { expect(!d.allowed && d.error.code, label).toBe("name_required"); continue; }
            expect(d.allowed, label).toBe(true);
            const caller = d.allowed ? d.caller! : "resident";
            expect(caller, label).toBe(who === "admin" ? "admin" : "resident");
            const may = callerMayCall(caller, declared, process, actor.kind === "account" ? actor.subject : "");
            const residentMay = declared.callers.includes("resident") || (mine && declared.callers.includes("creator"));
            expect(may, label).toBe(who === "admin" ? true : residentMay);
          }
        }
      }
    });
  }

  it("an undeclared action is the hub's or an admin's, never a resident's", () => {
    expect(callerMayCall("resident", undefined, processOf("civic.vote"), "user_me")).toBe(false);
    expect(callerMayCall("admin", undefined, processOf("civic.vote"), "user_me")).toBe(true);
    expect(callerMayCall("system", undefined, processOf("civic.vote"), "")).toBe(true);
  });

  it("a creator-only action needs the creator, and an empty subject is nobody", () => {
    const declared = { callers: ["creator"] };
    expect(callerMayCall("resident", declared, processOf("civic.project", "user_me"), "user_me")).toBe(true);
    expect(callerMayCall("resident", declared, processOf("civic.project", "user_me"), "user_other")).toBe(false);
    expect(callerMayCall("resident", declared, processOf("civic.project", ""), "")).toBe(false);
  });
});

describe("eligibility", () => {
  it("the hub's rule is residency and a real name, a constant", () => {
    expect(HUB_ELIGIBILITY).toEqual({ residency: "hub", realName: "required" });
    expect(Object.isFrozen(HUB_ELIGIBILITY)).toBe(true);
  });

  it("no registered type declares a stricter rule", () => {
    expect(MANIFEST_LIST.filter((m) => m.eligibility).map((m) => m.descriptor.type)).toEqual([]);
  });

  it("reads a declaration as the identity spec's conjunction, with alternatives", () => {
    const held = new Set(["proof_of_personhood", "resident.county"]);
    expect(satisfies(held, ["proof_of_personhood"])).toBe(true);
    expect(satisfies(held, ["proof_of_personhood", ["resident.city", "resident.county"]])).toBe(true);
    expect(satisfies(held, ["proof_of_personhood", "resident.city"])).toBe(false);
    expect(satisfies(new Set(), ["resident.county"])).toBe(false);
  });
});
