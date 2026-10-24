// civic.auth's store (src/modules/civic.auth/store.ts): the hub's accounts,
// sessions, sign-in codes and member invites on the hub in scope, and the
// platform's rate-limit counters (src/db/rateLimit.ts), which every hub, the
// console and the start page share.

import { forHub, HubDbError, type HubDb } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { rateLimitBucket, retryAt, takeRateLimit } from "../db/rateLimit.js";
import { invalidateHubRoles } from "../db/hubRolesStore.js";
import { currentHubId } from "../config/hubContext.js";
import { CODE_RULES, type CodeRow, type CodeStore } from "../modules/civic.auth/codeRules.js";
import type { AuthStore, HubSessions, SessionRow } from "../modules/civic.auth/store.js";

function db(): HubDb {
  return forHub(currentHubId());
}

/** This hub's codes (sign_in_codes, 20261014000000), for the shared code rules. */
function hubCodeStore(hubDb: HubDb): CodeStore {
  return {
    async live(email) {
      const rows = await hubDb
        .from("sign_in_codes")
        .select<{ expires_at: string; attempts: number }>("expires_at, attempts")
        .eq("email", email)
        .gt("expires_at", new Date().toISOString());
      return rows.filter((r) => r.attempts < CODE_RULES.maxTries).map((r) => r.expires_at);
    },
    async insert(row) {
      await hubDb.from("sign_in_codes").insert(row);
    },
    async take(by, maxTries) {
      const rows = await hubDb.rpc<CodeRow[]>("take_sign_in_attempt", {
        p_email: "email" in by ? by.email : null,
        p_link_hash: "linkHash" in by ? by.linkHash : null,
        p_max: maxTries,
      });
      return Array.isArray(rows) ? rows : [];
    },
    async spend(id) {
      const spent = await hubDb.from("sign_in_codes").delete().eq("id", id).select<{ id: string }>("id");
      return spent.length > 0;
    },
    async clear(email) {
      await hubDb.from("sign_in_codes").delete().eq("email", email);
    },
  };
}

export const authStoreImpl: AuthStore = {
  hubCodes: () => hubCodeStore(db()),

  takeRateLimit: (checks) => takeRateLimit(checks),
  rateLimitRetryAt: (check) => retryAt(check),
  rateLimitBucket: (scope, by, value) => rateLimitBucket(scope, by, value),

  async userByEmail(email) {
    return db().from("users").select("*").eq("email", email).maybeSingle();
  },

  async userById(userId) {
    return db().from("users").select("*").eq("id", userId).maybeSingle();
  },

  async clearDemoOnly(userId) {
    await db().from("users").update({ demo_only: false }).eq("id", userId);
  },

  async markEmailVerified(userId) {
    return db().from("users").update({ email_verified: true }).eq("id", userId).select().single();
  },

  async insertUser(row) {
    try {
      return await db().from("users").insert(row).select().single();
    } catch (err) {
      // 23505 = unique_violation — another request created the user first.
      if (err instanceof HubDbError && err.code === "23505") return "duplicate";
      throw err;
    }
  },

  async updateUser(userId, patch) {
    return db().from("users").update(patch).eq("id", userId).select().maybeSingle();
  },

  async deleteAccount(userId, email) {
    const hubDb = db();
    if (email) await hubDb.from("sign_in_codes").delete().eq("email", email.toLowerCase());
    await hubDb.from("users").delete().eq("id", userId);
  },

  invalidateHubRoles: (hubId) => invalidateHubRoles(hubId),

  async insertSession(row) {
    // Stamped with the hub it was minted on, by forHub.
    await db().from("sessions").insert(row);
  },

  async spendSession(tokenHash) {
    const spent = await db()
      .from("sessions")
      .delete()
      .eq("token", tokenHash)
      .select<SessionRow>("user_id, expires_at, assurance");
    return spent[0] ?? null;
  },

  sessionsOn(hubId): HubSessions {
    const hubDb = forHub(hubId);
    return {
      async byTokenHash(tokenHash) {
        return hubDb.from("sessions").select<SessionRow>("user_id, expires_at, assurance").eq("token", tokenHash).maybeSingle();
      },
      async deleteByTokenHash(tokenHash) {
        await hubDb.from("sessions").delete().eq("token", tokenHash);
      },
      async userById(userId) {
        return hubDb.from("users").select("*").eq("id", userId).maybeSingle();
      },
    };
  },

  async liveInviteEmail(linkHash, now) {
    const live = await db()
      .from("hub_invites")
      .select<{ email: string }>("email")
      .eq("link_hash", linkHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    return live ? live.email : null;
  },

  async spendInvite(linkHash, now) {
    const spent = await db()
      .from("hub_invites")
      .update({ used_at: now })
      .eq("link_hash", linkHash)
      .is("used_at", null)
      .select<{ email: string }>("email");
    return spent[0]?.email ?? null;
  },

  async markDigestSent(hubId, userId, timestamp) {
    await forHub(hubId).from("users").update({ last_digest_sent_at: timestamp }).eq("id", userId);
  },

  async subscribedUsers(hubId) {
    // Paged: a hub can have more than 1,000 of these (PostgREST's cap).
    return readAll((from, to) =>
      forHub(hubId)
        .from("users")
        .select("*")
        .not("digest_frequency_days", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
  },

  async clearAll() {
    const hubDb = db();
    // Supabase requires a filter on DELETE to avoid accidental full-table wipes.
    // neq("<col>", "") matches every row since our IDs/emails are non-empty;
    // forHub confines it to this hub.
    await hubDb.from("sign_in_codes").delete().neq("email", "");
    await hubDb.from("sessions").delete().neq("token", "");
    await hubDb.from("users").delete().neq("id", "");
  },
};
