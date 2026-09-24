import { describe, it, expect } from "vitest";
import {
  HUB_MODES,
  ADMIN_SETTABLE_HUB_MODES,
  isHubMode,
  isAdminSettableHubMode,
  hubModeChangeRejectionReason,
} from "../../src/models/hub.js";

// A hub's mode decides whether email verification happens at all, so the rule
// about who may set what is a security boundary, not a preference.
//
// These were written before the admin form existed, to say what it would have
// to answer. The form exists now (ui/src/pages/AdminSettings.tsx, "Who can
// sign in") and builds its options from ADMIN_SETTABLE_HUB_MODES, so the
// pinning matters more rather than less: adding `demo` to that list would put
// it in a dropdown on every hub.

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

describe("mode is not configurable from the environment", () => {
  it("has no env fallback for demo mode or a bypass code", async () => {
    // The whole point of the hardening pass: an environment variable must not
    // be able to decide whether a hub checks email addresses. If either of
    // these reappears in ENV_FALLBACKS, a deployment could turn a real
    // jurisdiction's hub into one where anyone signs in as anyone.
    const { ENV_FALLBACKS } = await import("../../src/models/hubSettings.js");
    const names = Object.values(ENV_FALLBACKS).flat();
    expect(names).not.toContain("CIVIC_DEMO_BYPASS_CODE");
    expect(names).not.toContain("VITE_DEMO_MODE");
    expect(names).not.toContain("CIVIC_BETA_MODE");
  });

  it("answers live when there is no hub in scope", async () => {
    // Strictest of the three. Code with no hub must not assume it is allowed
    // to skip verification.
    const { hubModeFor } = await import("../../src/services/hubSettings.js");
    expect(hubModeFor(null)).toBe("live");
    expect(hubModeFor({ mode: null })).toBe("live");
    expect(hubModeFor({ mode: "nonsense" })).toBe("live");
    expect(hubModeFor({ mode: "demo" })).toBe("demo");
  });
});

// --- The admin panel's mode control ----------------------------------------
//
// Added 2026-09-23 with the UI. Until then the rule lived only in the model
// and the endpoint, and the note in HANDOFF said "tests that say what the
// future form must answer". This is that form, so these are the answers.

describe("what the admin mode control may offer", () => {
  it("offers beta and live, and never demo, to a hub that is not one", () => {
    // The form builds its options from ADMIN_SETTABLE_HUB_MODES, so if demo
    // is ever added there it appears in a dropdown on every hub — which is
    // the failure this guards.
    expect([...ADMIN_SETTABLE_HUB_MODES].sort()).toEqual(["beta", "live"]);
    expect(ADMIN_SETTABLE_HUB_MODES).not.toContain("demo");
  });

  it("lets a demo hub graduate, in either direction out", () => {
    // The restriction runs one way only. A demo hub becoming real is its
    // admin's decision and theirs to make.
    expect(hubModeChangeRejectionReason("demo", "beta")).toBeNull();
    expect(hubModeChangeRejectionReason("demo", "live")).toBeNull();
  });

  it("refuses every route back into demo", () => {
    for (const from of ["demo", "beta", "live"] as const) {
      expect(
        hubModeChangeRejectionReason(from, "demo"),
        `${from} -> demo`,
      ).toBeTruthy();
    }
  });

  it("refuses a mode that is not a mode", () => {
    for (const junk of ["", "DEMO", "production", null, undefined, 7]) {
      expect(hubModeChangeRejectionReason("live", junk)).toBeTruthy();
    }
  });
});
