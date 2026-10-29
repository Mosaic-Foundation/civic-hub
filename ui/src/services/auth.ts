/**
 * Auth service — handles communication with /auth endpoints.
 * The session token itself is kept by tokenStore.ts.
 */

import { request as send } from "./http";

/**
 * The sign-in calls send the token they are given (none before sign-in), and
 * their 401 is an answer about a code or a session being checked, not the
 * stored session expiring under a page.
 */
function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  return send<T>(method, path, body, { token: token ?? null, expireOn401: false });
}

// --- Types ---

export interface AuthUser {
  id: string;
  email: string;
  email_verified: boolean;
  is_resident: boolean;
  created_at: string;
  /**
   * Digest delivery frequency in days. null = unsubscribed, 1 = daily,
   * 3 = every 3 days, 7 = weekly, 14 = biweekly, 30 = monthly.
   * Defaults to 1 (daily) on account creation.
   */
  digest_frequency_days: number | null;
  /** "Notices about things I take part in" (design pass, decision 15); on by default. */
  notices_email?: boolean;
  /** The person's look (decision 9); light by default. */
  appearance?: "light" | "dark" | "system";
  /**
   * Slice 11 — most recent legal-document version this user accepted
   * (e.g. "1.0"). null means the user has never accepted; the UI shows
   * the blocking re-acceptance modal until set or until the value
   * matches CURRENT_LEGAL_VERSION.
   */
  tos_version_accepted: string | null;
  tos_accepted_at: string | null;
  /**
   * When true, the AI drafting-help affordance is removed from every
   * process creation flow. Stored server-side so it follows the user
   * across devices. The automated Code of Conduct check still runs on
   * every submission regardless.
   */
  hide_ai_drafting_help: boolean;
  /** Left off the Members page and the home page's avatar stack (still counted). */
  hidden_from_members?: boolean;
  display_name: string | null;
  /**
   * The user's real name — required for participation. null on
   * accounts created before the required-name policy; those users are
   * re-gated through the add-your-name step on their next sign-in or
   * participation attempt.
   */
  full_name: string | null;
}

/**
 * Permission role derived server-side. "admin" = full admin panel
 * access. "author" = user authorized to post announcements (via the
 * admin-managed list in hub_settings, with CIVIC_BOARD_EMAILS as a
 * fallback). null = regular resident with no special privileges.
 */
export type AuthRole = "admin" | "author" | null;

// --- API calls ---

export function requestCode(email: string): Promise<{ message: string; no_email?: boolean }> {
  return request("POST", "/auth/request-code", { email });
}

export interface SignedIn {
  token: string;
  user: AuthUser;
  role: AuthRole;
  author_label: string | null;
  official_type: string | null;
  official_title: string | null;
}

export function verifyCode(email: string, code: string, keepSignedIn = false): Promise<SignedIn> {
  return request("POST", "/auth/verify", { email, code, keep_signed_in: keepSignedIn });
}

/** The code email's "Sign in" link: its token, after one Confirm (sign-in slice). */
export function verifyLink(token: string, keepSignedIn = false): Promise<SignedIn> {
  return request("POST", "/auth/verify-link", { token, keep_signed_in: keepSignedIn });
}

/** A member's invite link (/sign-in#invite=…), after Confirm. */
export function verifyInvite(token: string, keepSignedIn = false): Promise<SignedIn> {
  return request("POST", "/auth/verify-invite", { token, keep_signed_in: keepSignedIn });
}

// --- "Keep me signed in", remembered per browser ---
//
// Default off: whether a device is shared or public can't be detected, so a
// person ticks it on their own phone once and this browser remembers.

const KEEP_KEY = "civic_keep_signed_in";

export function rememberedKeepSignedIn(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberKeepSignedIn(keep: boolean): void {
  try {
    if (keep) localStorage.setItem(KEEP_KEY, "1");
    else localStorage.removeItem(KEEP_KEY);
  } catch {
    // Not remembered; the box starts unticked next time.
  }
}

/**
 * The start page (session 4b) lands a hub's creator here with
 * #handoff=<token>: a two-minute, single-use token, swapped for a session.
 * Same answer as verifyCode.
 */
export function exchangeHandoff(handoff: string): ReturnType<typeof verifyCode> {
  return request("POST", "/auth/handoff", { handoff });
}

/**
 * The handoff token in the address, if any, removed from the address bar at
 * once so it is not bookmarked, shared or kept in history.
 */
export function takeHandoffFromLocation(): string | null {
  const match = /^#handoff=([^&]+)$/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return decodeURIComponent(match[1]);
}

export function affirmResidency(
  token: string,
  fullName?: string,
): Promise<{ user: AuthUser }> {
  return request(
    "POST",
    "/auth/residency",
    fullName ? { full_name: fullName } : undefined,
    token,
  );
}

/**
 * Set the user's real name — the re-gate path for accounts that
 * pre-date the required-name policy (already residents, just missing a
 * name).
 */
export function updateFullName(
  token: string,
  fullName: string,
): Promise<{ user: AuthUser }> {
  return request("PATCH", "/auth/me", { full_name: fullName }, token);
}

/**
 * Slice 11 — record that the authenticated user has accepted the named
 * version of the Hub's bundled legal documents. Called from both the
 * sign-up flow (via the acceptance checkbox in AuthModal) and the
 * re-acceptance modal that fires when a user's stored version is
 * stale. Server stamps tos_version_accepted + tos_accepted_at.
 */
export function acceptTos(
  token: string,
  version: string,
): Promise<{ user: AuthUser }> {
  return request("POST", "/auth/accept-tos", { version }, token);
}

/**
 * Persist the "Hide AI drafting help" preference on the user's account.
 */
export function setHideAiDraftingHelp(
  token: string,
  hide: boolean,
): Promise<{ user: AuthUser }> {
  return request("PATCH", "/auth/me", { hide_ai_drafting_help: hide }, token);
}

/** Show or hide oneself on the Members page and the avatar stack. */
export function setHiddenFromMembers(token: string, hidden: boolean): Promise<{ user: AuthUser }> {
  return request("PATCH", "/auth/me", { hidden_from_members: hidden }, token);
}

export function getMe(
  token: string,
): Promise<{
  user: AuthUser;
  role: AuthRole;
  author_label: string | null;
  official_type: string | null;
  official_title: string | null;
}> {
  return request("GET", "/auth/me", undefined, token);
}

export function logoutApi(token: string): Promise<{ message: string }> {
  return request("POST", "/auth/logout", undefined, token);
}

/**
 * Slice 13.11 — self-service account deletion. Removes the user
 * and frees their email for re-use. Caller is expected to clear
 * local token storage and redirect after success.
 */
export function deleteAccount(token: string): Promise<{ message: string }> {
  return request("DELETE", "/auth/me", undefined, token);
}
