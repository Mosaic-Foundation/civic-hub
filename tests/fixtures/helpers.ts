/**
 * Shared test helpers for Civic Hub API tests.
 *
 * These helpers hit the running dev server via fetch. The server must be
 * running on API_BASE before tests execute.
 */

export const API_BASE = "http://localhost:3000";
export const UI_BASE = "http://localhost:5173";

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
  await api("/auth/request-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  const { status, body } = await apiJson<{
    token?: string;
    user?: { id: string };
    error?: string;
  }>("/auth/verify", {
    method: "POST",
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
  await api("/debug/seed");
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
