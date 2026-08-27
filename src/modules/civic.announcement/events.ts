// civic.announcement module — event emission helpers
//
// Per Civic Event Spec v0.1 §4-5. action_url_path points events at the
// public announcement page so feed posts and federated consumers route
// to the human-facing UI rather than the JSON API.

import type {
  AnnouncementContentPatch,
  AnnouncementProcessContext,
  AnnouncementProcessState,
} from "./models.js";
import { BODY_PREVIEW_LEN } from "./models.js";

function announcementPath(process_id: string): string {
  return `/announcement/${process_id}`;
}

function bodyPreview(body: string): string {
  return body.trim().slice(0, BODY_PREVIEW_LEN);
}

/**
 * Resolve the action_url_path for an announcement event.
 *
 * - Synced announcements (`state.source.share_url` set) emit the absolute
 *   external URL as the path. The event emitter detects this and stores
 *   it as the action_url verbatim, so feed-card clicks route directly to
 *   the source (e.g. floydcova.gov/post/...).
 * - Hand-authored announcements emit the internal /announcement/:id path,
 *   prefixed with the hub's UI base by the event emitter.
 */
function actionPathFor(
  ctx: AnnouncementProcessContext,
  state: AnnouncementProcessState,
): string {
  return state.source?.share_url ?? announcementPath(ctx.process_id);
}

export async function emitAnnouncementCreated(
  ctx: AnnouncementProcessContext,
  actor: string,
  state: AnnouncementProcessState,
  opts: { timestamp?: string } = {},
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.created",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.announcement",
    action_url_path: actionPathFor(ctx, state),
    data: {
      announcement: {
        title: state.content.title,
        body_preview: bodyPreview(state.content.body),
        author_role: state.author_role,
        official_type: state.official_type ?? null,
        author_display_name: state.author_display_name ?? null,
        source: state.source ?? null,
      },
    },
    timestamp: opts.timestamp,
  });
}

/**
 * Emitted immediately after `created` — announcements skip Phases 1–5
 * and go directly to publication. See HANDOFF.md for the spec-compliance
 * note about skipped phases for instant-publish announcements.
 *
 * Sync paths (e.g. floyd-news-sync) pass `opts.timestamp` to backdate
 * the event to the underlying content's real-world publication time so
 * the feed orders synced items chronologically.
 */
export async function emitAnnouncementResultPublished(
  ctx: AnnouncementProcessContext,
  actor: string,
  state: AnnouncementProcessState,
  opts: { timestamp?: string } = {},
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.result_published",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.announcement",
    action_url_path: actionPathFor(ctx, state),
    data: {
      announcement: {
        id: ctx.process_id,
        title: state.content.title,
        author_role: state.author_role,
        official_type: state.official_type ?? null,
        author_display_name: state.author_display_name ?? null,
        source: state.source ?? null,
      },
    },
    timestamp: opts.timestamp,
  });
}

export async function emitAnnouncementUpdated(
  ctx: AnnouncementProcessContext,
  actor: string,
  state: AnnouncementProcessState,
  editedFields: Array<"title" | "body" | "links" | "image">,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.process.updated",
    actor,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.announcement",
    action_url_path: announcementPath(ctx.process_id),
    data: {
      announcement: {
        title: state.content.title,
        body_preview: bodyPreview(state.content.body),
        edit_count: state.edit_count,
        edited_fields: editedFields,
      },
    },
  });
}

// Re-export for the adapter that needs the raw preview util (keeps the
// module as the single source of truth for preview length).
export { bodyPreview };

// Make TS happy if nothing else references the patch type yet; harmless.
export type { AnnouncementContentPatch };
