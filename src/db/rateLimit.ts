// @civic-raw-client-importer: rate-limit counters are platform data (rate_limit_hits), shared by every hub, the console and the start page.
// Rate limits kept in Postgres, so they hold across serverless instances.
//
// One table (rate_limit_hits) and one function (rate_limit_take,
// 20261011100000) for every limit on the platform: hub sign-in, the console's
// sign-in and step-up, the start page, and assistant calls. The function
// locks each bucket, counts, and records the attempt only when every bucket
// is under its limit, in one transaction, so two racing requests cannot both
// take the last slot. A refused attempt is not recorded: waiting is enough to
// get back in.
//
// Buckets are "<scope>:<by>:<sha256>": the IP, address or account id is
// hashed before it reaches the database.

import { getDb } from "./client.js";
import { rateLimitsEnabled } from "../config/devFlags.js";
import { sha256Hex } from "../utils/hash.js";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface RateLimitCheck {
  /** What is limited, e.g. "hub.request_code". */
  scope: string;
  /** What it is counted by, e.g. "ip", "email", "user", "hub". */
  by: string;
  /** The value counted by, hashed before it is stored. */
  value: string;
  limit: number;
  windowMs: number;
}

export function rateLimitBucket(scope: string, by: string, value: string): string {
  return `${scope}:${by}:${sha256Hex(`civic-rate:${value}`)}`;
}

/**
 * Record one attempt against every check, or return the first check already
 * at its limit (and record nothing). Null means allowed.
 */
export async function takeRateLimit(checks: readonly RateLimitCheck[]): Promise<RateLimitCheck | null> {
  if (checks.length === 0 || !rateLimitsEnabled()) return null;
  const { data, error } = await getDb().rpc("rate_limit_take", {
    p_buckets: checks.map((c) => rateLimitBucket(c.scope, c.by, c.value)),
    p_limits: checks.map((c) => c.limit),
    p_window_seconds: checks.map((c) => Math.ceil(c.windowMs / 1000)),
  });
  if (error) throw new Error(`rate_limit_take failed: ${error.message}`);
  const index = Number(data);
  return index > 0 ? checks[index - 1]! : null;
}

/** Thrown by a limit; the HTTP layer answers 429 with its message (src/errors/). */
export { RateLimitedError } from "../errors/index.js";
