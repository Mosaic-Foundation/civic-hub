/**
 * The session token: the one place it is read and written.
 *
 * Storage can be blocked (a privacy mode, a site setting, a full quota) and
 * then every access throws. That reads as "not signed in" rather than an
 * error that leaves a page blank (audit F6): AdminGuard and the rest of the
 * app render signed out.
 */

const TOKEN_KEY = "civic_auth_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Signed in for this page only; the next visit asks again.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, or nothing reachable: either way no token remains here.
  }
}
