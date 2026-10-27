// Activity's calls (ADR-016; features/analytics/routes.ts).

import { API_BASE, request } from "../../../ui/src/services/http";
import { getStoredToken } from "../../../ui/src/services/tokenStore";
import type { PeriodKind } from "../periods";
import type { Report } from "../types";

export interface ReportKey {
  id: string;
  organisation: string;
  contact: string;
  purpose: string;
  key_hint: string;
  created_at: string;
  revoked_at: string | null;
}

export interface ReportRead {
  key_id: string;
  organisation: string;
  read_at: string;
  period_kind: string;
  period_start: string;
}

const query = (kind: PeriodKind, at: string | null) => `period=${kind}${at ? `&at=${at}` : ""}`;

export function getActivity(kind: PeriodKind, at: string | null): Promise<Report> {
  return request("GET", `/admin/analytics?${query(kind, at)}`);
}

/** The public numbers, as an outside reader gets them (no session sent). */
export function getPublicActivity(kind: PeriodKind): Promise<Report> {
  return request("GET", `/analytics?${query(kind, null)}`, undefined, { token: null, expireOn401: false });
}

export function recount(): Promise<unknown> {
  return request("POST", "/admin/analytics/refresh", {});
}

export function listKeys(): Promise<{ keys: ReportKey[]; reads: ReportRead[] }> {
  return request("GET", "/admin/analytics/keys");
}

export function issueKey(body: { organisation: string; contact: string; purpose: string }): Promise<ReportKey & { key: string }> {
  return request("POST", "/admin/analytics/keys", body);
}

export function revokeKey(id: string): Promise<ReportKey> {
  return request("POST", `/admin/analytics/keys/${encodeURIComponent(id)}/revoke`, {});
}

/** The CSV, fetched with the admin's session and handed to the browser as a download. */
export async function downloadCsv(kind: PeriodKind, at: string | null): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE}/admin/analytics/csv?${query(kind, at)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`The download failed (${res.status}).`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "activity.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
