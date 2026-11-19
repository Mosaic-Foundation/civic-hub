// The Members plugin's calls (features/members/routes.ts). No answer carries
// an email address.

import { request } from "../../../ui/src/services/http";

export interface MemberSummary {
  /**
   * Every member, those who hid themselves included; null below the Members
   * plugin's threshold, unless the caller is an admin.
   */
  count: number | null;
  /** Avatar seeds of the most recent visible members (empty when the count is withheld). */
  stack: string[];
  /** Whether residents see the count now. */
  shown?: boolean;
  /** Whether residents get the Members page now. */
  page?: boolean;
  /** The threshold, for an admin. */
  threshold?: number;
}

export interface Member {
  avatar: string;
  name: string;
  is_admin: boolean;
}

export interface MembersPage {
  members: Member[];
  count: number;
  next: number | null;
  you_are_hidden: boolean;
}

export function getMemberSummary(): Promise<MemberSummary> {
  return request("GET", "/members/summary");
}

export function getMembers(offset = 0): Promise<MembersPage> {
  return request("GET", `/members?offset=${offset}`);
}

/** Admin → Settings → People: the members who hid themselves, and the count. */
export function adminGetHiddenMembers(): Promise<{ hidden: Array<Member & { joined_at: string }>; count: number }> {
  return request("GET", "/admin/hub/members");
}
