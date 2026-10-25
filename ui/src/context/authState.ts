// The sign-in state and the hook that reads it (split from AuthContext.tsx so
// that file holds only the provider, which keeps fast refresh working).
import { createContext, useContext } from "react";
import type { AuthUser, AuthRole } from "../services/auth";

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  /** The user's actor ID for API calls (e.g., "user_abc123" or null) */
  actorId: string | null;
  /** Whether the user is fully ready to participate (authenticated + resident) */
  canParticipate: boolean;
  /**
   * Permission role derived server-side. "admin" = full admin panel.
   * "author" = authorized to post announcements. null = resident.
   */
  role: AuthRole;
  /**
   * Free-form display label for the author's announcements — "Admin",
   * "Board member", "Planning Committee", etc. Comes from the admin's
   * configured author list for non-admins, always "Admin" for admins,
   * null for residents. The UI uses this only for display hints; the
   * server stamps the authoritative label on each announcement at post
   * time.
   */
  authorLabel: string | null;
  /**
   * The signed-in user's public office, when an admin has designated one
   * on their account. null for residents and for plain admins. Orthogonal
   * to `isAdmin` — an account can be both, and renders both badges.
   */
  official: { type: string; title: string } | null;
  /** Convenience: true when role is "admin". */
  isAdmin: boolean;
  /** Convenience: true when role is "admin" OR "author". */
  canPostAnnouncements: boolean;
  /** Login with a token and user from the verify step */
  login: (
    token: string,
    user: AuthUser,
    role?: AuthRole,
    authorLabel?: string | null,
    official?: { type: string; title: string } | null,
  ) => void;
  /** Update user after residency affirmation */
  updateUser: (user: AuthUser) => void;
  /** Logout and clear session */
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
