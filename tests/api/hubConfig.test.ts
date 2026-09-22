import { describe, it, expect } from "vitest";
import { request } from "node:http";
import { API_BASE } from "../fixtures/helpers.js";

/**
 * GET /hub-config against a running server — the end-to-end proof that one
 * process serves two hubs. The unit layer covers the resolver's decisions;
 * this covers the thing those decisions exist for, which is that two
 * hostnames get two different identities out of the same build.
 *
 * Requires the local stack (`supabase start`) and the dev server. Both hubs
 * come from supabase/seed.sql, so `supabase db reset` is enough to set up.
 *
 * NOTE: CI does not run tests/api — see TESTING.md, "Running integration
 * tests in CI". As of 2026-09-22 option 1 there (the Supabase CLI local
 * stack) is unblocked, because supabase/config.toml now exists and the whole
 * schema builds from migrations. Wiring it into the workflow is Adam's call.
 */

interface HubConfigResult {
  status: number;
  cacheControl: string | undefined;
  body: {
    hub?: Record<string, unknown>;
    settings?: Record<string, string>;
    error?: string;
  };
}

/**
 * node:http rather than fetch, because the hostname IS the thing under test.
 * `Host` is a forbidden header for fetch: undici drops an override silently
 * and sends the connection's own host, so every request would resolve to the
 * same hub and these tests would pass without proving anything.
 */
function hubConfig(host: string): Promise<HubConfigResult> {
  const url = new URL(`${API_BASE}/hub-config`);
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
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              cacheControl: res.headers["cache-control"],
              body: JSON.parse(raw),
            });
          } catch (e) {
            reject(new Error(`unparseable response (${res.statusCode}): ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("GET /hub-config", () => {
  it("returns the hub serving this hostname", async () => {
    const { status, body } = await hubConfig("floyd.civic.social");
    expect(status).toBe(200);
    expect(body.hub?.id).toBe("floyd");
    expect(body.hub?.name).toBe("Floyd Civic Hub");
    expect(body.hub?.jurisdiction_code).toBe("us-va-floyd");
  });

  it("returns a different hub on a different hostname, same build", async () => {
    const floyd = await hubConfig("floyd.civic.social");
    const athens = await hubConfig("athens.localhost");

    expect(athens.status).toBe(200);
    expect(athens.body.hub?.id).toBe("athens");
    expect(athens.body.hub?.name).not.toBe(floyd.body.hub?.name);
    expect(athens.body.settings?.["identity.name"]).toBe(
      athens.body.hub?.name,
    );
    expect(athens.body.hub?.space_did).not.toBe(floyd.body.hub?.space_did);
  });

  it("serves no hub for a hostname no hub claims", async () => {
    const { status, body } = await hubConfig("nope.example.com");
    expect(status).toBe(404);
    expect(body.error).toBe("no_hub");
    expect(body.hub).toBeUndefined();
  });

  it("never serves an admin-only setting", async () => {
    // The demo bypass code and the beta allowlist are sign-in and membership
    // controls. A public endpoint that hands them out is not a config
    // endpoint, it is a disclosure.
    const { body } = await hubConfig("floyd.civic.social");
    const keys = Object.keys(body.settings ?? {});
    for (const forbidden of [
      "beta.allowlist",
      "beta.demo_bypass_code",
      "beta.demo_mode",
      "people.admin_emails",
      "people.board_emails",
      "people.brief_recipients",
      "email.from_address",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys.some((k) => k.startsWith("people."))).toBe(false);
    expect(keys.some((k) => k.startsWith("email."))).toBe(false);
  });

  it("caches privately, so no shared cache can cross hubs", async () => {
    const { cacheControl } = await hubConfig("floyd.civic.social");
    expect(cacheControl).toContain("private");
  });
});
