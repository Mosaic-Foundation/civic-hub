// civic.auth module — type definitions
//
// Minimal email-based auth for civic participation.
// No passwords, no complex identity verification.
// DID-compatible: user.id can be replaced with a DID in Phase 2.
//
// GUARDRAIL: This module MUST NOT import from civic.vote or civic.proposals.

/** A civic hub user */
/** A person's look (design pass, decision 9). */
export type Appearance = "light" | "dark" | "system";
export const APPEARANCES: readonly Appearance[] = ["light", "dark", "system"];

export interface User {
  id: string;
  /**
   * The account's mailbox, when it has one. Every account has one today
   * (sign-in is by emailed code), but a person who signs in another way (a
   * DID) may have none. Authorization never reads it (src/authz/, ADR-011).
   * Code that sends mail or admits a sign-in must handle null explicitly.
   */
  email: string | null;
  email_verified: boolean;
  is_resident: boolean;
  created_at: string; // ISO 8601
  /**
   * Digest delivery frequency in days. null means unsubscribed. Defaults
   * to 1 (daily) on account creation. Common values: 1, 3, 7, 14, 30.
   * The cron job sends a digest when
   * `last_digest_sent_at + frequency_days <= now`.
   */
  digest_frequency_days: number | null;
  /**
   * "Notices about things I take part in" (design pass, decision 15): what
   * notify() sends. On by default; apart from the digest.
   */
  notices_email: boolean;
  /** The person's look: light (the default), dark, or the device's (decision 9). */
  appearance: Appearance;
  /**
   * Cursor for the next digest's "since" window. null means "never
   * sent" — the cron uses the user's created_at as the since anchor,
   * capped to 30 days ago.
   */
  last_digest_sent_at: string | null;
  /**
   * Slice 11 — most recent legal-document version the user accepted
   * (e.g. "1.0"). null means never accepted; the UI prompts a blocking
   * re-acceptance modal until set or until the value is older than
   * CURRENT_LEGAL_VERSION.
   */
  tos_version_accepted: string | null;
  tos_accepted_at: string | null;
  /**
   * When true, the AI drafting-help affordance is removed from every
   * process creation flow for this user (server-side so it follows them
   * across devices). Does not affect the always-on automated Code of
   * Conduct check, which runs on every submission regardless.
   */
  hide_ai_drafting_help: boolean;
  /**
   * Left off the Members page and the home page's avatar stack, by the
   * person's own choice (members and invites slice). Still counted.
   */
  hidden_from_members: boolean;
  display_name: string | null;
  /**
   * The user's real name, required for participation (votes, comments,
   * endorsements, process creation). Collected at the sign-up gate;
   * existing accounts are re-gated on their next participation attempt.
   * Distinct from display_name, which is the role-attribution label for
   * Board/committee accounts on announcements.
   */
  full_name: string | null;
}

/** Pending verification — an OTP code sent to an email */
export interface PendingVerification {
  email: string;
  /** SHA-256 (hex) of the emailed code; the code itself is never stored. */
  code_hash: string;
  created_at: string;
  expires_at: string;
}

/**
 * How a session was proved (Audit 2, 2026-10-11). "code": the holder typed a
 * code emailed to them. "demo": a demo hub's any-six-digits sign-in, which
 * proves nothing about the mailbox and never carries a privilege.
 */
export type SessionAssurance = "code" | "demo";

/** Session — maps a token's hash to a user ID */
export interface Session {
  /** SHA-256 (hex) of the bearer token; the token itself is never stored. */
  token: string;
  user_id: string;
  created_at: string;
  assurance: SessionAssurance;
}
