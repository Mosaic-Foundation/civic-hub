// One async route wrapper and one error answer for the hub (Audit 4, F2).
//
// Copied from the control plane's route()/fail() (src/control/router.ts) and
// widened: every hub handler is wrapped by route(), every error reaches
// sendError(), and the terminal error handler in app.ts calls sendError() too.
//
//   - A CivicError (src/errors/) answers its own status, code and message.
//   - The body parser's own refusals (bad JSON, too large) answer 400 / 413.
//   - Anything else is unexpected: the person gets a plain message with a
//     reference; the full error and stack go to the log with that reference,
//     and a redacted line (no values, the route pattern rather than the URL)
//     goes through reportError().
//
// No raw database or exception text reaches the client from here.

import { randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CivicError, unexpectedMessage, type ErrorBody } from "../errors/index.js";
import { reportError } from "../utils/reportError.js";
import { redactValues } from "../utils/redact.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * Wrap a handler (or middleware) so a thrown or rejected error answers through
 * sendError(). The returned promise settles once the handler and any error
 * answer are done (Express ignores it; a unit test can await it).
 */
export function route(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<unknown>).then(
          () => undefined,
          (err) => sendError(req, res, err),
        );
      }
    } catch (err) {
      sendError(req, res, err);
    }
    return Promise.resolve();
  };
}

/** The route pattern a request matched (`/process/:id`), never the URL with its ids. */
export function routePattern(req: Request): string {
  const path = typeof req.route?.path === "string" ? req.route.path : "";
  return `${req.baseUrl ?? ""}${path}` || "(unmatched)";
}

function newRef(): string {
  return randomBytes(4).toString("hex");
}

/** The body parser's errors carry a 4xx `status` and a `type`. */
function bodyParserError(err: unknown): { status: number; type: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; type?: unknown };
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500 && typeof e.type === "string") {
    return { status: e.status, type: e.type };
  }
  return null;
}

/** What the body of an error answer is, and its status. Pure apart from the ref. */
export function errorResponse(
  err: unknown,
  ref: string = newRef(),
): { status: number; body: ErrorBody; retryAfterSeconds?: number; unexpected: boolean } {
  if (err instanceof CivicError) {
    const body: ErrorBody = { error: err.message, code: err.code };
    if (err.status >= 500) body.ref = ref;
    return { status: err.status, body, retryAfterSeconds: err.retryAfterSeconds, unexpected: false };
  }
  const parser = bodyParserError(err);
  if (parser) {
    if (parser.status === 413) {
      return { status: 413, body: { error: "That request is too large.", code: "too_large" }, unexpected: false };
    }
    return { status: 400, body: { error: "The request couldn't be read.", code: "invalid_body" }, unexpected: false };
  }
  return { status: 500, body: { error: unexpectedMessage(ref), code: "internal_error", ref }, unexpected: true };
}

/**
 * Log an error nobody expected (or a 503): the full error and stack to the
 * deployment log, and a redacted line through reportError(), both carrying
 * `ref`. Exported for the console and start page, which word their own 500.
 */
export function logUnexpected(req: Request, err: unknown, status: number, ref: string, unexpected = true): void {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  const dbCode = (err as { code?: unknown } | null)?.code;
  // The full error, with its stack, for the deployment log.
  console.error(
    `[http] ${req.method} ${routePattern(req)} ${status} ref=${ref}:`,
    err instanceof Error ? (err.stack ?? message) : message,
    err instanceof Error && err.cause !== undefined ? { cause: err.cause } : "",
  );
  // The searchable line, with no values in it.
  reportError(unexpected ? "http.unexpected" : "http.unavailable", `${name}: ${redactValues(message)}`, {
    ref,
    method: req.method,
    route: routePattern(req),
    status,
    db_code: typeof dbCode === "string" ? dbCode : undefined,
  });
}

/** Answer an error. The one place the hub turns an error into a response. */
export function sendError(req: Request, res: Response, err: unknown): void {
  const ref = newRef();
  const answer = errorResponse(err, ref);
  if (answer.unexpected || answer.status >= 500) logUnexpected(req, err, answer.status, ref, answer.unexpected);

  if (res.headersSent) {
    // A stream already started: the status is sent, so end it.
    res.end();
    return;
  }
  if (answer.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(answer.retryAfterSeconds));
  res.status(answer.status).json(answer.body);
}

/** A fresh reference for an error answer. */
export { newRef };

/** The terminal error handler (app.ts): errors passed to next(err) and thrown by middleware. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  sendError(req, res, err);
}
