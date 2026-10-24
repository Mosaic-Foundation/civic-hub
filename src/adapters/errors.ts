// The `errors` adapter (ADR-012, ADR-006): where a scrubbed error report goes.
// The engine builds the report and scrubs it (src/utils/errorTracking.ts:
// one scrubber between every error and the network); the sink only delivers
// it. Hosting: src/hosting/sentry.ts. Fake: src/adapters/fakes/errors.ts.

export interface ErrorSink {
  readonly name: string;
  /** Switched on for this deployment (a DSN). Off, errors go to the log only. */
  enabled(): boolean;
  /** The environment tag ("production", "dev", "development"). */
  environment(): string;
  /** Deliver one scrubbed report; resolves on any failure (never throws). */
  send(event: Record<string, unknown>): Promise<void>;
}
