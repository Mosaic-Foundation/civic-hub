// The `deliberation` adapter's Polis implementations (hosting layer,
// ADR-012): what is ours about reaching Polis. The plugin's own adapter
// (packages/civic.polis_deliberation/adapter/) speaks Polis's API.
//
//   polisService      the hub setting's address (or the default), the
//                     POLIS_AUTH_TOKEN service token, the SSRF-guarded fetch
//                     (a hub's admin chooses the address: Audit 2).
//   fakePolisService  the in-memory Polis (src/debug/fakePolis.ts), short
//                     timeouts; summaries are made without a model.

import { hostingEnv } from "../config/env.js";
import { guardedFetch } from "../utils/ssrfGuard.js";
import { DEFAULT_POLIS_URL } from "../shared/polisUrl.js";
import {
  FAKE_POLIS_BASE_URL,
  FAKE_POLIS_RETRY_DELAYS_MS,
  FAKE_POLIS_TIMEOUT_MS,
  fakePolisFetch,
} from "../debug/fakePolis.js";
import type { DeliberationService } from "../adapters/deliberation.js";

export const polisService: DeliberationService = {
  name: "polis",
  fake: false,
  baseUrl: (setting) => setting || DEFAULT_POLIS_URL,
  authToken: () => hostingEnv.POLIS_AUTH_TOKEN ?? "",
  fetch: guardedFetch,
};

export const fakePolisService: DeliberationService = {
  name: "fake-polis",
  fake: true,
  baseUrl: () => FAKE_POLIS_BASE_URL,
  authToken: () => hostingEnv.POLIS_AUTH_TOKEN || "fake-polis-service-token",
  fetch: fakePolisFetch,
  timeoutMs: FAKE_POLIS_TIMEOUT_MS,
  retryDelaysMs: FAKE_POLIS_RETRY_DELAYS_MS,
};
