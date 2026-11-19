// Announcements' reads and actions, through the kernel's API client
// (@civic-social/plugin-sdk/ui): its routes (/announcement, /announcements)
// and the kernel's moderation routes for it. Pinning is the hub's.

import { apiRequest } from "@civic-social/plugin-sdk/ui";

/**
 * Free-form display label for the announcement author ("Admin", "Board
 * member", "Planning Committee", etc.). Server-side admins always get
 * "Admin"; non-admin authors get the label configured in the admin's
 * announcement_authors list. Rendered verbatim on the feed and the
 * public announcement page. Older Slice 4 announcements may carry
 * "board" — renders fine either way.
 */
export type AnnouncementAuthorRole = string;

export interface AnnouncementLink {
  label: string;
  url: string;
}

/** Full read of one announcement (GET /announcement/:id). */
export interface Announcement {
  /** Sample content (Phase 7): shows the Sample badge. */
  is_sample?: boolean;
  id: string;
  type: "civic.announcement";
  title: string;
  body: string;
  links: AnnouncementLink[];
  image_url: string | null;
  image_alt: string | null;
  // Server-computed: true when the authenticated caller is the author. Drives
  // the edit affordance without exposing the raw author id. Use creator_name /
  // creator_is_admin for attribution.
  is_owner?: boolean;
  /** Resolved display name of the author (full_name ?? display_name ?? "Resident"). */
  creator_name: string;
  /** Whether the author is a hub admin. */
  creator_is_admin: boolean;
  /**
   * The author's public office, when an admin has designated one on their
   * account. Both null for residents. The TITLE renders as its own pill
   * next to the name (see Creator); the TYPE only selects its colour.
   * Independent of creator_is_admin — an account can carry both.
   */
  creator_official_type: string | null;
  creator_official_title: string | null;
  author_role: AnnouncementAuthorRole;
  /**
   * Machine-readable office behind author_role. Null for admin-authored
   * posts. Present so a per-office feed pill colour can be
   * added later without backfilling old announcements.
   */
  official_type?: string | null;
  author_display_name: string | null;
  created_at: string;
  last_edited_at: string | null;
  edit_count: number;
  /**
   * Slice 11 — moderation state. Null on never-moderated announcements.
   * When `removed` is true and the viewer is not an admin, the body /
   * image / links fields above are blank and the page renders a
   * tombstone in their place. Admins keep receiving the original
   * content via the same endpoint with their token attached.
   */
  moderation?: AnnouncementModerationView | null;
}

export interface AnnouncementModerationView {
  removed: boolean;
  removed_at: string | null;
  /** Internal-audit only — admin endpoints include this; public read does not. */
  removed_by?: string | null;
  /** Internal-audit only — admin endpoints include this; public read does not. */
  reason?: string | null;
  restored_at: string | null;
}

/** Summary row (GET /announcements). */
export interface AnnouncementSummary {
  id: string;
  type: "civic.announcement";
  title: string;
  image_url: string | null;
  image_alt: string | null;
  author_role: AnnouncementAuthorRole;
  /**
   * Machine-readable office behind author_role. Null for admin-authored
   * posts. Present so a per-office feed pill colour can be
   * added later without backfilling old announcements.
   */
  official_type?: string | null;
  author_display_name: string | null;
  created_at: string;
  last_edited_at: string | null;
  edit_count: number;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  links?: AnnouncementLink[];
  image_url?: string | null;
  image_alt?: string | null;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  links?: AnnouncementLink[];
  /**
   * Set to a string to attach/replace, null to remove, undefined to
   * leave unchanged. Same semantics for image_alt.
   */
  image_url?: string | null;
  image_alt?: string | null;
}

export function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<Announcement> {
  return apiRequest("POST", "/announcement", input);
}

export function updateAnnouncement(
  id: string,
  input: UpdateAnnouncementInput,
): Promise<Announcement> {
  return apiRequest("PATCH", `/announcement/${id}`, input);
}

export function getAnnouncement(id: string): Promise<Announcement> {
  return apiRequest("GET", `/announcement/${id}`);
}

export function listAnnouncements(limit?: number): Promise<AnnouncementSummary[]> {
  const q = typeof limit === "number" ? `?limit=${limit}` : "";
  return apiRequest("GET", `/announcements${q}`);
}


// --- Admin: remove and restore ---

/** Remove an announcement (renders a tombstone for non-admin viewers). */
export function adminRemoveAnnouncement(
  processId: string,
  reason: string,
): Promise<Announcement> {
  return apiRequest(
    "POST",
    `/admin/moderation/announcements/${processId}/remove`,
    { reason },
  );
}

/**
 * The type a process is now (the kernel's GET /process/:id/state), or null
 * when there is none: an old /announcement/ link to a process of another type
 * goes on to that type's page.
 */
export async function processTypeOf(id: string): Promise<string | null> {
  const state = await apiRequest<{ type?: string }>("GET", `/process/${id}/state`);
  return state?.type ?? null;
}

/** Restore a previously removed announcement. */
export function adminRestoreAnnouncement(
  processId: string,
): Promise<Announcement> {
  return apiRequest(
    "POST",
    `/admin/moderation/announcements/${processId}/restore`,
  );
}
