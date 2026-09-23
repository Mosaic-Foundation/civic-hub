import { describe, it, expect } from "vitest";
import {
  HUB_MODES,
  ADMIN_SETTABLE_HUB_MODES,
  isHubMode,
  isAdminSettableHubMode,
  hubModeChangeRejectionReason,
} from "../../src/models/hub.js";

// A hub's mode decides whether email verification happens at all, so the rule
// about who may set what is a security boundary, not a preference. It is
// pinned here because the admin UI does not exist yet: whoever writes that
// form will call hubModeChangeRejectionReason, and these tests say what it
// must answer before the form exists to get it wrong.

describe("hub modes", () => {
  it("has exactly three", () => {
    expect([...HUB_MODES]).toEqual(["demo", "beta", "live"]);
  });

  it("rejects anything that is not one of them", () => {
    for (const bad of ["production", "DEMO", "", null, undefined, 1]) {
      expect(isHubMode(bad)).toBe(false);
    }
  });
});

describe("who may set which mode", () => {
  it("lets a hub admin choose beta or live", () => {
    expect([...ADMIN_SETTABLE_HUB_MODES]).toEqual(["beta", "live"]);
    expect(isAdminSettableHubMode("beta")).toBe(true);
    expect(isAdminSettableHubMode("live")).toBe(true);
  });

  it("never lets a hub admin put a hub INTO demo", () => {
    // Demo turns off email verification. An admin who selected it — by
    // accident, or with a taken-over account — would open a real
    // jurisdiction's hub to anyone signing in as anyone.
    expect(isAdminSettableHubMode("demo")).toBe(false);
    for (const from of HUB_MODES) {
      expect(hubModeChangeRejectionReason(from, "demo")).toMatch(
        /platform operator/i,
      );
    }
  });

  it("lets a demo hub's own admin graduate it to beta or live", () => {
    // The restriction is one-directional: a demo graduating into a real hub
    // is a real decision, and its admin is the right person to make it.
    expect(hubModeChangeRejectionReason("demo", "beta")).toBeNull();
    expect(hubModeChangeRejectionReason("demo", "live")).toBeNull();
  });

  it("explains an unknown mode rather than silently refusing", () => {
    const reason = hubModeChangeRejectionReason("live", "production");
    expect(reason).toContain("production");
    expect(reason).toContain("demo, beta, live");
  });
});
