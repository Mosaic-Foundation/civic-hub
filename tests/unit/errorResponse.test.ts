// The one error answer (Audit 4, F2): status from the error's type, a plain
// message and a code, never raw text from an unexpected error; the log gets
// the full error and reportError() a redacted line with the route pattern.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  CivicError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
} from "../../src/errors/index.js";
import { errorResponse, route, routePattern, sendError } from "../../src/http/route.js";
import { HubDbError } from "../../src/db/forHub.js";
import { ProcessChangedError, VoteClosedError } from "../../src/db/atomic.js";
import { PluginDisabledError } from "../../src/services/pluginGate.js";
import { redactValues } from "../../src/utils/redact.js";

function fakeRes() {
  const state: { status?: number; body?: unknown; headers: Record<string, string>; ended: boolean } = {
    headers: {},
    ended: false,
  };
  const res = {
    headersSent: false,
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      state.headers[k] = v;
    },
    end() {
      state.ended = true;
    },
  };
  return { res: res as unknown as Response & { headersSent: boolean }, state };
}

const req = { method: "POST", baseUrl: "/process", route: { path: "/:id/action" }, originalUrl: "/process/proc_1234abcd/action" } as unknown as Request;

afterEach(() => vi.restoreAllMocks());

describe("status comes from the error's type", () => {
  it.each([
    [new ValidationError("Bad."), 400, "invalid_request"],
    [new UnauthorizedError(), 401, "sign_in_required"],
    [new ForbiddenError(), 403, "forbidden"],
    [new NotFoundError(), 404, "not_found"],
    [new ConflictError("Taken.", "already_submitted"), 409, "already_submitted"],
    [new PayloadTooLargeError("Too big."), 413, "too_large"],
    [new RateLimitedError("Slow down."), 429, "rate_limited"],
    [new UnavailableError(), 503, "unavailable"],
  ])("%s", (err, status, code) => {
    const out = errorResponse(err, "abcd1234");
    expect(out.status).toBe(status);
    expect(out.body.code).toBe(code);
    expect(out.body.error).toBe((err as Error).message);
    expect(out.unexpected).toBe(false);
  });

  it("the existing typed errors answer through the same path", () => {
    const changed = errorResponse(new ProcessChangedError("version 3"));
    expect(changed.status).toBe(409);
    // Audit 3's message, with nothing appended: the detail is for the log.
    expect(changed.body).toEqual({ error: "This changed while you were acting on it. Reload and try again.", code: "process_changed" });
    expect(errorResponse(new VoteClosedError()).body.code).toBe("vote_closed");
    expect(errorResponse(new PluginDisabledError("vote", "Votes")).status).toBe(404);
  });

  it("the same message text in a plain Error is not a refusal", () => {
    const out = errorResponse(new Error("Process not found"), "abcd1234");
    expect(out.status).toBe(500);
    expect(out.unexpected).toBe(true);
  });

  it("a 503 carries the reference; a 4xx does not", () => {
    expect(errorResponse(new UnavailableError(), "abcd1234").body.ref).toBe("abcd1234");
    expect(errorResponse(new ValidationError("x"), "abcd1234").body.ref).toBeUndefined();
  });

  it("the body parser's refusals answer 400 and 413 in words", () => {
    expect(errorResponse(Object.assign(new SyntaxError("Unexpected token"), { status: 400, type: "entity.parse.failed" }))).toMatchObject({
      status: 400,
      body: { code: "invalid_body" },
    });
    expect(errorResponse(Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large" }))).toMatchObject({
      status: 413,
      body: { code: "too_large" },
    });
  });
});

describe("an unexpected error", () => {
  it("answers a plain message with a reference, never the database's text", () => {
    const err = new HubDbError('users: duplicate key value violates unique constraint "users_email_key"', "23505", "Key (email)=(a@b.c) already exists.");
    const out = errorResponse(err, "abcd1234");
    expect(out.status).toBe(500);
    expect(out.body).toEqual({
      error: "Something went wrong on our side, and it may not have been saved. Reload the page and try again. (Reference abcd1234)",
      code: "internal_error",
      ref: "abcd1234",
    });
    expect(JSON.stringify(out.body)).not.toMatch(/users|duplicate|a@b\.c/);
  });

  it("logs the full error and reports a redacted line with the route pattern", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, state } = fakeRes();
    sendError(req, res, new HubDbError('rpc transition_process: value "someone@example.com" for proc_9f8e7d6c5b', "P0001", "Key (email)=(x@y.z)"));
    expect(state.status).toBe(500);
    const lines = logged.mock.calls.map((c) => c.map(String).join(" "));
    // The deployment log has the full error, with the reference.
    const full = lines.find((l) => l.startsWith("[http]"))!;
    expect(full).toContain("someone@example.com");
    const ref = (state.body as { ref: string }).ref;
    expect(full).toContain(`ref=${ref}`);
    // reportError's line has no value from the message, and the pattern, not the URL.
    const report = lines.find((l) => l.startsWith("[civic-error:http.unexpected]"))!;
    expect(report).toContain(`ref=${ref}`);
    expect(report).toContain("route=/process/:id/action");
    expect(report).toContain("db_code=P0001");
    expect(report).toContain("rpc transition_process");
    expect(report).not.toMatch(/someone@example\.com|x@y\.z|proc_9f8e7d6c5b|proc_1234abcd/);
  });

  it("a stream already under way is ended, not answered twice", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, state } = fakeRes();
    res.headersSent = true;
    sendError(req, res, new Error("boom"));
    expect(state.ended).toBe(true);
    expect(state.status).toBeUndefined();
  });
});

describe("route()", () => {
  it("answers a rejected handler through sendError", async () => {
    const { res, state } = fakeRes();
    await new Promise<void>((done) => {
      route(async () => {
        throw new ConflictError("Draft has already been submitted", "already_submitted");
      })(req, res, () => {});
      setImmediate(done);
    });
    expect(state.status).toBe(409);
    expect(state.body).toEqual({ error: "Draft has already been submitted", code: "already_submitted" });
  });

  it("answers a synchronous throw too, and sets Retry-After", () => {
    const { res, state } = fakeRes();
    route(() => {
      throw new RateLimitedError("Slow down.", "rate_limited", { retryAfterSeconds: 60 });
    })(req, res, () => {});
    expect(state.status).toBe(429);
    expect(state.headers["Retry-After"]).toBe("60");
  });

  it("the route pattern, never the URL", () => {
    expect(routePattern(req)).toBe("/process/:id/action");
    expect(routePattern({ baseUrl: "", route: undefined } as unknown as Request)).toBe("(unmatched)");
  });

  it("a CivicError subclass keeps its own name for the log", () => {
    expect(new ConflictError("x").name).toBe("ConflictError");
    expect(new CivicError(418, "teapot", "x").status).toBe(418);
  });
});

describe("redactValues", () => {
  it.each([
    ['Key (email)=(someone@example.com) already exists.', "Key (email)=(…) already exists."],
    ['invalid input syntax for type uuid: "not-a-uuid"', 'invalid input syntax for type uuid: "…"'],
    ["write to someone@example.com failed", "write to [email] failed"],
    ["process proc_9f8e7d6c5b4a not found", "process proc_[id] not found"],
    ["fetch https://example.com/a?b=c failed", "fetch [url] failed"],
    ["code 123456 expired", "code [n] expired"],
    ["token 3q2-7wEVlFAbcdEfGh1234567890xyz", "token [token]"],
  ])("%s", (input, output) => {
    expect(redactValues(input)).toBe(output);
  });

  it("keeps the names that make a line searchable", () => {
    expect(redactValues("rpc search_processes: function take_control_code_attempt failed")).toBe(
      "rpc search_processes: function take_control_code_attempt failed",
    );
  });
});
