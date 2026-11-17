// Kernel step 2 (docs/KERNEL.md §3): the kernel's roles and words, and the
// civic profile that names them. The civic profile says what the hub said
// before it existed, so no word on screen changes.

import { describe, it, expect } from "vitest";
import {
  KERNEL_ROLES,
  KERNEL_TERMS,
  NEUTRAL_TERMS,
  kernelRoleOf,
  namesRole,
  profileProblems,
  resolveTerm,
  type SpaceProfile,
} from "../../src/shared/spaceProfile.js";
import { CIVIC_PROFILE } from "../../src/shared/profiles/civic.js";
import { CIVIC_HUB, currentSpaceType } from "../../src/shared/spaceTypes.js";
import { HUB_KINDS, participantNoun, personLabel } from "../../src/shared/hubKind.js";
import { memberCreation } from "../../src/processes/descriptorTypes.js";
import { PROCESS_MANIFESTS } from "../../src/shared/processManifests.js";

describe("the kernel's roles and words", () => {
  it("knows four roles and reads the names before step 2 as two of them", () => {
    expect(KERNEL_ROLES).toEqual(["member", "moderator", "admin", "accountable"]);
    expect(kernelRoleOf("resident")).toBe("member");
    expect(kernelRoleOf("official")).toBe("accountable");
    expect(kernelRoleOf("creator")).toBe("creator");
    expect(namesRole(["resident", "admin"], "member")).toBe(true);
    expect(namesRole(["official"], "accountable")).toBe(true);
    expect(namesRole(["admin"], "member")).toBe(false);
    expect(namesRole(undefined, "member")).toBe(false);
  });

  it("resolves a word: the space's own, then the profile's for its kind, then the profile's, then the neutral word", () => {
    expect(resolveTerm("member", CIVIC_PROFILE, { kind: "place" })).toBe("resident");
    expect(resolveTerm("member", CIVIC_PROFILE, { kind: "organization" }, 2)).toBe("members");
    expect(resolveTerm("member", CIVIC_PROFILE, { kind: "issue" })).toBe("participant");
    expect(resolveTerm("member", CIVIC_PROFILE, { kind: "place", own: " Neighbor " }, 2)).toBe("neighbors");
    expect(resolveTerm("accountable", CIVIC_PROFILE)).toBe("official");
    expect(resolveTerm("space", CIVIC_PROFILE, {}, 2)).toBe("hubs");
    for (const t of KERNEL_TERMS) expect(resolveTerm(t, null)).toBe(NEUTRAL_TERMS[t]);
    const bare: SpaceProfile = { ...CIVIC_PROFILE, id: "bare", terms: {} };
    expect(resolveTerm("member", bare, { kind: "place" })).toBe("member");
  });

  it("refuses a profile that names a role or term the kernel does not know, or leaves a role unnamed", () => {
    expect(profileProblems(CIVIC_PROFILE)).toEqual([]);
    const bad = { ...CIVIC_PROFILE, id: "bad", roles: { ...CIVIC_PROFILE.roles, coach: "coach", moderator: "" }, terms: { group: "team" } } as unknown as SpaceProfile;
    expect(profileProblems(bad)).toEqual(["bad: role moderator has no name", "bad: coach is not a kernel role", "bad: group is not a kernel term"]);
  });
});

describe("the civic profile", () => {
  it("is the Civic Hub space type's, and names the space as the space type does", () => {
    expect(currentSpaceType().profile).toBe(CIVIC_PROFILE);
    expect([CIVIC_HUB.noun, CIVIC_HUB.nounPlural]).toEqual(["hub", "hubs"]);
    expect(CIVIC_PROFILE.roles).toEqual({ member: "resident", moderator: "moderator", admin: "admin", accountable: "official" });
  });

  it("says what the hub said before it existed, for every kind of hub", () => {
    for (const { id } of HUB_KINDS) {
      const before = id === "place" ? "resident" : id === "organization" || id === "community" ? "member" : "participant";
      expect(participantNoun(id, 1)).toBe(before);
      expect(participantNoun(id, 2)).toBe(`${before}s`);
      expect(personLabel(id)).toBe(before[0].toUpperCase() + before.slice(1));
      expect(participantNoun(id, 3, "family")).toBe("families");
    }
  });
});

describe("a descriptor's member creation", () => {
  it("reads creation.member, else creation.resident", () => {
    const at = { drafts: "/x/drafts" };
    expect(memberCreation({ member: at })).toBe(at);
    expect(memberCreation({ resident: at })).toBe(at);
    expect(memberCreation({ member: null })).toBeNull();
    expect(memberCreation(undefined)).toBeNull();
  });

  it("every shipped type names one or the other, not both", () => {
    for (const m of PROCESS_MANIFESTS) {
      const c = m.descriptor.creation;
      expect([c.member, c.resident].filter((x) => x !== undefined).length, m.descriptor.type).toBe(1);
    }
  });
});
