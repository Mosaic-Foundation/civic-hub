// hub_roles reads — the only place that queries that table (ADR-011).
//
// hub_roles is written by trigger alone (20261023000000), from the people.*
// settings and the accounts. A hub's grants are few, so they are loaded whole
// and cached like the settings: until the hub's settings version moves (a
// change to hub_roles bumps it, by trigger) or, where the version can't be
// known, for 60 seconds. src/authz/ reads them through here.
//
// One thing the version cannot catch: a write in THIS request that changes the
// grants (an account created at sign-up binds its pending grant; a list saved)
// leaves the request's own hub row, and so its version, behind. Those writers
// drop the cache (invalidateHubRoles, and invalidateHubSettings for a list), so
// the next read in the same request is fresh.

import { forHub } from "./forHub.js";
import { readAll } from "./readAll.js";
import { getHubSettingsVersion } from "./hubs.js";
import { currentHub } from "../config/hubContext.js";

const CACHE_TTL_MS = 60_000;

export type HubRole = "admin" | "board" | "announcement_author";

/** What a grant carries beyond its role: an announcement author's label and name. */
export interface RoleAttrs {
  label?: string;
  name?: string;
}

/** One hub's grants: who holds what, by account, and which roles are granted at all. */
export interface HubRoleSet {
  /** Bound grants by account id. */
  readonly byUser: ReadonlyMap<string, ReadonlyMap<HubRole, RoleAttrs>>;
  /** Grants per role, bound or pending: "this hub has admins" counts a pending one. */
  readonly granted: Readonly<Record<HubRole, number>>;
}

interface Entry {
  value: HubRoleSet;
  version: number | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

async function versionNow(hubId: string): Promise<number | null> {
  const inScope = currentHub();
  if (inScope?.id === hubId && typeof inScope.settings_version === "number") return inScope.settings_version;
  return getHubSettingsVersion(hubId);
}

/** Drop one hub's cached grants, or every hub's. */
export function invalidateHubRoles(hubId?: string): void {
  if (hubId) cache.delete(hubId);
  else cache.clear();
}

/** One hub's grants, from the cache when it is current. */
export async function getHubRoles(hubId: string): Promise<HubRoleSet> {
  const version = await versionNow(hubId);
  const hit = cache.get(hubId);
  if (hit && (version !== null && hit.version !== null ? hit.version === version : hit.expiresAt > Date.now())) {
    return hit.value;
  }
  const rows = await readAll<{ role: HubRole; user_id: string | null; attrs: RoleAttrs | null }>((from, to) =>
    forHub(hubId).from("hub_roles").select<{ role: HubRole; user_id: string | null; attrs: RoleAttrs | null }>("role, user_id, attrs").order("id", { ascending: true }).range(from, to),
  );
  const byUser = new Map<string, Map<HubRole, RoleAttrs>>();
  const granted: Record<HubRole, number> = { admin: 0, board: 0, announcement_author: 0 };
  for (const r of rows) {
    granted[r.role] = (granted[r.role] ?? 0) + 1;
    if (!r.user_id) continue;
    const mine = byUser.get(r.user_id) ?? new Map<HubRole, RoleAttrs>();
    mine.set(r.role, r.attrs ?? {});
    byUser.set(r.user_id, mine);
  }
  const value: HubRoleSet = { byUser, granted };
  // Tagged with the version read BEFORE the rows, as the settings cache is.
  cache.set(hubId, { value, version, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
