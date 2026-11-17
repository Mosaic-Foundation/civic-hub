// hubContext() (Events 2, E3): what a package may know about the hub in
// scope, read per call. And the zone is a public setting, so a package's
// page can read it from /hub-config.

import { describe, expect, it } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import { hubContext } from "../../src/sdk/index.js";
import { isPublicKey } from "../../src/models/hubSettings.js";
import { ATHENS_HUB, FLOYD_HUB } from "../fixtures/hubs/index.js";

describe("hubContext()", () => {
  it("answers for the hub in scope: its name, its origin and its zone", () => {
    const athens = runWithHub(ATHENS_HUB, { "identity.name": "Athens Civic Hub", "identity.timezone": "America/New_York" }, hubContext);
    expect(athens.name).toBe("Athens Civic Hub");
    expect(athens.timeZone).toBe("America/New_York");
    expect(athens.baseUrl).toContain(ATHENS_HUB.hostname);
    expect(athens.baseUrl).not.toMatch(/\/$/);
    const floyd = runWithHub(FLOYD_HUB, {}, hubContext);
    expect(floyd.baseUrl).toContain(FLOYD_HUB.hostname);
    expect(floyd.timeZone, "unset reads as its place's zone (Events 3)").toBe("America/New_York");
    const nowhere = runWithHub({ ...FLOYD_HUB, jurisdiction_code: null }, {}, hubContext);
    expect(nowhere.timeZone, "a hub with no place and no zone is on UTC").toBe("UTC");
  });

  it("reads a zone this runtime does not know as its place's", () => {
    expect(runWithHub(ATHENS_HUB, { "identity.timezone": "Nowhere/Special" }, hubContext).timeZone).toBe("America/New_York");
  });

  it("serves the hub's zone to anyone", () => {
    expect(isPublicKey("identity.timezone")).toBe(true);
  });

  // Kernel step 1: the scope it serves and what it calls the people taking part.
  it("knows its place, or 'local' without one", () => {
    expect(runWithHub(FLOYD_HUB, {}, hubContext).place).toBe(FLOYD_HUB.jurisdiction_code);
    expect(runWithHub({ ...FLOYD_HUB, jurisdiction_code: null }, {}, hubContext).place).toBe("local");
  });

  it("names the people taking part as the hub does", () => {
    const noun = (settings: Record<string, string>, n: number) => runWithHub(FLOYD_HUB, settings, () => hubContext().participantNoun(n));
    expect(noun({ "identity.hub_kind": "place" }, 1)).toBe("resident");
    expect(noun({ "identity.hub_kind": "place" }, 3)).toBe("residents");
    expect(noun({ "identity.hub_kind": "organization" }, 2)).toBe("members");
    expect(noun({ "identity.hub_kind": "place", "copy.resident_noun": "neighbor" }, 2)).toBe("neighbors");
  });

  // Kernel step 2: the kernel's words, as the civic profile names them.
  it("names the kernel's words as the hub does: term()", async () => {
    const { term } = await import("../../src/sdk/index.js");
    const at = (settings: Record<string, string>, f: () => string) => runWithHub(FLOYD_HUB, settings, f);
    expect(at({}, () => hubContext().term("member", 2))).toBe("residents");
    expect(at({ "copy.resident_noun": "neighbor" }, () => term("member"))).toBe("neighbor");
    expect(at({}, () => term("accountable", 2))).toBe("officials");
    expect(at({ "identity.hub_kind": "issue" }, () => term("space"))).toBe("hub");
  });
});
