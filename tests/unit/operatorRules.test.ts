// The operator API's pure rules (src/operator/): the MEETING_* / FLOYD_NEWS_*
// guard on creating a hub, the hostnames a hub may not take, and which
// changes the console asks a fresh code for.

import { afterEach, describe, expect, it } from "vitest";
import { platformDomain } from "../../src/operator/platform.js";
import { hostnameShapeProblem, hubSpecificEnvVars, productionCreateGuard } from "../../src/operator/hubs.js";
import { configChangeNeedsStepUp } from "../../src/operator/hubs.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["SUPABASE_URL", "CIVIC_PLATFORM_DOMAIN"]) {
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
  it("refuses reserved names under the platform domain (CIVIC_PLATFORM_DOMAIN)", () => {
    process.env.CIVIC_PLATFORM_DOMAIN = "civic.social";
    expect(platformDomain()).toBe("civic.social");
    expect(hostnameShapeProblem("polis.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("floyd.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("console.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("start.civic.social")).toContain("reserved");
    expect(hostnameShapeProblem("athens.civic.social")).toBeNull();
    expect(hostnameShapeProblem("polis.example.org")).toBeNull();
    // The console lives at console.mosaic.social, outside the platform domain.
    expect(hostnameShapeProblem("polis.mosaic.social")).toBeNull();
  });

  it("reserves nothing without a platform domain (local development)", () => {
    delete process.env.CIVIC_PLATFORM_DOMAIN;
    expect(platformDomain()).toBeNull();
    expect(hostnameShapeProblem("polis.civic.social")).toBeNull();
  });

  it("refuses what is not a bare hostname", () => {
    for (const bad of ["https://x.civic.social", "x.civic.social:443", "x.civic.social/path", "Has Space.com", "nodot"]) {
      expect(hostnameShapeProblem(bad), bad).toContain("not a hostname");
    }
  });
});

describe("a fresh code", () => {
  it("is asked to move or pause a hub; not to rename it or resume it (its mode is its admins', session 4)", () => {
    expect(configChangeNeedsStepUp({ hostname: "x.example.org" })).toBe(true);
    expect(configChangeNeedsStepUp({ status: "suspended" })).toBe(true);
    expect(configChangeNeedsStepUp({ name: "New" })).toBe(false);
    expect(configChangeNeedsStepUp({ status: "active" })).toBe(false);
  });
});
