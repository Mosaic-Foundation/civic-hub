// The console's client for /api/control/*. Same origin as the page, so the
// session cookie (HttpOnly; the page never sees it) rides along. Every
// request carries X-Civic-Console, which the server requires on writes.

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/control${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Civic-Console": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof data.error === "string" && /^[a-z_]+$/.test(data.error) ? data.error : undefined;
    throw new ApiError(data.message ?? data.error ?? `Request failed (${res.status})`, res.status, code);
  }
  return data as T;
}

export type HubMode = "demo" | "beta" | "live";

export interface Hub {
  id: string;
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  status: "active" | "suspended";
  mode: HubMode | null;
  created_at: string;
  archived_at: string | null;
  redirect_to: string | null;
}

export interface HubConfig {
  name: string;
  hostname: string;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  jurisdiction_type: string | null;
  governing_body: string;
  status: string;
  mode: string | null;
}

export interface PluginState {
  id: string;
  enabled: boolean;
  source: "hub" | "environment" | "default";
}

export interface HubDetail {
  hub: Hub;
  config: HubConfig;
  plugins: PluginState[];
  admins: string[];
}

export interface ConsoleConfig {
  console_hostname: string | null;
  platform_domain: string | null;
  reserved_slugs: Record<string, string>;
  plugin_ids: string[];
  production_database: boolean;
  hub_specific_env_vars: string[];
  create_refusal: string | null;
}

export interface AuditEntry {
  id: number | string;
  at: string;
  actor_email: string;
  action: string;
  target_hub_id: string | null;
  before: unknown;
  after: unknown;
}

export interface HubExport {
  object_key: string;
  file_name: string;
  size: number;
  url: string;
  expires_at: string;
  fingerprint: string;
  rows: number;
  images: number;
  format_version: number;
}

export const api = {
  session: () =>
    request<{ email: string | null; operator_configured: boolean; console_hostname: string | null }>("GET", "/session"),
  requestCode: (email: string) => request<{ message: string }>("POST", "/auth/request-code", { email }),
  verify: (email: string, code: string) => request<{ email: string }>("POST", "/auth/verify", { email, code }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  requestStepUp: () => request<{ message: string }>("POST", "/auth/step-up/request-code"),

  config: () => request<ConsoleConfig>("GET", "/config"),
  hubs: () => request<{ hubs: Hub[] }>("GET", "/hubs"),
  hub: (id: string) => request<HubDetail>("GET", `/hubs/${encodeURIComponent(id)}`),
  createHub: (body: Record<string, string | boolean>) =>
    request<HubDetail & { sample_content: { created: string[] } | { error: string } | null }>("POST", "/hubs", body),
  updateHub: (id: string, body: Record<string, unknown>) =>
    request<HubDetail>("PATCH", `/hubs/${encodeURIComponent(id)}`, body),
  setPlugins: (id: string, plugins: Record<string, boolean>, extra: Record<string, unknown> = {}) =>
    request<HubDetail>("PUT", `/hubs/${encodeURIComponent(id)}/plugins`, { plugins, ...extra }),
  setAdmins: (id: string, admins: string[], extra: Record<string, unknown> = {}) =>
    request<HubDetail>("PUT", `/hubs/${encodeURIComponent(id)}/admins`, { admins, ...extra }),
  archive: (id: string, extra: Record<string, unknown> = {}) =>
    request<HubDetail>("POST", `/hubs/${encodeURIComponent(id)}/archive`, extra),
  unarchive: (id: string) => request<HubDetail>("POST", `/hubs/${encodeURIComponent(id)}/unarchive`, {}),
  exportHub: (id: string, extra: Record<string, unknown> = {}) =>
    request<HubExport>("POST", `/hubs/${encodeURIComponent(id)}/export`, extra),
  hubAdminAudit: (id: string) =>
    request<{ entries: HubAdminAuditEntry[] }>("GET", `/hubs/${encodeURIComponent(id)}/admin-audit`),
  audit: (hubId?: string) =>
    request<{ entries: AuditEntry[] }>("GET", `/audit${hubId ? `?hub=${encodeURIComponent(hubId)}` : ""}`),
};

/** One row of a hub's own hub_admin_audit_log (Phase 7). */
export interface HubAdminAuditEntry {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  before: unknown;
  after: unknown;
}
