// Error tracking (operations shell, ADR-006): the scrubber stands between
// every error and the network. These prove that an email address and a
// request body never reach the payload, whatever path they take in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  captureError,
  flushErrors,
  parseStack,
  resetErrorTrackingForTests,
  scrub,
  scrubPath,
} from "../../src/utils/errorTracking.js";
import { reportError } from "../../src/utils/reportError.js";
import { envelope, parseDsn, resetSentryForTests, sentryErrors } from "../../src/hosting/sentry.js";
import { installAdapters } from "../../src/adapters/index.js";

const DSN = "https://abc123publickey@o42.ingest.sentry.io/4507";
const EMAIL = "jane.resident@example.org";
const BODY = JSON.stringify({ email: EMAIL, comment: "My street floods every spring", password: "hunter2hunter2" });

function fakeFetch() {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body), headers: init?.headers as Record<string, string> });
    return new Response("{}", { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => {
  resetErrorTrackingForTests();
  resetSentryForTests();
  // The scrubber is the engine's; Sentry's envelope is the hosting layer's
  // errors adapter (ADR-012). Tested together, as they run.
  installAdapters({ errors: sentryErrors() });
  vi.stubEnv("CIVIC_ERROR_DSN", DSN);
  vi.stubEnv("CIVIC_ERROR_ENVIRONMENT", "dev");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the scrubber", () => {
  it("removes email addresses, quoted values, cookies, tokens and query strings", () => {
    const out = scrub(
      `Key (email)=(${EMAIL}) already exists; cookie: civic_session=abcdef0123456789abcdef; ` +
        `fetching https://x.test/a?email=${EMAIL} with "${BODY}" Authorization: Bearer eyJhbGciOi123456789012345678`,
    );
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain("example.org");
    expect(out).not.toContain("street floods");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("civic_session=abc");
    expect(out).not.toContain("eyJhbGciOi");
  });

  it("keeps a page path's shape and drops its query, fragment and tokens", () => {
    expect(scrubPath(`/sign-in/link?email=${EMAIL}&code=123456#x`)).toBe("/sign-in/link");
    expect(scrubPath("/unsubscribe/digest/a8F3kq0Zr9LmT4pQ7wXy2Bv5Nc1Hd6Js")).toBe("/unsubscribe/digest/[token]");
    expect(scrubPath(`/people/${encodeURIComponent(EMAIL)}`)).toBe("/people/[email]");
  });
});

describe("the payload", () => {
  it("carries the type, stack, hub, route, release and environment, and no person's data", () => {
    const err = new TypeError(`Cannot read properties of undefined for ${EMAIL} with body ${BODY}`);
    const event = buildEvent({
      code: "http.unexpected",
      message: err.message,
      error: err,
      hub: "athens",
      tags: { route: "/process/:id/action", method: "POST", status: 500, note: `from ${EMAIL}` },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("street floods");
    expect(text).not.toContain("hunter2");
    expect(event).toMatchObject({
      platform: "node",
      release: "0123456789abcdef0123456789abcdef01234567",
      environment: "dev",
      transaction: "/process/:id/action",
      tags: { code: "http.unexpected", hub: "athens", route: "/process/:id/action", method: "POST", status: "500" },
    });
    const ex = (event.exception as { values: Array<{ type: string; stacktrace: { frames: Array<{ filename: string }> } }> })
      .values[0];
    expect(ex.type).toBe("TypeError");
    // Paths cut to the project: no machine's directory layout.
    expect(ex.stacktrace.frames.some((f) => f.filename.startsWith("tests/") || f.filename.startsWith("node_modules/"))).toBe(
      true,
    );
    expect(text).not.toContain("/Users/");
    // Never a request, a user or headers.
    expect(event).not.toHaveProperty("request");
    expect(event.user).toEqual({ ip_address: null });
  });

  it("an error reported through reportError() reaches the network scrubbed, in Sentry's envelope", async () => {
    const { fn, calls } = fakeFetch();
    vi.stubGlobal("fetch", fn);
    reportError("descriptor.civic.vote", `descriptor failed for ${EMAIL}`, { route: "/process/:id" }, new Error(BODY));
    await flushErrors();
    vi.unstubAllGlobals();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect(calls[0].headers["X-Sentry-Auth"]).toContain("sentry_key=abc123publickey");
    expect(calls[0].body).not.toContain(EMAIL);
    expect(calls[0].body).not.toContain("street floods");
    expect(calls[0].body).not.toContain("hunter2");
    const [header, item, payload] = calls[0].body.split("\n");
    expect(JSON.parse(header).dsn).toBe(DSN);
    expect(JSON.parse(item).type).toBe("event");
    expect(JSON.parse(payload).tags.code).toBe("descriptor.civic.vote");
  });
});

describe("sending", () => {
  it("is off without a DSN", async () => {
    vi.stubEnv("CIVIC_ERROR_DSN", "");
    const { fn, calls } = fakeFetch();
    vi.stubGlobal("fetch", fn);
    captureError({ code: "x", message: "y" });
    await flushErrors();
    expect(calls).toHaveLength(0);
  });

  it("sends the same error once a minute from one instance, so a loop does not spend the quota", async () => {
    const { fn, calls } = fakeFetch();
    vi.stubGlobal("fetch", fn);
    for (let i = 0; i < 5; i++) captureError({ code: "jobs.failed", message: "boom" });
    captureError({ code: "jobs.failed", message: "another" });
    await flushErrors();
    expect(calls).toHaveLength(2);
  });

  it("never throws, and gives up after the timeout, when the collector is down or hangs", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", down);
    expect(() => captureError({ code: "a", message: "b" })).not.toThrow();
    await flushErrors();
    const hang = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    vi.stubGlobal("fetch", hang);
    captureError({ code: "c", message: "d" });
    const t = Date.now();
    await flushErrors(50);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("reads a DSN, and refuses one that is not https", () => {
    expect(parseDsn(DSN)).toMatchObject({ url: "https://o42.ingest.sentry.io/api/4507/envelope/", key: "abc123publickey" });
    expect(parseDsn("http://k@host/1")).toBeNull();
    expect(parseDsn("not a dsn")).toBeNull();
    expect(envelope(parseDsn(DSN)!, { event_id: "e" }).split("\n")).toHaveLength(3);
  });

  it("parses V8 and Firefox stacks, oldest call first", () => {
    const frames = parseStack("Error: x\n    at inner (/var/task/src/a.ts:2:3)\n    at outer (/var/task/src/b.ts:4:5)");
    expect(frames.map((f) => f.filename)).toEqual(["src/b.ts", "src/a.ts"]);
    expect(parseStack("render@https://h.example/assets/i.js?v=1:1:9\n")[0]).toBeUndefined();
    expect(parseStack("Error\nrender@https://h.example/assets/i.js?v=1:1:9")[0].filename).toBe("assets/i.js");
  });
});
