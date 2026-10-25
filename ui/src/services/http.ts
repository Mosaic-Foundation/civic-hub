/**
 * The hub app's one way to call its API (frontend pass, 2026-10-24).
 *
 * Every request goes through `request()`: JSON or a FormData upload, the
 * session token from tokenStore (or the one the caller passes), the server's
 * error as an ApiError with its code, and a 401 that tells the app the
 * session is gone. Writes are announced to `onWrite` listeners, which is how
 * useApi's short cache knows to empty itself.
 *
 * The console and the start page have their own small clients (src/console/,
 * src/start/): they are separate apps with their own sessions.
 */

import { ApiError, apiErrorCode, apiErrorMessage } from "../utils/httpError";
import { getStoredToken } from "./tokenStore";

/** Where the API is: its own server in development, `/api` on the same origin otherwise. */
export const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "/api";

export interface RequestOptions {
  /** The token to send instead of the stored one (sign-in, before it is stored); null sends none. */
  token?: string | null;
  /**
   * A 401 means the stored session has expired, and the app drops to signed
   * out (AuthProvider listens). False for the sign-in calls, whose 401 is an
   * answer about the code, not the session.
   */
  expireOn401?: boolean;
  signal?: AbortSignal;
}

const writeListeners = new Set<() => void>();

/** Called after every request that is not a GET is sent. */
export function onWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isForm) headers["Content-Type"] = "application/json";
  const token = options.token !== undefined ? options.token : getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  if (method !== "GET") {
    for (const listener of writeListeners) listener();
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    signal: options.signal,
  });

  if (!res.ok) {
    if (res.status === 401 && options.expireOn401 !== false) {
      // Session expired or invalid. Signal the app to drop to logged-out
      // state (AuthProvider listens) instead of leaving the user "logged in"
      // while every action fails with an opaque error.
      window.dispatchEvent(new CustomEvent("civic:auth-expired"));
    }
    const err = await res.json().catch(() => null);
    throw new ApiError(apiErrorMessage(err, res.status, res.statusText), res.status, apiErrorCode(err), err);
  }

  return res.json();
}

/** Upload one file as the form field `file`. */
export function upload<T>(path: string, file: Blob): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return request<T>("POST", path, form);
}
