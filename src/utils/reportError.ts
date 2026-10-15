// reportError — the one place an error the operators must see is reported.
//
// It writes one line to the deployment's logs and, when CIVIC_ERROR_DSN is
// set, sends the error to error tracking (src/utils/errorTracking.ts, ADR-006)
// with its stack, the hub, the route and the release. Callers pass a stable
// code and plain details; the line starts with `[civic-error:<code>]` so the
// logs can be searched by code, and in Sentry the code is a tag.
//
// Details must never carry a person's data (an email, a name, a filter's
// value): this goes to a log and to a third party. The tracker scrubs every
// string again before it leaves, as a second line of defence, not the first.

import { captureError } from "./errorTracking.js";

export type ErrorDetails = Record<string, string | number | boolean | null | undefined>;

/**
 * @param error the thrown value, when there is one: its type and stack go to
 *   error tracking. Its message does not: `message` is what the caller chose
 *   to say, already redacted.
 */
export function reportError(code: string, message: string, details: ErrorDetails = {}, error?: unknown): void {
  const fields = Object.entries(details)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.error(`[civic-error:${code}] ${message}${fields ? ` (${fields})` : ""}`);
  captureError({ code, message, tags: details, error });
}
