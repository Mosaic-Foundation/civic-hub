// The console's and the start page's rate limits (the console split, step
// 3b): the hubs' rules (src/db/rateLimit.ts), counted in the console's own
// table, console.rate_limit_hits, through console.rate_limit_take() and
// console.rate_limit_retry_at() (20261111010000), as civic_console.
//
// Handed to the shared code rules (src/modules/civic.auth/codeRules.ts) on
// the console's and the start page's realms, so their emailed codes are
// counted here too.

import { env, isProductionEnv } from "../config/env.js";
import { rateLimitBucket, type RateLimitCheck } from "../db/rateLimit.js";
import type { RateLimiter } from "../modules/civic.auth/codeRules.js";
import { q } from "./db.js";

export const HOUR_MS = 60 * 60 * 1000;

/** Are rate limits on? Always in production (as src/config/devFlags.ts). */
function enabled(): boolean {
  return env.CIVIC_RATE_LIMITS !== "off" || isProductionEnv();
}

export interface ConsoleRateLimits extends RateLimiter {
  /** Give back the latest hit in each bucket (an attempt that did nothing for the person). */
  release(checks: readonly RateLimitCheck[]): Promise<void>;
}

export const consoleRateLimits: ConsoleRateLimits = {
  rateLimitBucket,

  async takeRateLimit(checks) {
    if (checks.length === 0 || !enabled()) return null;
    const { rows } = await q<{ i: number }>("SELECT console.rate_limit_take($1::text[], $2::int[], $3::int[]) AS i", [
      checks.map((c) => rateLimitBucket(c.scope, c.by, c.value)),
      checks.map((c) => c.limit),
      checks.map((c) => Math.ceil(c.windowMs / 1000)),
    ]);
    const index = Number(rows[0]?.i ?? 0);
    return index > 0 ? checks[index - 1]! : null;
  },

  async rateLimitRetryAt(check) {
    if (!enabled()) return null;
    const { rows } = await q<{ at: Date | null }>("SELECT console.rate_limit_retry_at($1, $2, $3) AS at", [
      rateLimitBucket(check.scope, check.by, check.value),
      check.limit,
      Math.ceil(check.windowMs / 1000),
    ]);
    const at = rows[0]?.at;
    return at ? new Date(at) : null;
  },

  async release(checks) {
    if (checks.length === 0 || !enabled()) return;
    for (const c of checks) {
      await q(
        `DELETE FROM console.rate_limit_hits
          WHERE id = (SELECT id FROM console.rate_limit_hits WHERE bucket = $1 ORDER BY at DESC LIMIT 1)`,
        [rateLimitBucket(c.scope, c.by, c.value)],
      );
    }
  },
};
