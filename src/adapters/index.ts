// The engine's outside services, by name (ADR-012).
//
// The engine calls these interfaces and never a vendor. The hosting layer
// (src/hosting/index.ts) installs the implementations once, at startup:
// the real ones where their settings are set, the in-memory fakes
// (./fakes/) when CIVIC_FAKE_ADAPTERS is on (development, tests,
// the run-anywhere CI job). Before anything is installed, each adapter is its
// "none" implementation below: not configured, which is how a deployment
// without that service has always behaved (no AI, mail logged, no
// heartbeats, errors to the log).
//
// Adding an adapter: its interface in its own file here, a "none" default
// below, a fake in ./fakes/, the real one in src/hosting/ (chosen in
// installHosting()), one contract test that runs only when its key is set,
// and a line in ADR-012's list.

import type { AiProvider } from "./ai.js";
import type { MailTransport } from "./mail.js";
import type { VideoTranscripts } from "./video.js";
import type { DeliberationService } from "./deliberation.js";
import type { ErrorSink } from "./errors.js";
import type { HeartbeatSink } from "./heartbeat.js";
import type { ObjectStore } from "./objectStore.js";
import { guardedFetch } from "../utils/ssrfGuard.js";
import { DEFAULT_POLIS_URL } from "../shared/polisUrl.js";

export interface Adapters {
  ai: AiProvider;
  mail: MailTransport;
  video: VideoTranscripts;
  deliberation: DeliberationService;
  errors: ErrorSink;
  heartbeat: HeartbeatSink;
  objectStore: ObjectStore;
}

export type AdapterName = keyof Adapters;

const unavailable = (what: string) => () => {
  throw new Error(`${what}: no adapter is installed on this deployment`);
};

/** What a deployment without each service gets. */
export function noneAdapters(): Adapters {
  return {
    ai: {
      name: "none",
      configured: () => false,
      defaultModel: () => "none",
      complete: unavailable("ai"),
      converse: unavailable("ai"),
    },
    mail: {
      name: "none",
      configured: () => false,
      notConfiguredReason: () => "no mail transport is configured",
      defaultSender: () => "Civic Hub <noreply@localhost>",
      isSandboxSender: () => false,
      send: async () => ({ sent: false, error: "no mail transport is configured" }),
    },
    video: { name: "none", transcript: unavailable("video") },
    deliberation: {
      name: "none",
      fake: false,
      baseUrl: (setting) => setting || DEFAULT_POLIS_URL,
      authToken: () => "",
      fetch: guardedFetch,
    },
    errors: { name: "none", enabled: () => false, environment: () => "development", send: async () => {} },
    heartbeat: { name: "none", ping: async () => {} },
    objectStore: {
      name: "none",
      putPublic: unavailable("objectStore"),
      put: unavailable("objectStore"),
      signedUrl: unavailable("objectStore"),
      listAll: async () => null,
      remove: async () => {},
    },
  };
}

let installed: Adapters = noneAdapters();

/** The adapters in force. */
export function adapters(): Adapters {
  return installed;
}

/** Install implementations (the hosting layer at startup; tests). Unnamed ones keep theirs. */
export function installAdapters(next: Partial<Adapters>): void {
  installed = { ...installed, ...next };
}

/** Which implementation each adapter is, for /health and the startup log. */
export function adapterNames(): Record<AdapterName, string> {
  return Object.fromEntries(Object.entries(installed).map(([k, v]) => [k, v.name])) as Record<AdapterName, string>;
}
