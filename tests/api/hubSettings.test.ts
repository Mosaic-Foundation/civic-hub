import { describe, it, expect } from "vitest";
import { request } from "node:http";
import { API_BASE } from "../fixtures/helpers.js";

/**
 * Settings are scoped by hub — the point of the whole phase.
 *
 * These run against the two seeded hubs on ONE server process, which is what
 * makes them meaningful: if scoping were broken, both hostnames would answer
 * with the same values and every assertion below would fail at once.
 *
 * Needs `supabase start`, `supabase db reset` and
 * `npx tsx scripts/seed-hub-settings.ts --hub athens`. CI does this in the
 * api-tests job.
 *
 * node:http rather than fetch, because the hostname IS the variable under
 * test and `Host` is a forbidden header for fetch — undici drops an override
 * silently, so every request would resolve to the same hub and these tests
 * would pass while proving nothing.
 */
function get(path: string, host: string): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: { Accept: "application/json", Host: host },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            reject(new Error(`unparseable (${res.statusCode}): ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const FLOYD = "floyd.civic.social";
const ATHENS = "athens.localhost";

describe("settings are scoped by hub", () => {
  it("gives each hub its own banner", async () => {
    const floyd = await get("/hub-config", FLOYD);
    const athens = await get("/hub-config", ATHENS);
    expect(floyd.body.settings["identity.banner_url"]).toBe("/floyd-banner.jpg");
    expect(athens.body.settings["identity.banner_url"]).toBe("/athens-banner.jpg");
  });

  it("gives each hub its own governing body", async () => {
    const floyd = await get("/hub-config", FLOYD);
    const athens = await get("/hub-config", ATHENS);
    expect(floyd.body.settings["copy.governing_body_name"]).toBe(
      "Board of Supervisors",
    );
    expect(athens.body.settings["copy.governing_body_name"]).toBe("Town Council");
  });

  it("does not leak one hub's About text to the other", async () => {
    // Both hubs have an About page now. Until 2026-09-23 `copy.about` had an
    // override path and no shared template, so Athens's authored page was
    // stored and never rendered while the app showed Floyd's hardcoded one to
    // everybody. The assertion that Floyd had none was describing that bug.
    const floyd = await get("/hub-config/documents", FLOYD);
    const athens = await get("/hub-config/documents", ATHENS);

    // Athens authored its own, so it gets its own.
    expect(athens.body.documents["copy.about"]).toContain("demonstration");

    // Floyd gets the shared template under its own name, not Athens's page.
    const floydAbout = floyd.body.documents["copy.about"] as string;
    expect(floydAbout).toBeDefined();
    expect(floydAbout).not.toContain("demonstration");
    expect(floydAbout).not.toContain("Athens");
    expect(floydAbout).toContain("pilot program");

    // And neither is the other.
    expect(floydAbout).not.toBe(athens.body.documents["copy.about"]);
  });

  it("calls a hub by the name it chose, not the one in the registry", async () => {
    // `identity.name` is the DISPLAY name and `hubs.name` is the REGISTRY
    // name. They were the same thing until an admin needed to be "Floyd
    // County Civic Hub" rather than "Floyd Civic Hub", so as not to be
    // mistaken for the Town of Floyd — a distinction only that hub knows it
    // needs. The settings key had existed since Phase 1 part one and nothing
    // read it, so the name was not editable at all.
    const config = await get("/hub-config", FLOYD);
    const chosen = config.body.settings["identity.name"];
    if (!chosen) return; // no row seeded in this environment

    const { body } = await get("/hub-config/documents", FLOYD);
    for (const key of ["copy.about", "legal.terms", "legal.privacy"]) {
      expect(body.documents[key], key).toContain(chosen);
    }
  });
});

describe("legal documents per hub", () => {
  it("serves a hub's own document where it has authored one", async () => {
    const { body } = await get("/hub-config/documents", ATHENS);
    const conduct = body.documents["legal.code_of_conduct"];
    expect(conduct).toContain("demonstration hub");
    expect(conduct.length).toBeLessThan(2000);
  });

  it("serves the shared document, in the hub's own name, where it has not", async () => {
    const { body } = await get("/hub-config/documents", ATHENS);
    const terms = body.documents["legal.terms"];
    expect(terms).toContain("Athens Civic Hub");
    expect(terms).not.toContain("Floyd");
  });

  it("leaves no placeholder unsubstituted in any document", async () => {
    for (const host of [FLOYD, ATHENS]) {
      const { body } = await get("/hub-config/documents", host);
      for (const [key, text] of Object.entries(body.documents)) {
        expect(String(text), `${host} ${key}`).not.toMatch(
          /\{(HUB_NAME|PLACE|JURISDICTION|STATE|GOVERNING_BODY)\}/,
        );
      }
    }
  });
});

describe("what the config endpoint must never serve", () => {
  it("has no bypass code, allowlist, roster or sender address", async () => {
    for (const host of [FLOYD, ATHENS]) {
      const { body } = await get("/hub-config", host);
      const keys = Object.keys(body.settings);
      expect(keys.some((k) => k.startsWith("people."))).toBe(false);
      expect(keys.some((k) => k.startsWith("email."))).toBe(false);
      expect(keys).not.toContain("beta.allowlist");
      expect(keys).not.toContain("beta.demo_bypass_code");

      // And nothing that merely LOOKS like one, whatever it is called.
      const blob = JSON.stringify(body).toLowerCase();
      expect(blob).not.toContain("bypass");
      expect(blob).not.toContain("@athens.example");
    }
  });

  it("carries the hub's mode, which the client renders", async () => {
    const { body } = await get("/hub-config", ATHENS);
    expect(["demo", "beta", "live"]).toContain(body.hub.mode);
  });
});
