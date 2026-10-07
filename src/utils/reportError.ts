// reportError — the one place an error the operators must see is reported.
//
// Today it writes one line to the deployment's logs. When error tracking
// (Sentry or similar) is connected, it is connected HERE, and every caller
// reports through it without changing (BUILD-PLAN-multi-tenant.md → "Error
// reporting"). Callers pass a stable code and plain details; the line starts
// with `[civic-error:<code>]` so the logs can be searched by code.
//
// Details must never carry a person's data (an email, a name, a filter's
// value): this goes to a log, and later to a third party.

export type ErrorDetails = Record<string, string | number | boolean | null | undefined>;

export function reportError(code: string, message: string, details: ErrorDetails = {}): void {
  const fields = Object.entries(details)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.error(`[civic-error:${code}] ${message}${fields ? ` (${fields})` : ""}`);
}
