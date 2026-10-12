// The hub's typed errors (Audit 4, F2). A refusal a person can act on is
// thrown as one of these; its class decides the HTTP status, never the text of
// its message. Anything else that reaches the HTTP layer is unexpected: the
// person gets a plain message and a reference, the log gets the full error
// (src/http/route.ts).
//
// The response body, for every error the hub answers (BUILD-PLAN "Error
// responses"):
//
//   { "error": "<a sentence a person can read>", "code": "<snake_case>", "ref"?: "<8 hex>" }
//
// `error` is what the UI shows; `code` is what code branches on; `ref` is on
// unexpected and unavailable answers and appears in the log line beside the
// full error. 429 and 503 also send Retry-After when the thrower knows it.
//
// A leaf module: it imports nothing, so the database layer, services, process
// handlers and third-party plugins can all throw these.

export interface CivicErrorOptions {
  /** Seconds before trying again; sent as Retry-After. */
  retryAfterSeconds?: number;
  /** The underlying error, for the log. Never sent to the client. */
  cause?: unknown;
}

/** The base: a refusal or failure whose message is safe to show a person. */
export class CivicError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: string, message: string, opts: CivicErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/** 400: the request itself is wrong (a missing field, a bad value, a rule it breaks). */
export class ValidationError extends CivicError {
  constructor(message: string, code = "invalid_request", opts?: CivicErrorOptions) {
    super(400, code, message, opts);
  }
}

/** 401: not signed in, or the session has ended. */
export class UnauthorizedError extends CivicError {
  constructor(message = "Sign in to continue.", code = "sign_in_required", opts?: CivicErrorOptions) {
    super(401, code, message, opts);
  }
}

/** 403: signed in, and not allowed to do this. */
export class ForbiddenError extends CivicError {
  constructor(message = "You don't have permission to do that.", code = "forbidden", opts?: CivicErrorOptions) {
    super(403, code, message, opts);
  }
}

/** 404: no such thing, or not one this caller may know about. */
export class NotFoundError extends CivicError {
  constructor(message = "Not found.", code = "not_found", opts?: CivicErrorOptions) {
    super(404, code, message, opts);
  }
}

/** 409: the request is fine, but the thing it acts on is not in a state that allows it. */
export class ConflictError extends CivicError {
  constructor(message: string, code = "conflict", opts?: CivicErrorOptions) {
    super(409, code, message, opts);
  }
}

/** 413: the request (an upload) is larger than allowed. */
export class PayloadTooLargeError extends CivicError {
  constructor(message: string, code = "too_large", opts?: CivicErrorOptions) {
    super(413, code, message, opts);
  }
}

/** 429: a limit refused it; try again later. */
export class RateLimitedError extends CivicError {
  constructor(message: string, code = "rate_limited", opts?: CivicErrorOptions) {
    super(429, code, message, opts);
  }
}

/** 503: something the request needs is not available right now. */
export class UnavailableError extends CivicError {
  constructor(
    message = "This isn't available right now. Please try again in a moment.",
    code = "unavailable",
    opts?: CivicErrorOptions,
  ) {
    super(503, code, message, opts);
  }
}

export function isCivicError(err: unknown): err is CivicError {
  return err instanceof CivicError;
}

/** The shape of every error response. */
export interface ErrorBody {
  error: string;
  code: string;
  ref?: string;
}

/** What a person reads when something failed that we did not expect. */
export function unexpectedMessage(ref: string): string {
  return `Something went wrong on our side, and it may not have been saved. Reload the page and try again. (Reference ${ref})`;
}

/** The default code for a status, for errors that name only a status (the console's). */
export function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "sign_in_required";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "too_large";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    default:
      return status >= 500 ? "internal_error" : "invalid_request";
  }
}
