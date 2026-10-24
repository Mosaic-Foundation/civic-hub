// The `deliberation` adapter (ADR-012): how the conversation plugin reaches
// its external service (Polis, a Tier 3 plugin). The plugin's own
// anti-corruption adapter (src/shared/polis_deliberation/adapter/) speaks the
// service's API; this supplies what is ours: the address, the service token,
// the fetch every call goes through, and (for the fake) a summarizer that
// needs no model. Hosting: src/hosting/polis.ts, which also supplies the fake
// (src/debug/fakePolis.ts) when CIVIC_FAKE_ADAPTERS or CIVIC_POLIS_FAKE is on.

/** The fetch the service's calls go through (the hub's SSRF-guarded one, or the fake's). */
export type DeliberationFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

export interface DeliberationService {
  readonly name: string;
  /** The in-memory service (tests, development). */
  readonly fake: boolean;
  /** The service's address, given the hub's own setting (unset: the default). */
  baseUrl(hubSetting: string | undefined): string;
  /** The token the service accepts; "" when none is set. */
  authToken(): string;
  /** Every call to the service goes through this. */
  fetch: DeliberationFetch;
  /** Shorter timeouts and retries for the fake. */
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
}
