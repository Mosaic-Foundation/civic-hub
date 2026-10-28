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
    expect(floyd.timeZone, "unset reads as UTC").toBe("UTC");
  });

  it("reads a zone this runtime does not know as UTC", () => {
    expect(runWithHub(ATHENS_HUB, { "identity.timezone": "Nowhere/Special" }, hubContext).timeZone).toBe("UTC");
  });

  it("serves the hub's zone to anyone", () => {
    expect(isPublicKey("identity.timezone")).toBe(true);
  });
});
