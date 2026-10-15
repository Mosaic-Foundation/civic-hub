// Members (members and invites slice, Adam's design 2026-10-10): a hub shows
// it is a group of people.
//
//   - "N members" and a small stack of pattern-avatars on the home page, for
//     everyone (memberSummary).
//   - The Members page, for signed-in members only: each visible member's
//     pattern-avatar and name, admins marked (listMembers).
//   - One switch in a person's own settings hides them from both
//     (setHiddenFromMembers). Hidden members are still counted, and admins see
//     them in Settings → People (listMembersForAdmin).
//
// No email address leaves this file. An avatar is drawn from a seed: a hash
// of the hub and the account id, so it is stable, says nothing about the
// person's name or address, and differs between hubs.
//
// A member is an account that has joined (is_resident). Sample accounts count
// only on a demo hub, where they make the demo look lived-in (Adam,
// 2026-10-14); on a beta or live hub they never do, even before the samples
// are removed.
//
// The Members plugin (2026-10-14, Adam) decides what residents see:
// memberVisibility(). Off, none of the above (its routes answer 404). On,
// below `plugin.members.min_count` members, residents see no count, no stack
// and no Members page, unless `page_before_threshold` shows the page anyway.
// Admins always see all of it. The number itself is withheld by the server,
// not just hidden by the page.

import { forHub } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import { sha256Hex } from "../utils/hash.js";
import { getSettingSync, isDemoHubSync } from "./hubSettings.js";
import { KEYS, asBoolean, asNumber } from "../models/hubSettings.js";
import { rowToDisplay } from "./creatorDisplay.js";

/** How many avatars the home page's stack shows. */
export const STACK_SIZE = 5;

export interface MemberSummary {
  /** Every member, hidden ones included. */
  count: number;
  /** Up to STACK_SIZE avatar seeds: the most recent visible members. */
  stack: string[];
}

export interface Member {
  avatar: string;
  name: string;
  is_admin: boolean;
}

export interface AdminMember extends Member {
  hidden: boolean;
  joined_at: string;
}

interface MemberRow {
  id: string;
  email: string | null;
  full_name: string | null;
  display_name: string | null;
  hidden_from_members: boolean;
  created_at: string;
}

const MEMBER_COLUMNS = "id, email, full_name, display_name, hidden_from_members, created_at";

/** A stable, hub-specific seed for a person's pattern-avatar. */
export function avatarSeed(hubId: string, userId: string): string {
  return sha256Hex(`civic-avatar:${hubId}:${userId}`).slice(0, 16);
}

/** Members of the hub in scope: joined accounts, and samples only on a demo hub. */
function members<Q extends { eq(column: string, value: unknown): Q }>(q: Q): Q {
  const joined = q.eq("is_resident", true);
  // Once the hub leaves demo, accounts made only with demo's "any six digits"
  // stop counting too (users.demo_only, 2026-10-15); what they added stays.
  return isDemoHubSync() ? joined : joined.eq("is_sample", false).eq("demo_only", false);
}

/** What residents may see of the hub's members now (the Members plugin's rule). */
export interface MemberVisibility {
  /** Every member, hidden ones included. */
  count: number;
  /** `plugin.members.min_count`; 0 when unset. */
  threshold: number;
  /** The count and the avatar stack. */
  countShown: boolean;
  /** The Members page and its section in the navigation. */
  pageShown: boolean;
}

/** The count, and what the threshold and the override show (residents; admins see everything). */
export async function memberVisibility(knownCount?: number): Promise<MemberVisibility> {
  const count = knownCount ?? (await memberCount());
  const threshold = Math.max(0, asNumber(getSettingSync(KEYS.PLUGIN_MEMBERS_MIN_COUNT), 0));
  const countShown = count >= threshold;
  const pageShown = countShown || asBoolean(getSettingSync(KEYS.PLUGIN_MEMBERS_PAGE_BEFORE_THRESHOLD), false);
  return { count, threshold, countShown, pageShown };
}

async function memberCount(): Promise<number> {
  return members(forHub(currentHubId()).from("users").count());
}

export async function memberSummary(): Promise<MemberSummary> {
  const hubId = currentHubId();
  const hub = forHub(hubId);
  const count = await memberCount();
  const recent = await members(hub.from("users").select<{ id: string }>("id"))
    .eq("hidden_from_members", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(STACK_SIZE);
  return { count, stack: recent.map((r) => avatarSeed(hubId, r.id)) };
}

function toMember(hubId: string, row: MemberRow): Member {
  const display = rowToDisplay({ ...row });
  return { avatar: avatarSeed(hubId, row.id), name: display.name, is_admin: display.is_admin };
}

/** How many people one page of the Members page holds. */
export const MEMBERS_PAGE_SIZE = 60;

export interface MembersPage {
  members: Member[];
  /** Every member, hidden ones included (the same number as the home page). */
  count: number;
  /** The offset of the next page, or null at the end. */
  next: number | null;
}

/** The Members page: visible members only, by name, a page at a time. */
export async function listMembers(offset = 0): Promise<MembersPage> {
  const hubId = currentHubId();
  const hub = forHub(hubId);
  const start = Math.max(0, Math.floor(offset));
  const rows = await members(hub.from("users").select<MemberRow>(MEMBER_COLUMNS))
    .eq("hidden_from_members", false)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(start, start + MEMBERS_PAGE_SIZE); // one extra row says whether there is more
  const count = await members(hub.from("users").count());
  const more = rows.length > MEMBERS_PAGE_SIZE;
  return {
    members: rows.slice(0, MEMBERS_PAGE_SIZE).map((r) => toMember(hubId, r)),
    count,
    next: more ? start + MEMBERS_PAGE_SIZE : null,
  };
}

/**
 * Settings → People: the members who hid themselves, which only admins see,
 * and the count. Still no addresses.
 */
export async function listMembersForAdmin(): Promise<{ hidden: AdminMember[]; count: number }> {
  const hubId = currentHubId();
  const hub = forHub(hubId);
  const rows = await readAll((from, to) =>
    members(hub.from("users").select<MemberRow>(MEMBER_COLUMNS))
      .eq("hidden_from_members", true)
      .order("full_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const count = await members(hub.from("users").count());
  return {
    hidden: rows.map((r) => ({ ...toMember(hubId, r), hidden: true, joined_at: r.created_at })),
    count,
  };
}

export async function setHiddenFromMembers(userId: string, hidden: boolean): Promise<void> {
  await forHub(currentHubId()).from("users").update({ hidden_from_members: hidden }).eq("id", userId);
}
