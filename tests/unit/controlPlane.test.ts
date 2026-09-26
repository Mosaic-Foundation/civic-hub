// The super admin's pure rules (src/control/): the MEETING_* / FLOYD_NEWS_*
// guard on creating a hub, the hostnames a hub may not take, and the
// one-person operator setting.

import { afterEach, describe, expect, it } from "vitest";
import { consoleAdminEmail, isConsoleHost, platformDomain } from "../../src/control/config.js";
import { hostnameShapeProblem, hubSpecificEnvVars, productionCreateGuard } from "../../src/control/hubs.js";
import { configChangeNeedsStepUp } from "../../src/control/hubs.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["SUPABASE_URL", "CIVIC_CONSOLE_HOSTNAME", "CIVIC_CONSOLE_ADMIN_EMAIL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const PROD = "https://nfhyypwoporfggqcerli.supabase.co";
const DEV = "https://urfmvqhzmamigssqwsya.supabase.co";

describe("the create guard (step 7)", () => {
  const env = { MEETING_SOURCE_URL: "https://example.test/minutes", FLOYD_NEWS_SYNC_ENABLED: "true", OTHER: "x" };

  it("refuses a second hub on the production database while the env vars are set, naming them", () => {
    process.env.SUPABASE_URL = PROD;
    const why = productionCreateGuard(1, env);
    expect(why).toContain("FLOYD_NEWS_SYNC_ENABLED, MEETING_SOURCE_URL");
    expect(why).toContain("production database");
    expect(why).toContain("inherit");
  });

  it("allows the first hub, a clean environment, and any database that is not production", () => {
    process.env.SUPABASE_URL = PROD;
    expect(productionCreateGuard(0, env)).toBeNull();
    expect(productionCreateGuard(3, { OTHER: "x", MEETING_SOURCE_URL: "  " })).toBeNull();
    process.env.SUPABASE_URL = DEV;
    expect(productionCreateGuard(3, env)).toBeNull();
  });

  it("counts only set, non-empty MEETING_* and FLOYD_NEWS_* vars", () => {
    expect(hubSpecificEnvVars({ MEETING_X: "1", MEETING_Y: "", FLOYD_NEWS_Z: "2", NEWS: "3" })).toEqual([
      "FLOYD_NEWS_Z",
      "MEETING_X",
    ]);
  });
});

describe("hostnames", () => {
  it("refuses the console's own hostname and reserved names under the platform domain", () => {
    process.env.CIVIC_CONSOLE_HOSTNAME = "console.civic.social";
    expect(platformDomain()).toBe("civic.social");
    expect(hostnameShapeProblem("console.civic.social")).toContain("console's own");
    expect(hostnameShapeProblem("polis.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("floyd.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("athens.civic.social")).toBeNull();
    expect(hostnameShapeProblem("polis.example.org")).toBeNull();
  });

  it("refuses what is not a bare hostname", () => {
    for (const bad of ["https://x.civic.social", "x.civic.social:443", "x.civic.social/path", "Has Space.com", "nodot"]) {
      expect(hostnameShapeProblem(bad), bad).toContain("not a hostname");
    }
  });

  it("a dev console on vercel.app reserves nothing under vercel.app", () => {
    process.env.CIVIC_CONSOLE_HOSTNAME = "console-civic-hub-dev.vercel.app";
    expect(platformDomain()).toBe("vercel.app");
    expect(hostnameShapeProblem("utopia-civic-hub-dev.vercel.app")).toBeNull();
  });

  it("matches the console host whatever the case or port", () => {
    process.env.CIVIC_CONSOLE_HOSTNAME = "console.civic.social";
    expect(isConsoleHost("Console.Civic.Social:443")).toBe(true);
    expect(isConsoleHost("floyd.civic.social")).toBe(false);
    delete process.env.CIVIC_CONSOLE_HOSTNAME;
    expect(isConsoleHost("console.civic.social")).toBe(false);
  });
});

describe("the operator", () => {
  it("is exactly one address", () => {
    process.env.CIVIC_CONSOLE_ADMIN_EMAIL = " Op@Example.test ";
    expect(consoleAdminEmail()).toEqual({ ok: true, email: "op@example.test" });
    process.env.CIVIC_CONSOLE_ADMIN_EMAIL = "a@example.test,b@example.test";
    expect(consoleAdminEmail().ok).toBe(false);
    process.env.CIVIC_CONSOLE_ADMIN_EMAIL = "";
    expect(consoleAdminEmail().ok).toBe(false);
  });
});

describe("step-up", () => {
  it("is needed to move, pause or change the mode of a hub; not to rename it or resume it", () => {
    expect(configChangeNeedsStepUp({ hostname: "x.example.org" })).toBe(true);
    expect(configChangeNeedsStepUp({ status: "suspended" })).toBe(true);
    expect(configChangeNeedsStepUp({ mode: "live" })).toBe(true);
    expect(configChangeNeedsStepUp({ name: "New" })).toBe(false);
    expect(configChangeNeedsStepUp({ status: "active" })).toBe(false);
  });
});
