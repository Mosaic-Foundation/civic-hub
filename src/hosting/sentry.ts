// The `errors` adapter's Sentry implementation (hosting layer, ADR-012,
// ADR-006): delivers a report src/utils/errorTracking.ts built and scrubbed,
// as Sentry's envelope, by hand. Any Sentry-compatible collector (Better
// Stack's, GlitchTip) takes it.
//
// Settings: CIVIC_ERROR_DSN (unset or malformed: off), CIVIC_ERROR_ENVIRONMENT.
// A failing collector never fails the request or job that reported: bounded
// by a timeout, errors swallowed (one warning per instance).

import { hostingEnv, env } from "../config/env.js";
import type { ErrorSink } from "../adapters/errors.js";

/** How long a send may take. */
export const SEND_TIMEOUT_MS = 2000;

export interface Dsn {
  url: string;
  key: string;
  raw: string;
}

/** `https://<key>@<host>/<project>` → the envelope endpoint and the key. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project || u.protocol !== "https:") return null;
    return { url: `https://${u.host}/api/${project}/envelope/`, key: u.username, raw: dsn };
  } catch {
    return null;
  }
}

/** The envelope body: header, item header, event, one per line. */
export function envelope(dsn: Dsn, event: Record<string, unknown>): string {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsn.raw }),
    JSON.stringify({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) }),
    payload,
  ].join("\n");
}

let warned = false;

/** The `errors` adapter: Sentry, on when CIVIC_ERROR_DSN parses. `fetchImpl` for tests. */
export function sentryErrors(fetchImpl: typeof fetch = (...a) => fetch(...a)): ErrorSink {
  return {
    name: "sentry",
    enabled: () => parseDsn(hostingEnv.CIVIC_ERROR_DSN) !== null,
    environment: () => hostingEnv.CIVIC_ERROR_ENVIRONMENT ?? (env.NODE_ENV === "production" ? "production" : "development"),
    async send(event) {
      const dsn = parseDsn(hostingEnv.CIVIC_ERROR_DSN);
      if (!dsn) return;
      try {
        const res = await fetchImpl(dsn.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=civic-hub/1.0`,
          },
          body: envelope(dsn, event),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn(`[error-tracking] send failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  };
}

/** Tests only. */
export function resetSentryForTests(): void {
  warned = false;
}
