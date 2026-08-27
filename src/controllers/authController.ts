// Auth controller — handles HTTP request/response for auth endpoints
//
// Minimal email-based auth flow:
//   POST /auth/request-code  — send verification code to email
//   POST /auth/verify        — verify code, get session token
//   POST /auth/residency     — affirm Floyd County residency
//   GET  /auth/me            — get current user from session token
//   POST /auth/logout        — destroy session

import { Request, Response } from "express";
import {
  requestVerification,
  verifyCode,
  affirmResidency,
  acceptLegalTerms,
  updateDisplayName,
  updateFullName,
  deleteAccount,
  getUserFromToken,
  logout,
} from "../modules/civic.auth/index.js";
import { resolveAuthorship } from "../middleware/auth.js";

/**
 * POST /auth/request-code
 * Body: { email: string }
 */
export async function handleRequestCode(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: "Missing required field: email" });
    return;
  }

  try {
    const result = await requestVerification(email);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * POST /auth/verify
 * Body: { email: string, code: string }
 */
export async function handleVerify(
  req: Request,
  res: Response,
): Promise<void> {
  const { email, code } = req.body;

  if (!email || !code) {
    res.status(400).json({ error: "Missing required fields: email, code" });
    return;
  }

  try {
    const result = await verifyCode(email, code);
    // Include role + author_label + office alongside the token + user so
    // the UI gets the posting-privilege bit and the byline pill without a
    // follow-up /auth/me call.
    const authorship = await resolveAuthorship(result.user?.email);
    res.json({
      ...result,
      role: authorship?.role ?? null,
      author_label: authorship?.label ?? null,
      official_type: authorship?.official?.type ?? null,
      official_title: authorship?.official?.title ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * POST /auth/residency
 * Header: Authorization: Bearer <token>
 * Body: { full_name?: string }
 *
 * The sign-up gate collects the resident's real name alongside the
 * residency affirmation. full_name is required unless the account
 * already has one (pre-policy accounts re-affirming for other reasons).
 */
export async function handleAffirmResidency(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const { full_name } = (req.body ?? {}) as { full_name?: unknown };
  if (
    !user.full_name &&
    (typeof full_name !== "string" || full_name.trim().length === 0)
  ) {
    res.status(400).json({ error: "full_name is required" });
    return;
  }

  try {
    const updated = await affirmResidency(
      user.id,
      typeof full_name === "string" && full_name.trim().length > 0
        ? full_name
        : undefined,
    );
    res.json({ user: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * GET /auth/me
 * Header: Authorization: Bearer <token>
 */
export async function handleGetMe(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  // Include the derived role + author label so the UI can gate the admin
  // link, the Post Announcement link, and the author-label display
  // without hardcoding anything. null for residents.
  const authorship = await resolveAuthorship(user.email);
  res.json({
    user,
    role: authorship?.role ?? null,
    author_label: authorship?.label ?? null,
    official_type: authorship?.official?.type ?? null,
    official_title: authorship?.official?.title ?? null,
  });
}

/**
 * POST /auth/accept-tos
 * Header: Authorization: Bearer <token>
 * Body: { version: string }
 *
 * Records that the authenticated user has accepted the named version
 * of the Hub's bundled legal documents (Terms / Privacy / Code of
 * Conduct). The UI calls this from both the sign-up acceptance
 * checkbox path and the re-acceptance modal that fires when a user's
 * stored version is older than CURRENT_LEGAL_VERSION. Slice 11.
 */
export async function handleAcceptTos(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  const { version } = (req.body ?? {}) as { version?: unknown };
  if (typeof version !== "string" || version.trim().length === 0) {
    res.status(400).json({ error: "version (string) is required" });
    return;
  }
  try {
    const updated = await acceptLegalTerms(user.id, version.trim());
    res.json({ user: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * PATCH /auth/me
 * Header: Authorization: Bearer <token>
 * Body: { display_name?: string | null, full_name?: string }
 *
 * display_name — role-attribution label (nullable). full_name — the
 * user's real name; used by the re-gate flow for accounts that pre-date
 * the required-name policy. At least one field must be present.
 */
export async function handleUpdateProfile(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  const { display_name, full_name } = (req.body ?? {}) as {
    display_name?: unknown;
    full_name?: unknown;
  };
  const hasDisplayName = display_name !== undefined;
  const hasFullName = full_name !== undefined;
  if (!hasDisplayName && !hasFullName) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  if (hasDisplayName && display_name !== null && typeof display_name !== "string") {
    res.status(400).json({ error: "display_name must be a string or null" });
    return;
  }
  if (hasFullName && typeof full_name !== "string") {
    res.status(400).json({ error: "full_name must be a string" });
    return;
  }
  try {
    let updated = user;
    if (hasFullName) {
      updated = await updateFullName(user.id, full_name as string);
    }
    if (hasDisplayName) {
      updated = await updateDisplayName(
        user.id,
        typeof display_name === "string" ? display_name : null,
      );
    }
    res.json({ user: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <token>
 */
export async function handleLogout(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (token) {
    await logout(token);
  }
  res.json({ message: "Logged out" });
}

/**
 * DELETE /auth/me
 * Header: Authorization: Bearer <token>
 *
 * Slice 13.11 — self-service account deletion. Resolves the bearer
 * token to a user, then removes the user row + pending_verifications
 * for that email. Sessions cascade. Public-record references
 * (comments, endorsements, vote-participation) are intentionally
 * orphaned, not deleted — see deleteAccount() doc comment.
 */
export async function handleDeleteAccount(
  req: Request,
  res: Response,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    await deleteAccount(user.id, user.email);
    res.json({ message: "Account deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

// --- Helpers ---

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}
