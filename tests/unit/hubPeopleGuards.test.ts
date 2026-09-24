import { describe, it, expect, vi } from "vitest";
import { runWithHub } from "../../src/config/hubContext.js";
import { handleSetHubPeople } from "../../src/controllers/hubPeopleController.js";
import type { Hub } from "../../src/models/hub.js";
import type { Request, Response } from "express";

/**
 * The guards on POST /admin/hub/people, and the order they run in.
 *
 * ORDER IS THE PROPERTY UNDER TEST, not an implementation detail. Every
 * rejection below happens BEFORE the one-time code is consumed, and a code is
 * single-use: an admin who mistypes an address should not also have to go and
 * fetch another code, and — more importantly — a rejected change must leave
 * the hub exactly as it was, including the code the caller still holds.
 *
 * That ordering is also what makes these testable at all. The step-up and the
 * write both need a database; the guards do not, so a test that reaches one
 * of them and stops has proved the guard without needing a stack. If a future
 * change moves the code check earlier, these tests hang or fail on a database
 * call, which is the right kind of loud.
 */

const ATHENS: Hub = {
  id: "athens",
  hostname: "athens.example",
  name: "Athens Civic Hub",
  jurisdiction_code: null,
  jurisdiction_name: "Athens, Virginia",
  space_did: "did:web:athens.example",
  protocol_hub_id: "civic-hub-athens",
  space_type: "civic-hub",
  status: "active",
  mode: "demo",
  created_at: "2026-09-23T00:00:00Z",
  updated_at: "2026-09-23T00:00:00Z",
};

/** A response that records what the handler said instead of sending it. */
function fakeRes(signedIn = true) {
  const out = { status: 0, body: undefined as any };
  const res = {
    locals: signedIn
      ? { authUser: { id: "user_1", email: "admin@athens.example" } }
      : {},
    status(code: number) {
      out.status = code;
      return this;
    },
    json(payload: unknown) {
      out.status = out.status || 200;
      out.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, out };
}

function post(body: unknown, signedIn = true) {
  const { res, out } = fakeRes(signedIn);
  const req = { body } as Request;
  return runWithHub(ATHENS, {}, () => handleSetHubPeople(req, res)).then(() => out);
}

describe("the admin roster refuses a change before it spends a code", () => {
  it("refuses to remove the last admin", async () => {
    // A hub with an empty roster has nobody who can put an administrator
    // back: requireAdmin fails closed, every /admin route answers 503, and
    // the only repair is a database write.
    const out = await post({ admin_emails: [], code: "123456" });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/at least one admin/i);
  });

  it("treats a list of blanks as empty, not as a list", async () => {
    // The same mistake with more typing.
    const out = await post({ admin_emails: ["", "   "], code: "123456" });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/at least one admin/i);
  });

  it("refuses something that is not an email address", async () => {
    // These are printed in logs and mailed to; a value that is not an address
    // is a silently broken admin, which looks like a permissions bug later.
    const out = await post({
      admin_emails: ["moderator@athens.example", "not an address"],
      code: "123456",
    });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/not an email address/i);
  });

  it("refuses a body that is not a list", async () => {
    const out = await post({ admin_emails: "moderator@athens.example", code: "1" });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/must be an array/i);
  });

  it("requires a confirmation code even when the change is valid", async () => {
    // The step-up. An open admin tab is not enough to change who is an admin.
    const out = await post({ admin_emails: ["moderator@athens.example"] });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/confirmation code is required/i);
  });

  it("refuses an unauthenticated caller before anything else", async () => {
    const out = await post({ admin_emails: [], code: "123456" }, false);
    expect(out.status).toBe(401);
  });

  it("allows an empty BOARD list — only admins are load-bearing", async () => {
    // Emptying the board roster is recoverable by any admin, so it is not
    // guarded. It should reach the code check and stop there.
    const out = await post({ board_emails: [] });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/confirmation code is required/i);
  });
});

describe("the roster endpoints are actually mounted, and behind requireAdmin", () => {
  it("registers the three routes under /admin", async () => {
    // Not white-box pedantry. The API-layer tests for this endpoint can only
    // reach the boundary — every /admin/* path answers 401 to an anonymous
    // caller because requireAdmin is mounted router-wide — so an endpoint
    // that was never mounted would pass all of them. This is what says the
    // route exists.
    const router = (await import("../../src/routes/adminRoutes.js")).default;
    const layers = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;

    const routes = layers
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods)[0].toUpperCase()} ${l.route!.path}`);

    expect(routes).toContain("GET /hub/people");
    expect(routes).toContain("POST /hub/people");
    expect(routes).toContain("POST /hub/people/request-code");
  });

  it("puts requireAdmin ahead of every route in the file", async () => {
    const router = (await import("../../src/routes/adminRoutes.js")).default;
    const layers = (router as unknown as {
      stack: Array<{ route?: unknown; name: string }>;
    }).stack;
    const firstRoute = layers.findIndex((l) => l.route);
    const guard = layers.findIndex((l) => !l.route && l.name === "requireAdmin");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(firstRoute);
  });
});
