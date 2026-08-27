// civic.announcement module — type definitions
//
// Announcements are one-way communications from Board members (or admins)
// to residents. Instant-publish on create: Phase 0 → Phase 6 directly,
// with no framing, activation, participation, aggregation, or outcome.
// Edits are allowed and transparent (edit_count increments, `updated`
// event emitted).
//
// The module is self-contained and portable. The host hub injects the
// event emit function via AnnouncementProcessContext; the module never
// imports the hub's event system directly.

/**
 * Free-form display label for the announcement author. For admins this is
 * always "Admin". For non-admin authors, the label comes from the
 * admin-configured announcement_authors list (hub_settings) and can be
 * any text — "Board member", "Planning Committee", "Guest speaker", etc.
 * Rendered verbatim on the feed post and the public announcement page.
 *
 * Older announcements may still carry "board" as the value (from the
 * Slice 4 union type); the UI treats both "board" and the literal label
 * "Board member" the same way.
 */
export type AnnouncementAuthorRole = string;

export interface AnnouncementLink {
  label: string;
  url: string;
}

export interface AnnouncementContent {
  title: string;           // required, <= TITLE_MAX
  body: string;            // required, plain text, <= BODY_MAX
  links: AnnouncementLink[]; // optional, <= LINKS_MAX
  /**
   * Optional featured image (Slice 9). Public Supabase Storage URL
   * pointing at the `post-images` bucket. When set, image_alt MUST be
   * a non-empty string — alt text is required for accessibility, not
   * optional. The validator rejects image_url without image_alt.
   */
  image_url?: string | null;
  image_alt?: string | null;
}

export interface AnnouncementProcessState {
  type: "civic.announcement";
  content: AnnouncementContent;
  author_id: string;
  author_role: AnnouncementAuthorRole;
  /**
   * Machine-readable office kind behind `author_role` (which is the
   * free-form display string). Stamped at post time from the author's
   * managed official role; null for admin-authored and synced posts.
   * Carried into the event payload so a per-office feed pill colour can
   * be added later without backfilling historical announcements.
   */
  official_type?: string | null;
  author_display_name: string | null;
  created_at: string;       // ISO 8601
  last_edited_at: string | null;
  edit_count: number;
  /**
   * Slice 11 — moderation state. Optional (null on legacy rows that
   * pre-date the slice). When `removed` is true, the public read model
   * replaces the body / image / links / link previews with a tombstone;
   * the feed list endpoint excludes the announcement entirely. Restoring
   * flips `removed` back to false and stamps `restored_at`.
   */
  moderation?: AnnouncementModeration | null;
  /**
   * Slice 13 — provenance for synced-from-external announcements.
   *
   * Set when an announcement was created by an automated sync (e.g. the
   * floyd-news-sync cron pulling from floydcova.gov/news) rather than
   * authored directly by a human admin. Absent on hand-authored
   * announcements. The `share_url` is the external permalink and is
   * also used as the dedupe key on subsequent sync runs (one row per
   * share_url, never duplicated). The feed-card click on a synced
   * announcement routes to `share_url` externally, not to the internal
   * /announcement/:id page.
   */
  source?: AnnouncementSource | null;
}

export interface AnnouncementSource {
  /** Discriminator for the sync origin. Add new values as new connectors land. */
  origin: "floyd-news";
  /** External permalink — also serves as the dedupe key. */
  share_url: string;
  /** ISO 8601 timestamp of when the sync ingested this entry. */
  ingested_at: string;
}

export interface AnnouncementModeration {
  removed: boolean;
  removed_at: string | null;
  removed_by: string | null;
  reason: string | null;
  restored_at: string | null;
}

/** Max characters in a moderation reason (matches civic.input). */
export const MODERATION_REASON_MAX = 500;

/** Length caps enforced by the module (also enforced client-side). */
export const TITLE_MAX = 200;
export const BODY_MAX = 5000;
export const LINKS_MAX = 5;
export const LINK_LABEL_MAX = 100;
export const LINK_URL_MAX = 500;
/** First N chars of the body included in event data as a preview. */
export const BODY_PREVIEW_LEN = 200;
/** Cap on image alt-text. Long alts hurt screen readers more than help. */
export const IMAGE_ALT_MAX = 200;
/** Cap on the image_url itself; defensively rejects pathological values. */
export const IMAGE_URL_MAX = 1000;

/**
 * Event emission callback — injected by the host hub.
 */
export interface EmitEventFn {
  (input: {
    event_type: string;
    actor: string;
    process_id: string;
    hub_id: string;
    jurisdiction: string;
    data: Record<string, unknown>;
    /** Phase 3 — canonical process type, stamped into data.process.type. */
    processType?: string;
    action_url_path?: string;
    /**
     * Slice 11 — moderation events emit with restricted visibility so
     * they don't appear in the public /events feed or the digest.
     * Defaults to "public" when omitted.
     */
    visibility?: "public" | "restricted";
    /**
     * Slice 13 — optional ISO 8601 timestamp override for sync paths
     * that want the event to reflect real-world publication time.
     * Emitter stamps `now` when omitted.
     */
    timestamp?: string;
  }): Promise<unknown>;
}

export interface AnnouncementProcessContext {
  process_id: string;
  hub_id: string;
  jurisdiction: string;
  emit: EmitEventFn;
}

export interface AnnouncementActionOutcome {
  state: AnnouncementProcessState;
  result: Record<string, unknown>;
}

/** Input when a Board member / admin creates an announcement. */
export interface CreateAnnouncementInput {
  title: string;
  body: string;
  links?: AnnouncementLink[];
  author_id: string;
  author_role: AnnouncementAuthorRole;
  /** See AnnouncementProcessState.official_type. */
  official_type?: string | null;
  author_display_name?: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  /**
   * Slice 13 — populated by automated sync paths. Hand-authored
   * announcements leave this undefined.
   */
  source?: AnnouncementSource | null;
}

/** Partial update used by PATCH /announcement/:id. */
export interface AnnouncementContentPatch {
  title?: string;
  body?: string;
  links?: AnnouncementLink[];
  /**
   * Set to a string to attach/replace the image. Set to null to
   * explicitly remove an existing image. Undefined means "leave as-is".
   * The same null/string semantics apply to image_alt.
   */
  image_url?: string | null;
  image_alt?: string | null;
}
