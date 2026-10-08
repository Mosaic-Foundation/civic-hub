// The start page's client for /api/start/*. Same origin as the page, so the
// session cookie (HttpOnly) rides along; every request carries
// X-Civic-Start, which the server requires on writes.

import type { Jurisdiction, JurisdictionMatch, SlugSuggestion } from "../console/api";
import type { JurisdictionSource } from "../console/JurisdictionPicker";

export class StartApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function plainFailure(status: number | null): string {
  if (status === null) return "Could not reach the server. Check your connection and try again.";
  if (status === 401) return "Your session on this page has ended. Enter your invite code again.";
  if (status === 404) return "This page is not open here.";
  if (status >= 500) return "Something went wrong on our side. Wait a minute and try again.";
  return "That did not work. Try again.";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/start${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Civic-Start": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StartApiError(plainFailure(null), 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const said = typeof data.error === "string" && !/^[a-z_]+$/.test(data.error) ? data.error : "";
    throw new StartApiError(said || plainFailure(res.status), res.status);
  }
  return data as T;
}

export type Step = "code" | "sign_in" | "form";

export interface StartSessionView {
  step: Step;
  email: string | null;
  code_refused: boolean;
}

export interface StartConfig {
  hub_domain: string | null;
  sample_kinds: string[];
}

export interface Created {
  hub: { id: string; name: string; hostname: string };
  redirect: string;
  message: string | null;
}

export const startApi = {
  session: () => request<StartSessionView>("GET", "/session"),
  invite: (code: string) => request<{ step: Step }>("POST", "/invite", { code }),
  requestCode: (email: string) => request<{ message: string }>("POST", "/request-code", { email }),
  verify: (email: string, code: string) => request<{ step: Step; email: string }>("POST", "/verify", { email, code }),
  leave: () => request<{ ok: true }>("POST", "/leave"),
  config: () => request<StartConfig>("GET", "/config"),
  suggestSlug: (name: string, type?: string | null, state?: string | null) =>
    request<SlugSuggestion>(
      "GET",
      `/slug-suggestion?${new URLSearchParams({ name, ...(type ? { type } : {}), ...(state ? { state } : {}) }).toString()}`,
    ),
  createHub: (body: Record<string, unknown>) => request<Created>("POST", "/hubs", body),
};

/** The jurisdiction list, read through the start page (stable: a module constant). */
export const startJurisdictions: JurisdictionSource = {
  states: () => request<{ states: Jurisdiction[] }>("GET", "/jurisdictions/states"),
  searchJurisdictions: (state, type, q) =>
    request<{ matches: JurisdictionMatch[] }>("GET", `/jurisdictions?${new URLSearchParams({ state, type, q }).toString()}`),
};
