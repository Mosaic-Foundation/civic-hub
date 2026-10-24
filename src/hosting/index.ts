// The hosting layer (ADR-012): everything that is ours rather than the
// engine's. The engine (src/processes, src/modules, src/authz, src/events,
// src/services, …) calls the adapters in src/adapters/; this file chooses
// their implementations, once, at startup. Only the composition roots
// (src/app.ts, src/index.ts, api/), src/control/ and scripts/ import from
// here (lint: civic/hosting-boundary).
//
// What lives in this layer: the vendors' implementations below; the
// console's reads of the operations services (./opsStatus.ts); and, outside
// src/, vercel.json (rewrites, crons, headers), api/ (the Vercel function
// and the share-card renderer api/og.ts), supabase/config.toml and the
// Supabase CLI link (scripts/release.sh, scripts/db-push.sh).
//
// Choosing: CIVIC_FAKE_ADAPTERS=on (development and tests, never
// production) installs every fake (src/adapters/fakes/); otherwise each
// adapter is its vendor, which reads its own settings and is "not
// configured" without them. The two older switches select one fake each:
// CIVIC_POLIS_FAKE the deliberation service, CIVIC_COC_FAKE the Code of
// Conduct check's rule. CIVIC_OBJECT_STORE=memory keeps objects in memory
// (the run-anywhere job: plain Postgres has no storage).
//
// A self-hosted deployment on other vendors replaces the implementations
// here, one file each, and nothing in the engine changes.

import { installAdapters, adapterNames, type Adapters } from "../adapters/index.js";
import { fakeAdapters, memoryObjectStore } from "../adapters/fakes/index.js";
import { fakeAdaptersEnabled, polisFakeEnabled } from "../config/devFlags.js";
import { hostingEnv } from "../config/env.js";
import { anthropicProvider } from "./anthropic.js";
import { resendTransport } from "./resend.js";
import { youtubeTranscripts } from "./youtube.js";
import { polisService, fakePolisService } from "./polis.js";
import { sentryErrors } from "./sentry.js";
import { healthchecksHeartbeat } from "./healthchecks.js";
import { supabaseStorage } from "./supabaseStorage.js";

/** The implementations for this deployment's settings. */
export function hostingAdapters(): Adapters {
  const fake = fakeAdaptersEnabled();
  const real: Omit<Adapters, "deliberation"> = {
    ai: anthropicProvider,
    mail: resendTransport,
    video: youtubeTranscripts,
    errors: sentryErrors(),
    heartbeat: healthchecksHeartbeat,
    objectStore: supabaseStorage,
  };
  const chosen = fake ? { ...fakeAdapters(), objectStore: supabaseStorage } : real;
  return {
    ...chosen,
    objectStore: hostingEnv.CIVIC_OBJECT_STORE === "memory" ? memoryObjectStore() : chosen.objectStore,
    deliberation: polisFakeEnabled() ? fakePolisService : polisService,
  };
}

let done = false;

/** Install this deployment's adapters. Idempotent; the composition roots call it first. */
export function installHosting(): void {
  if (done) return;
  done = true;
  installAdapters(hostingAdapters());
  const names = adapterNames();
  const fakes = Object.entries(names).filter(([, n]) => /fake|memory/.test(n));
  if (fakes.length > 0) {
    console.log(`[hosting] in-memory adapters: ${fakes.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
}
