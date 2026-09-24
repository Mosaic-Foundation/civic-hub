import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { API_BASE } from "../fixtures/helpers.js";
import { mintSession, storedSetting } from "../fixtures/adminSession.js";

/**
 * The hub admin settings endpoint, over HTTP: every section round-trips, an
 * unknown key is refused, a non-admin is refused, one hub's admin cannot
 * reach another hub's settings, and "restore default" puts the shared
 * template back.
 *
 * Needs the local stack seeded as in CI (see .github/workflows/ci.yml): the
 * admin session is written straight into it by tests/fixtures/adminSession.ts,
 * which refuses any database that is not on this machine. Every value this
 * file changes is put back in afterAll, because tests/api/hubSettings.test.ts
 * asserts on Athens's seeded values.
 *
 * node:http rather than fetch, because the hostname is the variable under
 * test and fetch drops a Host override silently.
 */
const ATHENS = "athens.localhost";
const FLOYD = "floyd.civic.social";
const ATHENS_ADMIN = "admin+athens@example.test";

function call(
  method: string,
  path: string,
  host: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const url = new URL(`${API_BASE}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Accept: "application/json",
          Host: host,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
          } catch {
            reject(new Error(`unparseable (${res.statusCode}): ${raw.slice(0, 120)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let admin = "";
/** Athens's own stored values before this file touched anything. */
let original: Record<string, string> = {};
const touched = new Map<string, Set<string>>();

async function put(section: string, values: Record<string, unknown>) {
  const res = await call("PUT", "/admin/hub/settings", ATHENS, { section, values }, admin);
  // Only an accepted write changed anything. Recording a refused one would put
  // its unknown key into the cleanup write, which would then be refused too.
  if (res.status === 200) {
    const keys = touched.get(section) ?? new Set<string>();
    for (const k of Object.keys(values)) keys.add(k);
    touched.set(section, keys);
  }
  return res;
}

beforeAll(async () => {
  admin = await mintSession("athens", ATHENS_ADMIN);
  const { status, body } = await call("GET", "/admin/hub/settings", ATHENS, undefined, admin);
  expect(status).toBe(200);
  original = body.values;
});

afterAll(async () => {
  for (const [section, keys] of touched) {
    const values: Record<string, string | boolean | number> = {};
    for (const k of keys) {
      const v = original[k] ?? "";
      // Booleans and hours have no "unset"; put back what the form would show.
      if (k.endsWith(".enabled")) values[k] = v === "" ? true : v === "true";
      else if (k.endsWith(".send_hour")) values[k] = v === "" ? 13 : Number(v);
      else values[k] = v;
    }
    const res = await call("PUT", "/admin/hub/settings", ATHENS, { section, values }, admin);
    expect(res.status, `restoring ${section}: ${JSON.stringify(res.body)}`).toBe(200);
  }
});

describe("who may use the settings endpoint", () => {
  it("refuses an anonymous caller", async () => {
    expect((await call("GET", "/admin/hub/settings", ATHENS)).status).toBe(401);
    expect(
      (await call("PUT", "/admin/hub/settings", ATHENS, { section: "identity", values: {} })).status,
    ).toBe(401);
  });

  it("refuses a signed-in resident who is not an admin, with 403", async () => {
    const resident = await mintSession("athens", `settings-resident-${Date.now()}@example.com`);
    expect((await call("GET", "/admin/hub/settings", ATHENS, undefined, resident)).status).toBe(403);
    const write = await call(
      "PUT",
      "/admin/hub/settings",
      ATHENS,
      { section: "identity", values: { "identity.tagline": "not allowed" } },
      resident,
    );
    expect(write.status).toBe(403);
    expect(await storedSetting("athens", "identity.tagline")).toBe(original["identity.tagline"]);
  });
});

describe("one hub's admin cannot reach another hub's settings", () => {
  it("an Athens session is not a session on Floyd's hostname", async () => {
    expect((await call("GET", "/admin/hub/settings", FLOYD, undefined, admin)).status).toBe(401);
    const write = await call(
      "PUT",
      "/admin/hub/settings",
      FLOYD,
      { section: "identity", values: { "identity.tagline": "written from Athens" } },
      admin,
    );
    expect(write.status).toBe(401);
  });

  it("the Athens admin, signed in on Floyd, is not Floyd's admin", async () => {
    const onFloyd = await mintSession("floyd", ATHENS_ADMIN);
    const before = await storedSetting("floyd", "identity.tagline");
    expect((await call("GET", "/admin/hub/settings", FLOYD, undefined, onFloyd)).status).toBe(403);
    const write = await call(
      "PUT",
      "/admin/hub/settings",
      FLOYD,
      { section: "identity", values: { "identity.tagline": "written from Athens" } },
      onFloyd,
    );
    expect(write.status).toBe(403);
    expect(await storedSetting("floyd", "identity.tagline")).toBe(before);
  });

  it("an Athens write leaves Floyd's value alone", async () => {
    const before = await storedSetting("floyd", "legal.operator_name");
    const res = await put("legal", { "legal.operator_name": "Athens Test Operators" });
    expect(res.status).toBe(200);
    expect(await storedSetting("floyd", "legal.operator_name")).toBe(before);
    expect(await storedSetting("athens", "legal.operator_name")).toBe("Athens Test Operators");
  });
});

describe("unknown keys", () => {
  it("are refused by name, and nothing in the write is stored", async () => {
    const res = await put("identity", {
      "identity.tagline": "should not be saved",
      "identity.favourite_colour": "blue",
    });
    expect(res.status).toBe(400);
    expect(res.body.unknown_keys).toEqual(["identity.favourite_colour"]);
    expect(await storedSetting("athens", "identity.tagline")).toBe(original["identity.tagline"]);
    expect(await storedSetting("athens", "identity.favourite_colour")).toBeUndefined();
  });

  it("include keys that exist but are not on the settings page", async () => {
    const res = await put("identity", { "people.admin_emails": '["someone@example.com"]' });
    expect(res.status).toBe(400);
  });

  it("include a real key sent with the wrong section", async () => {
    const res = await put("identity", { "legal.operator_name": "Wrong section" });
    expect(res.status).toBe(400);
  });
});

describe("every section round-trips: save, reload, values match", () => {
  const stamp = Date.now();
  const cases: Array<[string, Record<string, unknown>, Record<string, string>]> = [
    [
      "identity",
      {
        "identity.name": `Round Trip Hub ${stamp}`,
        "identity.label": "Test Label",
        "identity.tagline": `Tagline ${stamp}`,
        "identity.page_title": `Page title ${stamp}`,
        "identity.description": `Description ${stamp}`,
        "identity.banner_url": "https://images.example.test/hubs/athens/banner.webp",
        "identity.banner_alt": "A test banner",
        "identity.logo_url": "https://images.example.test/hubs/athens/logo.webp",
        "identity.theme": "#2A6F4E",
      },
      { "identity.theme": "#2a6f4e" },
    ],
    [
      "copy",
      {
        "copy.intro_body": `Intro ${stamp}`,
        "copy.residency_intro": `Residency ${stamp}`,
        "copy.welcome": `# Welcome ${stamp}\n\nWritten for {HUB_NAME}.`,
        "copy.about": `## About ${stamp}\n\nThis is {HUB_NAME}.`,
        "copy.resident_noun": "neighbour",
        "copy.governing_body_name": "Test Council",
        "copy.governing_body_short": "Council",
      },
      {
        "copy.welcome": `# Welcome ${stamp}\n\nWritten for {HUB_NAME}.\n`,
        "copy.about": `## About ${stamp}\n\nThis is {HUB_NAME}.\n`,
      },
    ],
    [
      "legal",
      {
        "legal.terms": `# Terms ${stamp}\n\nRun by {OPERATOR_NAME}.`,
        "legal.privacy": `# Privacy ${stamp}`,
        "legal.code_of_conduct": `# Conduct ${stamp}\n\nWrite to {CONTACT_EMAIL}.`,
        "legal.proposal_best_practices": `# Guide ${stamp}`,
        "legal.operator_name": `Operators ${stamp}`,
        "legal.contact_email": "Settings-Test@Example.com",
        "legal.who_runs_this": `Run by {OPERATOR_NAME}, ${stamp}.`,
      },
      {
        "legal.terms": `# Terms ${stamp}\n\nRun by {OPERATOR_NAME}.\n`,
        "legal.privacy": `# Privacy ${stamp}\n`,
        "legal.code_of_conduct": `# Conduct ${stamp}\n\nWrite to {CONTACT_EMAIL}.\n`,
        "legal.proposal_best_practices": `# Guide ${stamp}\n`,
        "legal.contact_email": "settings-test@example.com",
      },
    ],
    [
      "email",
      {
        "email.from_name": `Mailer ${stamp}`,
        "email.postal_address": "1 Test Street",
        "plugin.digest.enabled": false,
        "plugin.digest.send_hour": 6,
        "plugin.admin_digest.enabled": true,
      },
      {
        "plugin.digest.enabled": "false",
        "plugin.digest.send_hour": "6",
        "plugin.admin_digest.enabled": "true",
      },
    ],
  ];

  for (const [section, values, normalised] of cases) {
    it(section, async () => {
      const saved = await put(section, values);
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);

      const reloaded = await call("GET", "/admin/hub/settings", ATHENS, undefined, admin);
      expect(reloaded.status).toBe(200);
      for (const [key, sent] of Object.entries(values)) {
        const expected = normalised[key] ?? String(sent);
        expect(reloaded.body.values[key], key).toBe(expected);
        expect(await storedSetting("athens", key), `${key} stored`).toBe(expected);
        expect(reloaded.body.changed[key]?.by, `${key} changed by`).toBe("Settings Test Admin");
      }
    });
  }

  it("identity and copy reach the public config; documents render substituted", async () => {
    const config = await call("GET", "/hub-config", ATHENS);
    expect(config.body.settings["identity.tagline"]).toBe(`Tagline ${stamp}`);
    expect(config.body.settings["identity.logo_url"]).toBe(
      "https://images.example.test/hubs/athens/logo.webp",
    );
    expect(config.body.settings["identity.theme"]).toBe("#2a6f4e");
    // Admin-only keys stay admin-only.
    expect(config.body.settings["plugin.digest.send_hour"]).toBeUndefined();
    expect(config.body.settings["email.postal_address"]).toBeUndefined();

    const docs = await call("GET", "/hub-config/documents", ATHENS);
    expect(docs.body.documents["legal.terms"]).toContain(`Run by Operators ${stamp}.`);
    expect(docs.body.documents["legal.code_of_conduct"]).toContain("settings-test@example.com");
    expect(docs.body.documents["copy.about"]).toContain(`This is Round Trip Hub ${stamp}.`);
  });
});

describe("restore default", () => {
  it("puts the shared template back for a legal document", async () => {
    await put("legal", { "legal.code_of_conduct": "# Our own code\n\nBe kind." });
    expect(await storedSetting("athens", "legal.code_of_conduct")).toBe("# Our own code\n\nBe kind.\n");

    const tpl = await call(
      "GET",
      "/admin/hub/settings/template/legal.code_of_conduct",
      ATHENS,
      undefined,
      admin,
    );
    expect(tpl.status).toBe(200);
    expect(tpl.body.template).toContain("{HUB_NAME}");

    // What the page's "Restore default" does: the template text, saved.
    const restored = await put("legal", { "legal.code_of_conduct": tpl.body.template });
    expect(restored.status).toBe(200);
    // Stored as "": the hub follows the shared template, it does not copy it.
    expect(await storedSetting("athens", "legal.code_of_conduct")).toBe("");

    const docs = await call("GET", "/hub-config/documents", ATHENS);
    const served: string = docs.body.documents["legal.code_of_conduct"];
    const firstLine = tpl.body.template.split("\n")[0];
    expect(served.startsWith(firstLine)).toBe(true);
    expect(served).not.toContain("Our own code");
    expect(served).not.toContain("{HUB_NAME}");
  });

  it("has no default for the Welcome page, and refuses a key it does not know", async () => {
    const welcome = await call(
      "GET",
      "/admin/hub/settings/template/copy.welcome",
      ATHENS,
      undefined,
      admin,
    );
    expect(welcome.status).toBe(404);
    const unknown = await call(
      "GET",
      "/admin/hub/settings/template/identity.nope",
      ATHENS,
      undefined,
      admin,
    );
    expect(unknown.status).toBe(400);
  });
});
