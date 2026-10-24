/**
 * Shared test helpers for Civic Hub API tests.
 *
 * These helpers hit the running dev server via fetch. The server must be
 * running on API_BASE before tests execute.
 */

/**
 * Overridable so a second checkout or session can run the API layer against
 * its own server without taking port 3000 from one that is already up:
 * `CIVIC_API_BASE=http://localhost:3100 npm test`.
 */
export const API_BASE = process.env.CIVIC_API_BASE?.trim() || "http://localhost:3000";
export const UI_BASE = "http://localhost:5173";

/**
 * The server keeps objects in memory (CIVIC_OBJECT_STORE=memory: the
 * run-anywhere CI job, plain Postgres with no Storage). The tests that read
 * Supabase Storage back skip themselves then (ADR-012).
 */
export const NO_OBJECT_STORAGE = process.env.CIVIC_TEST_OBJECT_STORE?.trim() === "memory";

/**
 * A made-up client address for X-Forwarded-For. The server's sign-in rate
 * limits (Audit 2) count per IP; locally the header is taken as given, so a
 * fresh address per sign-in keeps one suite from using up another's hour.
 * Tests of the limits themselves pass one address on purpose.
 */
export function freshTestIp(): string {
  const n = () => Math.floor(Math.random() * 256);
  return `10.${n()}.${n()}.${1 + Math.floor(Math.random() * 254)}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function api(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const { headers, ...rest } = options ?? {};
  return fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      // A fresh client address per request unless the test names one: the
      // sign-in limits count per IP (Audit 2), and a test run must not use up
      // the next run's hour.
      "X-Forwarded-For": freshTestIp(),
      ...(headers as Record<string, string> | undefined),
    },
  });
}

export async function apiJson<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await api(path, options);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Auth helpers — use CIVIC_DEMO_BYPASS_CODE (000000) for dev auth
// ---------------------------------------------------------------------------

const BYPASS_CODE = "000000";

/**
 * Sign in with an email and get a session token.
 * Uses the demo bypass code (CIVIC_DEMO_BYPASS_CODE=000000).
 */
async function signIn(email: string): Promise<{ token: string; userId: string }> {
  const ip = { "X-Forwarded-For": freshTestIp() };
  await api("/auth/request-code", {
    method: "POST",
    headers: ip,
    body: JSON.stringify({ email }),
  });

  const { status, body } = await apiJson<{
    token?: string;
    user?: { id: string };
    error?: string;
  }>("/auth/verify", {
    method: "POST",
    headers: ip,
    body: JSON.stringify({ email, code: BYPASS_CODE }),
  });

  if (status !== 200 || !body.token || !body.user) {
    throw new Error(
      `Failed to sign in as ${email}: ${body.error ?? `status ${status}`}`,
    );
  }

  return { token: body.token, userId: body.user.id };
}

/**
 * Get an auth token for a resident user (non-admin, residency affirmed).
 */
export async function getResidentToken(): Promise<string> {
  const { token } = await signIn(`test-resident-${Date.now()}@civic.social`);

  // Affirm residency. full_name is required for accounts that don't have one
  // yet (added when voting privacy/identity was hardened), so send it here —
  // otherwise every resident-gated endpoint answers 403 in tests.
  await api("/auth/residency", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ affirm: true, full_name: "Test Resident" }),
  });

  return token;
}

/**
 * Get an auth token for an unauthenticated user (no residency).
 */
export async function getBasicToken(): Promise<string> {
  const { token } = await signIn(`test-visitor-${Date.now()}@civic.social`);
  return token;
}

/**
 * Helper to make authenticated requests.
 */
export function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Trigger the debug seed endpoint to ensure test data is loaded.
 * Idempotent — safe to call multiple times.
 */
export async function ensureSeedData(): Promise<void> {
  // POST and a hub admin's since Audit 2. The dev hub (CIVIC_DEV_HUB, Athens
  // in CI and the launch configs) answers on a bare localhost.
  const { mintSession } = await import("./adminSession.js");
  const hub = process.env.CIVIC_TEST_DEV_HUB ?? "athens";
  const token = await mintSession(hub, process.env.CIVIC_TEST_DEV_HUB_ADMIN ?? `admin+${hub}@example.test`);
  const res = await api("/debug/seed", { method: "POST", headers: authHeaders(token) });
  // 409 reseed_blocked is the usual answer once any review exists on the hub
  // (review_turns is append-only): the data already there stands, and tests
  // must not assume the seed's own events are the newest. Anything else is a
  // broken seed, which used to pass unnoticed.
  if (res.status === 200) return;
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  if (res.status === 409 && body.code === "reseed_blocked") return;
  throw new Error(`POST /debug/seed answered ${res.status} ${JSON.stringify(body)}`);
}

// ---------------------------------------------------------------------------
// Type helpers for common response shapes
// ---------------------------------------------------------------------------

export interface ProcessSummary {
  id: string;
  type: string;
  title: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

/** GET /events response — events are wrapped in { events: [...], count: N } */
export interface EventsResponse {
  events: CivicEventResponse[];
  count: number;
}

export interface CivicEventResponse {
  id: string;
  version: string;
  event_type: string;
  timestamp: string;
  process_id: string;
  actor: string;
  jurisdiction: string;
  action_url: string;
  source: { hub_id: string; hub_url: string };
  data: Record<string, unknown>;
  meta: { visibility: string };
}

/** GET /search response — hits wrapped in { hits: [...], total, query } */
export interface SearchResponse {
  hits: { process_id: string; type: string; title: string; [key: string]: unknown }[];
  total: number;
  query: { q: string; sort: string; limit: number; offset: number };
}
