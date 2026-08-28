// civic.auth module — type definitions
//
// Minimal email-based auth for civic participation.
// No passwords, no complex identity verification.
// DID-compatible: user.id can be replaced with a DID in Phase 2.
//
// GUARDRAIL: This module MUST NOT import from civic.vote or civic.proposals.

/** A civic hub user */
export interface User {
  id: string;
  email: string;
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
  code: string;
  created_at: string;
  expires_at: string;
}

/** Session — maps a token to a user ID */
export interface Session {
  token: string;
  user_id: string;
  created_at: string;
}
