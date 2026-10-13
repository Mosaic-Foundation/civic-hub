// Development-only switches, and the guard that keeps them off in production.
//
// Three env flags weaken the hub on purpose for local work and tests:
//   CIVIC_ALLOW_SEED=true   — /debug/seed and auto-seed may wipe and reseed a hub
//   CIVIC_RATE_LIMITS=off   — sign-in and assistant rate limits are skipped
//   CIVIC_SSRF_ALLOW_PRIVATE=true — server-side fetches may reach private
//                             addresses (a Polis on localhost)
//   CIVIC_POLIS_FAKE=on     — conversations talk to an in-memory Polis behind
//                             the real adapter (src/debug/fakePolis.ts), so the
//                             conformance suite can walk them without the
//                             network, and make Polis down, slow or erroring
//   CIVIC_COC_FAKE=on       — the Code of Conduct check is a fixed rule, not
//                             the AI (src/debug/fakeCodeOfConduct.ts), so tests
//                             can make a submission pass, be flagged, or find
//                             the check down
//
// With NODE_ENV=production (every Vercel deployment, dev and production) all
// five are refused: the flag reads as unset, and the boot check reports it, once,
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

/** Do conversations use the in-memory Polis? Never in production. */
export function polisFakeEnabled(): boolean {
  return env.CIVIC_POLIS_FAKE === "on" && !isProduction();
}

/** Is the Code of Conduct check the fixed test rule? Never in production. */
export function cocFakeEnabled(): boolean {
  return env.CIVIC_COC_FAKE === "on" && !isProduction();
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
  if (env.CIVIC_POLIS_FAKE === "on") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_POLIS_FAKE=on is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_COC_FAKE === "on") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_COC_FAKE=on is set in production and is ignored. Remove it from this deployment.", {});
  }
  if (env.CIVIC_RATE_LIMITS === "off") {
    reportError("CIVIC_DEV_FLAG", "CIVIC_RATE_LIMITS=off is set in production and is ignored. Remove it from this deployment.", {});
  }
}
