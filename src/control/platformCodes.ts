// @civic-raw-client-importer: the console's and the start page's codes are platform data, not any hub's.
// Where the console and the start page keep their emailed codes
// (platform_sign_in_codes, 20261014000000), for the shared rules in
// src/modules/civic.auth/codeRules.ts: lock the code, not the person.

import { getDb } from "../db/client.js";
import { resolveTimeZone } from "../utils/hubTime.js";
import { CODE_RULES, type CodeRow, type CodeStore, type Realm } from "../modules/civic.auth/codeRules.js";

export type PlatformRealm = "console" | "start";
export type CodePurpose = "sign_in" | "step_up";

export function platformCodeStore(realm: PlatformRealm, purpose: CodePurpose): CodeStore {
  const table = () => getDb().from("platform_sign_in_codes");
  return {
    async live(email) {
      const { data, error } = await table()
        .select("expires_at, attempts")
        .eq("realm", realm)
        .eq("purpose", purpose)
        .eq("email", email)
        .gt("expires_at", new Date().toISOString());
      if (error) throw new Error(`platform_sign_in_codes read failed: ${error.message}`);
      return ((data ?? []) as Array<{ expires_at: string; attempts: number }>)
        .filter((r) => r.attempts < CODE_RULES.maxTries)
        .map((r) => r.expires_at);
    },
    async insert(row) {
      const { error } = await table().insert({ ...row, realm, purpose });
      if (error) throw new Error(`platform_sign_in_codes write failed: ${error.message}`);
    },
    async take(by, maxTries) {
      const { data, error } = await getDb().rpc("take_platform_sign_in_attempt", {
        p_realm: realm,
        p_purpose: purpose,
        p_email: "email" in by ? by.email : null,
        p_link_hash: "linkHash" in by ? by.linkHash : null,
        p_max: maxTries,
      });
      if (error) throw new Error(`take_platform_sign_in_attempt failed: ${error.message}`);
      return (data ?? []) as CodeRow[];
    },
    async spend(id) {
      const { data, error } = await table().delete().eq("id", id).select("id");
      if (error) throw new Error(`platform_sign_in_codes delete failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
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
  };
}
