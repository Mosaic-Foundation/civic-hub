// The operations services, read for the Dashboard (ADR-007).
//
// Three read-only GETs from the console's server, each turned on by a key in
// the environment and never required:
//   - Healthchecks.io: the backup's `backup-dump` check (HEALTHCHECKS_READ_KEY);
//   - Better Stack: the uptime monitors (BETTERSTACK_API_TOKEN, unset until
//     Better Stack offers a read-only token);
//   - Sentry: errors seen in the last 24 hours (SENTRY_READ_TOKEN, SENTRY_ORG,
//     SENTRY_PROJECT).
// Without its key a source is "not connected" and says how to connect it. A
// slow or failing service is "error" on its own card. Nothing but the key and
// the fixed query is sent. Cached a minute (cache.ts), 5 s timeout each.

import { env } from "../../config/env.js";
import { cached } from "./cache.js";
import type { SectionContext } from "./registry.js";

export const OUTSIDE_TIMEOUT_MS = 5_000;

export type OutsideResult<T> =
  | { state: "connected"; data: T }
  | { state: "not_connected"; setup: string }
  | { state: "error"; message: string };

export interface BackupStatus {
  /** Healthchecks.io's status: new, up, grace, down or paused. */
  status: string;
  last_ping: string | null;
  next_ping: string | null;
}

export interface UptimeStatus {
  up: number;
  total: number;
  monitors: Array<{ name: string; status: string; last_checked_at: string | null }>;
}

export interface ErrorsStatus {
  /** Events in the last 24 hours across the issues returned. */
  events: number;
  issues: number;
  top: Array<{ title: string; count: number; level: string; last_seen: string | null; link: string | null }>;
}

export interface OutsideSection {
  uptime: OutsideResult<UptimeStatus>;
  errors: OutsideResult<ErrorsStatus>;
}

/** The one-line setup each card shows when its key is missing. */
export const SETUP = {
  backup:
    "Healthchecks.io → Project Settings → API Access → create the read-only key; put it in Vercel (civic-hub, Production) as HEALTHCHECKS_READ_KEY and redeploy.",
  uptime:
    "Waiting for a read-only Better Stack token (ADR-007). When one exists: Vercel (civic-hub, Production) → BETTERSTACK_API_TOKEN, then redeploy.",
  errors:
    "Sentry → User Settings → Personal Tokens → a token with project:read and event:read only; put it in Vercel (civic-hub, Production) as SENTRY_READ_TOKEN, with SENTRY_ORG and SENTRY_PROJECT, and redeploy.",
} as const;

type FetchImpl = typeof fetch;

async function getJson(url: string, headers: Record<string, string>, fetchImpl: FetchImpl): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(OUTSIDE_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`the key was refused (${res.status})`);
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.json();
}

function failure(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `no answer in ${OUTSIDE_TIMEOUT_MS / 1000} s`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function read<T>(
  key: string,
  fresh: boolean,
  configured: boolean,
  setup: string,
  load: () => Promise<T>,
): Promise<OutsideResult<T>> {
  if (!configured) return { state: "not_connected", setup };
  try {
    return { state: "connected", data: await cached(key, fresh, load) };
  } catch (err) {
    return { state: "error", message: failure(err) };
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// --- Healthchecks.io --------------------------------------------------------

export function parseBackup(json: unknown): BackupStatus {
  const checks = (json as { checks?: unknown })?.checks;
  const check = Array.isArray(checks) ? (checks[0] as Record<string, unknown> | undefined) : undefined;
  if (!check) throw new Error("no backup-dump check in the project");
  return { status: str(check.status) ?? "unknown", last_ping: str(check.last_ping), next_ping: str(check.next_ping) };
}

export function backupStatus(fresh: boolean, fetchImpl: FetchImpl = fetch): Promise<OutsideResult<BackupStatus>> {
  const key = env.HEALTHCHECKS_READ_KEY;
  return read("outside:backup", fresh, Boolean(key), SETUP.backup, async () =>
    parseBackup(await getJson("https://healthchecks.io/api/v3/checks/?slug=backup-dump", { "X-Api-Key": key! }, fetchImpl)),
  );
}

// --- Better Stack -------------------------------------------------------------

export function parseUptime(json: unknown): UptimeStatus {
  const data = (json as { data?: unknown })?.data;
  const monitors = (Array.isArray(data) ? data : []).map((m) => {
    const a = ((m as { attributes?: Record<string, unknown> })?.attributes ?? {}) as Record<string, unknown>;
    return {
      name: str(a.pronounceable_name) ?? str(a.url) ?? "monitor",
      status: str(a.status) ?? "unknown",
      last_checked_at: str(a.last_checked_at),
    };
  });
  return { up: monitors.filter((m) => m.status === "up").length, total: monitors.length, monitors };
}

export function uptimeStatus(fresh: boolean, fetchImpl: FetchImpl = fetch): Promise<OutsideResult<UptimeStatus>> {
  const token = env.BETTERSTACK_API_TOKEN;
  return read("outside:uptime", fresh, Boolean(token), SETUP.uptime, async () =>
    parseUptime(
      await getJson("https://uptime.betterstack.com/api/v2/monitors?per_page=50", { Authorization: `Bearer ${token}` }, fetchImpl),
    ),
  );
}

// --- Sentry -------------------------------------------------------------------

export function parseErrors(json: unknown): ErrorsStatus {
  const issues = (Array.isArray(json) ? json : []) as Array<Record<string, unknown>>;
  const rows = issues.map((i) => {
    const buckets = (i.stats as { "24h"?: unknown })?.["24h"];
    const count = Array.isArray(buckets)
      ? buckets.reduce((sum: number, b) => sum + (Array.isArray(b) ? Number(b[1]) || 0 : 0), 0)
      : Number(i.count) || 0;
    return {
      title: str(i.title) ?? "Untitled issue",
      count,
      level: str(i.level) ?? "error",
      last_seen: str(i.lastSeen),
      link: str(i.permalink),
    };
  });
  rows.sort((a, b) => b.count - a.count);
  return { events: rows.reduce((s, r) => s + r.count, 0), issues: rows.length, top: rows.slice(0, 5) };
}

export function errorsStatus(fresh: boolean, fetchImpl: FetchImpl = fetch): Promise<OutsideResult<ErrorsStatus>> {
  const token = env.SENTRY_READ_TOKEN;
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;
  return read("outside:errors", fresh, Boolean(token && org && project), SETUP.errors, async () =>
    parseErrors(
      await getJson(
        `https://sentry.io/api/0/projects/${encodeURIComponent(org!)}/${encodeURIComponent(project!)}/issues/?statsPeriod=24h&query=${encodeURIComponent("lastSeen:-24h")}&limit=100`,
        { Authorization: `Bearer ${token}` },
        fetchImpl,
      ),
    ),
  );
}

/** Dashboard section "Uptime and errors". The backup is in the jobs section. */
export async function loadOutside(ctx: SectionContext): Promise<OutsideSection> {
  const [uptime, errors] = await Promise.all([uptimeStatus(ctx.fresh), errorsStatus(ctx.fresh)]);
  return { uptime, errors };
}
