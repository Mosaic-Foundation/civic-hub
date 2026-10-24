// Development-only switches, and the guard that keeps them off in production.
//
// Three env flags weaken the hub on purpose for local work and tests:
//   CIVIC_ALLOW_SEED=true   — /debug/seed and auto-seed may wipe and reseed a hub
//   CIVIC_RATE_LIMITS=off   — sign-in and assistant rate limits are skipped
//   CIVIC_SSRF_ALLOW_PRIVATE=true — server-side fetches may reach private
//                             addresses (a Polis on localhost)
//   CIVIC_FAKE_ADAPTERS=on  — every outside service is its in-memory fake
//                             (src/hosting/index.ts, src/adapters/fakes/):
//                             AI, mail, video, Polis, errors, heartbeats, object
//                             store, and the Code of Conduct check's rule.
//                             What CI, Playwright and the run-anywhere job use
//                             (Architecture 5, ADR-012). The two below are its
//                             older, narrower names, kept for one release.
//   CIVIC_POLIS_FAKE=on     — conversations talk to an in-memory Polis behind
//                             the real adapter (src/debug/fakePolis.ts), so the
//                             conformance suite can walk them without the
//                             network, and make Polis down, slow or erroring
//   CIVIC_COC_FAKE=on       — the Code of Conduct check is a fixed rule, not
//                             the AI (src/debug/fakeCodeOfConduct.ts), so tests
//                             can make a submission pass, be flagged, or find
//                             the check down
//   CIVIC_DASHBOARD_FAKE=on — the console's Dashboard reads each hub's /health
//                             from this server (Host set to the hub), never
//                             the hub's real address, and a hub whose slug
//                             contains "slow" never answers, so tests reach
//                             the timeout (src/control/dashboard/hubHealth.ts)
//
// With NODE_ENV=production (every Vercel deployment, dev and production) all
// seven are refused: the flag reads as unset, and the boot check reports it, once,
// as an error operators see. Refused rather than fatal on purpose: a stray env
// var should not take every hub on the deployment offline, and ignoring it is
// already the safe outcome.

import { env } from "./env.js";
import { reportError } from "../utils/reportError.js";

function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/** May this process seed (wipe and refill) a hub? Never in production. */
export function seedAllowed(): boolean {
  return env.CIVIC_ALLOW_SEED === "true" && !isProduction();
}

/** Are rate limits on? Always in production. */
export function rateLimitsEnabled(): boolean {
  return env.CIVIC_RATE_LIMITS !== "off" || isProduction();
}

/** May a server-side fetch reach a private address? Never in production. */
export function privateFetchAllowed(): boolean {
  return env.CIVIC_SSRF_ALLOW_PRIVATE === "true" && !isProduction();
}

const ON = new Set(["1", "true", "on", "yes"]);

/** Is every outside service its in-memory fake? Never in production. */
export function fakeAdaptersEnabled(): boolean {
  return ON.has((env.CIVIC_FAKE_ADAPTERS ?? "").toLowerCase()) && !isProduction();
}

/** Do conversations use the in-memory Polis? Never in production. */
export function polisFakeEnabled(): boolean {
  return (fakeAdaptersEnabled() || env.CIVIC_POLIS_FAKE === "on") && !isProduction();
}

/** Is the Code of Conduct check the fixed test rule? Never in production. */
export function cocFakeEnabled(): boolean {
  return (fakeAdaptersEnabled() || env.CIVIC_COC_FAKE === "on") && !isProduction();
}

/** Does the Dashboard read hubs' health from this server? Never in production. */
export function dashboardFakeEnabled(): boolean {
  return env.CIVIC_DASHBOARD_FAKE === "on" && !isProduction();
}

let checked = false;

/** Report, once per process, a development flag set where it is refused. */
export function checkDevFlags(): void {
  if (checked) return;
  checked = true;
  if (!isProduction()) return;
  if (env.CIVIC_ALLOW_SEED === "true") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_ALLOW_SEED=true is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_SSRF_ALLOW_PRIVATE === "true") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_SSRF_ALLOW_PRIVATE=true is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_FAKE_ADAPTERS) {
    reportError("CIVIC_DEV_FLAG", "CIVIC_FAKE_ADAPTERS is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_POLIS_FAKE === "on") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_POLIS_FAKE=on is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_COC_FAKE === "on") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_COC_FAKE=on is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_DASHBOARD_FAKE === "on") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_DASHBOARD_FAKE=on is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_RATE_LIMITS === "off") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_RATE_LIMITS=off is set in production and is ignored. Remove it from this deployment.", {});
  }
}
