// The `errors` adapter's fake (ADR-012): keeps every scrubbed report in memory.

import type { ErrorSink } from "../errors.js";

export function fakeErrors(): ErrorSink & { sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  return {
    name: "fake",
    sent,
    enabled: () => true,
    environment: () => "test",
    async send(event) {
      if (sent.length >= 1000) sent.shift();
      sent.push(event);
    },
  };
}
