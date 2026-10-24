// What civic.auth keeps, as the host supplies it (ADR-012, the database
// convention): the module never imports src/db/. The implementation is
// src/stores/auth.ts, bound at startup by installStores().
//
// The hub's accounts (users), sessions, sign-in codes and member invites are
// all on the hub in scope. The rate-limit counters are platform data shared by
// every hub, the console and the start page, so those methods need no hub.

import { storeSlot } from "../../processes/storeSlot.js";
import type { Row } from "../../db/forHub.js";
import type { RateLimitCheck } from "../../db/rateLimit.js";
import type { SessionAssurance } from "./models.js";
import type { CodeStore } from "./codeRules.js";

/** A session to store: the token is already hashed. */
export interface NewSession {
  token: string;
  user_id: string;
  expires_at: string;
  assurance: SessionAssurance;
}

/** A stored session, as sign-in checks it. */
export interface SessionRow {
  user_id: string;
  expires_at: string;
  assurance: SessionAssurance;
}

/** Sessions and accounts on one named hub (the session lookup is not always in a request's own scope). */
export interface HubSessions {
  /** The session whose stored token hash this is, or null. */
  byTokenHash(tokenHash: string): Promise<SessionRow | null>;
  /** Delete the session with this token hash. */
  deleteByTokenHash(tokenHash: string): Promise<void>;
  /** The account with this id, or null. */
  userById(userId: string): Promise<Row | null>;
}

export interface AuthStore {
  // --- Sign-in codes ---
  /** This hub's emailed codes (sign_in_codes), for the shared code rules. */
  hubCodes(): CodeStore;

  // --- Rate limits (platform data, no hub) ---
  /** Record one attempt against every check, or return the first check already at its limit. */
  takeRateLimit(checks: readonly RateLimitCheck[]): Promise<RateLimitCheck | null>;
  /** When a full bucket has room again, or null. */
  rateLimitRetryAt(check: RateLimitCheck): Promise<Date | null>;
  /** The stored name of a bucket. */
  rateLimitBucket(scope: string, by: string, value: string): string;

  // --- Accounts ---
  /** The account with this address on the hub in scope, or null. */
  userByEmail(email: string): Promise<Row | null>;
  /** The account with this id on the hub in scope, or null. */
  userById(userId: string): Promise<Row | null>;
  /** A real code proved the mailbox: the account counts as a member from now on. */
  clearDemoOnly(userId: string): Promise<void>;
  /** Mark the account's address verified; returns the updated row. */
  markEmailVerified(userId: string): Promise<Row>;
  /** Create an account. "duplicate": another request created it first (the unique key on hub and address). */
  insertUser(row: Row): Promise<Row | "duplicate">;
  /** Change fields on an account on the hub in scope; returns the updated row, or null when there is none. */
  updateUser(userId: string, patch: Record<string, unknown>): Promise<Row | null>;
  /** Delete this hub's codes for the address (when there is one), then the account. */
  deleteAccount(userId: string, email: string | null): Promise<void>;
  /** The cached roles are behind a new account's pending grants: drop them (one hub, or all when none is named). */
  invalidateHubRoles(hubId?: string): void;

  // --- Sessions ---
  /** Store a session on the hub in scope. */
  insertSession(row: NewSession): Promise<void>;
  /** Delete the session with this token hash and return it; null when another request spent it first. */
  spendSession(tokenHash: string): Promise<SessionRow | null>;
  /** Sessions and accounts on a named hub. */
  sessionsOn(hubId: string): HubSessions;

  // --- Member invites ---
  /** The address of the unused, unexpired invite with this link hash, or null. */
  liveInviteEmail(linkHash: string, now: string): Promise<string | null>;
  /** Mark the invite used (one statement, so two taps cannot both use it); the address, or null when it was not live. */
  spendInvite(linkHash: string, now: string): Promise<string | null>;

  // --- Digest ---
  /** Record that a digest reached the user (on a named hub: the digest cron runs outside a request). */
  markDigestSent(hubId: string, userId: string, timestamp: string): Promise<void>;
  /** Every account on one hub subscribed to the digest (paged past 1,000). */
  subscribedUsers(hubId: string): Promise<Row[]>;

  // --- Development seed ---
  /** Clear this hub's codes, sessions and accounts. */
  clearAll(): Promise<void>;
}

export const authStore = storeSlot<AuthStore>("civic.auth");
