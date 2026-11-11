// Where the console and the start page keep their emailed codes
// (console.platform_sign_in_codes, 20261014000000, moved 20261111000000), for
// the shared rules in src/modules/civic.auth/codeRules.ts: lock the code, not
// the person. As civic_console (./db.ts); counted in the console's own rate
// limits (./rateLimits.ts).

import { q } from "./db.js";
import { consoleRateLimits } from "./rateLimits.js";
import { resolveTimeZone } from "../utils/hubTime.js";
import { CODE_RULES, type CodeRow, type CodeStore, type Realm } from "../modules/civic.auth/codeRules.js";

export type PlatformRealm = "console" | "start";
export type CodePurpose = "sign_in" | "step_up";

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export function platformCodeStore(realm: PlatformRealm, purpose: CodePurpose): CodeStore {
  return {
    async live(email) {
      const { rows } = await q<{ expires_at: unknown; attempts: number }>(
        `SELECT expires_at, attempts FROM console.platform_sign_in_codes
          WHERE realm = $1 AND purpose = $2 AND email = $3 AND expires_at > now()`,
        [realm, purpose, email],
      );
      return rows.filter((r) => r.attempts < CODE_RULES.maxTries).map((r) => iso(r.expires_at));
    },
    async insert(row) {
      await q(
        `INSERT INTO console.platform_sign_in_codes (realm, purpose, email, code_hash, link_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [realm, purpose, row.email, row.code_hash, row.link_hash, row.expires_at],
      );
    },
    async take(by, maxTries) {
      const { rows } = await q<CodeRow & { expires_at: unknown }>(
        "SELECT id, email, code_hash, link_hash, attempts, expires_at FROM console.take_platform_sign_in_attempt($1, $2, $3, $4, $5)",
        [realm, purpose, "email" in by ? by.email : null, "linkHash" in by ? by.linkHash : null, maxTries],
      );
      return rows.map((r) => ({ ...r, expires_at: iso(r.expires_at) }));
    },
    async spend(id) {
      const { rowCount } = await q("DELETE FROM console.platform_sign_in_codes WHERE id = $1", [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}

/** Withdraw one code before it was ever delivered (its email could not be sent). */
export async function withdrawPlatformCode(realm: PlatformRealm, purpose: CodePurpose, email: string, codeHash: string): Promise<void> {
  await q("DELETE FROM console.platform_sign_in_codes WHERE realm = $1 AND purpose = $2 AND email = $3 AND code_hash = $4", [
    realm,
    purpose,
    email,
    codeHash,
  ]);
}

/**
 * The realm for the console or the start page. There is no hub, so no hub
 * time zone: the page sends the browser's (`tz`), and a missing or unknown
 * one reads as UTC.
 */
export function platformRealm(realm: PlatformRealm, ipLimits: Realm["ipLimits"], timeZone: unknown): Realm {
  return {
    scope: realm,
    addressKey: (email) => email,
    ipLimits,
    timeZone: resolveTimeZone(typeof timeZone === "string" ? timeZone : null),
    links: false,
    rateLimits: consoleRateLimits,
  };
}
