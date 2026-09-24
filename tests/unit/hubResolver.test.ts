import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The resolver is the tenancy boundary: it decides which hub's world a
// request is allowed to see. Everything downstream trusts it, so the cases
// that matter are the ones where it must refuse — a hostname no hub claims, a
// hub that is paused, and the development-only overrides, which must not
// exist in production because a query parameter that changes which tenant you
// are is not a convenience, it is a hole.
//
// Pure by construction: the registry is mocked, so these run in CI, which has
// no database. See TESTING.md, "Running integration tests in CI".

const mocks = vi.hoisted(() => ({
  getHubByHostname: vi.fn(),
  getHubBySlug: vi.fn(),
  fetchHubSettings: vi.fn(),
}));

vi.mock("../../src/db/hubs.js", () => ({
  getHubByHostname: mocks.getHubByHostname,
  getHubBySlug: mocks.getHubBySlug,
  listActiveHubs: vi.fn(),
  invalidateHubCache: vi.fn(),
}));

// The resolver loads the hub's settings into the request scope. That is a
// database read, and this layer has no database.
vi.mock("../../src/db/hubSettingsStore.js", () => ({
  fetchHubSettings: mocks.fetchHubSettings,
  fetchHubSettingRows: vi.fn(),
  writeHubSetting: vi.fn(),
  writeHubSettings: vi.fn(),
  invalidateHubSettings: vi.fn(),
}));

const {
  resolveHub,
  resolveHubForHostname,
  normalizeHostname,
  isLocalHostname,
  devHubSlugFromHostname,
  devDefaultHubSlug,
  prefersJson,
} = await import("../../src/middleware/hub.js");

const { hubSlugRejectionReason, isReservedHubSlug, isWellFormedHubSlug } =
  await import("../../src/models/hub.js");

function hub(overrides: Record<string, unknown> = {}) {
  return {
    id: "floyd",
    hostname: "floyd.civic.social",
    name: "Floyd Civic Hub",
    jurisdiction_code: "us-va-floyd",
    jurisdiction_name: "Floyd County, Virginia",
    space_did: "did:web:floyd.civic.social",
    protocol_hub_id: "civic-hub-local",
    space_type: "civic-hub",
    status: "active",
    created_at: "2026-09-22T00:00:00Z",
    updated_at: "2026-09-22T00:00:00Z",
    ...overrides,
  };
}

/** Minimal Express-shaped request. `accepts` mirrors the real negotiation. */
function fakeReq(opts: {
  host: string;
  path?: string;
  accept?: string;
  query?: Record<string, string>;
}) {
  const accept = opts.accept ?? "*/*";
  return {
    headers: { host: opts.host },
    hostname: opts.host.split(":")[0],
    path: opts.path ?? "/",
    query: opts.query ?? {},
    accepts(types: string[]) {
      // A browser asks for text/html explicitly and wins with it; anything
      // sending the wildcard takes the first type offered.
      if (accept.includes("text/html")) return "html";
      return types[0];
    },
  } as never;
}

function fakeRes() {
  const state = {
    statusCode: 0,
    body: undefined as unknown,
    type: "",
    headers: {} as Record<string, string>,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    type(t: string) {
      state.type = t;
      return res;
    },
    send(body: unknown) {
      state.body = body;
      return res;
    },
    set(k: string, v: string) {
      state.headers[k] = v;
      return res;
    },
    state,
  };
  return res;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.getHubByHostname.mockReset();
  mocks.getHubBySlug.mockReset();
  mocks.getHubByHostname.mockResolvedValue(null);
  mocks.getHubBySlug.mockResolvedValue(null);
  mocks.fetchHubSettings.mockReset();
  mocks.fetchHubSettings.mockResolvedValue({});
  process.env.NODE_ENV = "development";
  delete process.env.CIVIC_DEV_HUB;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("hostname normalization", () => {
  it("lowercases, and drops the port and a trailing dot", () => {
    expect(normalizeHostname("Floyd.Civic.Social:3000")).toBe("floyd.civic.social");
    expect(normalizeHostname("floyd.civic.social.")).toBe("floyd.civic.social");
    expect(normalizeHostname("  LOCALHOST:5173 ")).toBe("localhost");
  });

  it("keeps an IPv6 literal intact", () => {
    expect(normalizeHostname("[::1]:3000")).toBe("[::1]");
  });

  it("survives a missing Host header", () => {
    expect(normalizeHostname(undefined)).toBe("");
    expect(normalizeHostname("")).toBe("");
  });
});

describe("development hostname rules", () => {
  it("recognizes the shapes that mean this machine", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("athens.localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("floyd.civic.social")).toBe(false);
  });

  it("reads the slug out of <slug>.localhost", () => {
    expect(devHubSlugFromHostname("athens.localhost")).toBe("athens");
  });

  it("refuses to guess when there is more than one label", () => {
    expect(devHubSlugFromHostname("a.b.localhost")).toBeNull();
    expect(devHubSlugFromHostname("localhost")).toBeNull();
  });

  it("rejects a label that is not a well-formed slug", () => {
    expect(devHubSlugFromHostname("-bad-.localhost")).toBeNull();
  });

  it("defaults a bare localhost to floyd, or to CIVIC_DEV_HUB", () => {
    expect(devDefaultHubSlug()).toBe("floyd");
    process.env.CIVIC_DEV_HUB = "athens";
    expect(devDefaultHubSlug()).toBe("athens");
  });

  it("ignores a malformed CIVIC_DEV_HUB rather than looking up nonsense", () => {
    process.env.CIVIC_DEV_HUB = "not a slug";
    expect(devDefaultHubSlug()).toBe("floyd");
  });
});

describe("resolveHubForHostname", () => {
  it("matches an exact hostname", async () => {
    mocks.getHubByHostname.mockResolvedValue(hub());
    const found = await resolveHubForHostname("floyd.civic.social");
    expect(found?.id).toBe("floyd");
    expect(mocks.getHubBySlug).not.toHaveBeenCalled();
  });

  it("returns null for a hostname no hub claims", async () => {
    expect(await resolveHubForHostname("nope.example.com")).toBeNull();
  });

  it("falls back to the slug in <slug>.localhost", async () => {
    mocks.getHubBySlug.mockResolvedValue(hub({ id: "athens" }));
    const found = await resolveHubForHostname("athens.localhost");
    expect(found?.id).toBe("athens");
    expect(mocks.getHubBySlug).toHaveBeenCalledWith("athens");
  });

  it("honours the ?hub= override on a local hostname", async () => {
    mocks.getHubBySlug.mockResolvedValue(hub({ id: "athens" }));
    const found = await resolveHubForHostname("localhost", "athens");
    expect(found?.id).toBe("athens");
  });

  it("ignores both overrides in production", async () => {
    process.env.NODE_ENV = "production";
    expect(await resolveHubForHostname("athens.localhost", "athens")).toBeNull();
    expect(mocks.getHubBySlug).not.toHaveBeenCalled();
  });

  it("never applies the overrides to a real hostname", async () => {
    expect(await resolveHubForHostname("floyd.civic.social", "athens")).toBeNull();
    expect(mocks.getHubBySlug).not.toHaveBeenCalled();
  });
});

describe("resolveHub middleware", () => {
  it("sets req.hub and continues for a known hostname", async () => {
    mocks.getHubByHostname.mockResolvedValue(hub());
    const req = fakeReq({ host: "floyd.civic.social" });
    const res = fakeRes();
    const next = vi.fn();
    await resolveHub(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as { hub?: { id: string } }).hub?.id).toBe("floyd");
  });

  it("answers an unknown hostname with 404 JSON for a fetch", async () => {
    const req = fakeReq({ host: "nope.example.com" });
    const res = fakeRes();
    const next = vi.fn();
    await resolveHub(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.state.statusCode).toBe(404);
    expect(res.state.body).toEqual({ error: "no_hub" });
  });

  it("answers an unknown hostname with a plain page for a browser", async () => {
    const req = fakeReq({ host: "nope.example.com", accept: "text/html" });
    const res = fakeRes();
    await resolveHub(req, res as never, vi.fn());
    expect(res.state.statusCode).toBe(404);
    expect(String(res.state.body)).toContain("No hub here");
  });

  it("names no hub on the dead-end page", async () => {
    // A request that resolved to nothing has no identity that could
    // legitimately appear, and one hub's branding on another's hostname is
    // how tenancy leaks start.
    mocks.getHubByHostname.mockResolvedValue(null);
    const req = fakeReq({ host: "nope.example.com", accept: "text/html" });
    const res = fakeRes();
    await resolveHub(req, res as never, vi.fn());
    expect(String(res.state.body)).not.toContain("Floyd");
  });

  it("answers a suspended hub with 503, not 404", async () => {
    // The hub exists and is coming back; a 404 tells crawlers to forget it.
    mocks.getHubByHostname.mockResolvedValue(hub({ status: "suspended" }));
    const req = fakeReq({ host: "floyd.civic.social" });
    const res = fakeRes();
    const next = vi.fn();
    await resolveHub(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.state.statusCode).toBe(503);
    expect(res.state.body).toEqual({ error: "hub_suspended" });
  });

  it("lets /health through without a hub", async () => {
    const req = fakeReq({ host: "nope.example.com", path: "/health" });
    const res = fakeRes();
    const next = vi.fn();
    await resolveHub(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.state.statusCode).toBe(0);
  });

  it("lets the cron surface through without a hub", async () => {
    const req = fakeReq({ host: "deploy.vercel.app", path: "/internal/digest/run" });
    const res = fakeRes();
    const next = vi.fn();
    await resolveHub(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("reports a registry failure as an outage, not a wrong address", async () => {
    mocks.getHubByHostname.mockRejectedValue(new Error("connection refused"));
    const req = fakeReq({ host: "floyd.civic.social" });
    const res = fakeRes();
    await resolveHub(req, res as never, vi.fn());
    expect(res.state.statusCode).toBe(503);
    expect(res.state.body).toEqual({ error: "hub_registry_unavailable" });
  });
});

describe("content negotiation", () => {
  it("gives HTML to a browser and JSON to a fetch", () => {
    expect(prefersJson(fakeReq({ host: "x", accept: "text/html" }))).toBe(false);
    expect(prefersJson(fakeReq({ host: "x", accept: "*/*" }))).toBe(true);
  });
});

describe("hub slugs", () => {
  it("rejects every reserved slug", () => {
    for (const slug of ["www", "admin", "api", "polis", "representative", "demo", "staging", "dev", "mail", "app"]) {
      expect(isReservedHubSlug(slug)).toBe(true);
      expect(hubSlugRejectionReason(slug)).toContain("reserved");
    }
  });

  it("rejects a reserved slug whatever its casing or padding", () => {
    expect(isReservedHubSlug("  ADMIN ")).toBe(true);
  });

  it("accepts an ordinary slug", () => {
    expect(hubSlugRejectionReason("floyd")).toBeNull();
    expect(hubSlugRejectionReason("new-river-valley")).toBeNull();
  });

  it("enforces the same shape the database constraint does", () => {
    expect(isWellFormedHubSlug("a")).toBe(false); // too short
    expect(isWellFormedHubSlug("-floyd")).toBe(false); // leading hyphen
    expect(isWellFormedHubSlug("floyd-")).toBe(false); // trailing hyphen
    expect(isWellFormedHubSlug("Floyd")).toBe(false); // uppercase
    expect(isWellFormedHubSlug("has_underscore")).toBe(false);
    expect(isWellFormedHubSlug("a".repeat(33))).toBe(false); // too long
    expect(isWellFormedHubSlug("a".repeat(32))).toBe(true);
  });
});
