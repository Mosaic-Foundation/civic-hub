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
import { CIVIC_PROFILE } from "../../spaces/civic/profile.js";
import { CIVIC_HUB } from "../../spaces/civic/type.js";
import { NEUTRAL_SPACE_TYPE, currentSpaceType } from "../../src/shared/spaceTypes.js";
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

  it("is the deployment's pick in config/plugins.json, and the kernel's neutral record is a valid profile (kernel step 4)", async () => {
    const { readFileSync } = await import("node:fs");
    const list = JSON.parse(readFileSync(new URL("../../config/plugins.json", import.meta.url), "utf8")) as { space: string };
    expect(list.space).toBe("spaces/civic");
    expect(currentSpaceType()).toBe(CIVIC_HUB);
    expect(profileProblems(NEUTRAL_SPACE_TYPE.profile)).toEqual([]);
    expect(NEUTRAL_SPACE_TYPE.profile.roles).toEqual({ member: "member", moderator: "moderator", admin: "admin", accountable: "accountable" });
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

describe("the space type as the deployment's setting (kernel step 4)", () => {
  it("writes the files naming the picked space type, or null for none", async () => {
    const { spaceFiles } = await import("../../scripts/plugins-sync.js");
    const civic = spaceFiles("spaces/civic");
    expect(Object.keys(civic).sort()).toEqual(["config/space.ts", "config/spacePalette.css", "config/spacePalette.ts", "config/spaceType.ts"]);
    expect(civic["config/spaceType.ts"]).toContain('import type_ from "../spaces/civic/type.js"');
    expect(civic["config/spacePalette.css"]).toContain('@import "../spaces/civic/palette.css"');
    const none = spaceFiles(null);
    expect(none["config/space.ts"]).toContain("export const SPACE: SpaceServer | null = null;");
    expect(none["config/spaceType.ts"]).toContain("export const SPACE_TYPE: SpaceType | null = null;");
    expect(none["config/spacePalette.ts"]).toContain("export const PALETTE: SpacePalette | null = null;");
    expect(none["config/spacePalette.css"]).not.toContain("@import");
  });
});

describe("a space type's plugins: required, on or off by default (kernel rule 6)", () => {
  it("reads each listed plugin's rule, and leaves the rest to the plugin", async () => {
    const { spacePluginRule, pluginRequired } = await import("../../src/shared/spaceTypes.js");
    const t = { ...CIVIC_HUB, plugins: { required: ["pinning"], on: ["fediverse"], off: ["members"] } };
    expect(spacePluginRule("pinning", t)).toBe("required");
    expect(spacePluginRule("fediverse", t)).toBe("on");
    expect(spacePluginRule("members", t)).toBe("off");
    expect(spacePluginRule("search", t)).toBeNull();
    expect(pluginRequired("pinning", t)).toBe(true);
    expect(pluginRequired("search", t)).toBe(false);
  });

  it("changes nothing for the Civic Hub today: it lists no plugin, so each keeps its own default", async () => {
    const { pluginDefaultOn } = await import("../../src/shared/hubFeatures.js");
    expect(CIVIC_HUB.plugins).toBeUndefined();
    expect(pluginDefaultOn("fediverse")).toBe(false);
    expect(pluginDefaultOn("search")).toBe(true);
  });
});
