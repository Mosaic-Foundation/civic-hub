// civic.announcement module — service functions (pure state transitions)
//
// No I/O beyond the injected emit callback. Persistence of state changes
// is the host hub's responsibility (via processService.saveProcessState).

import type {
  AnnouncementActionOutcome,
  AnnouncementContent,
  AnnouncementContentPatch,
  AnnouncementLink,
  AnnouncementModeration,
  AnnouncementProcessContext,
  AnnouncementProcessState,
  CreateAnnouncementInput,
} from "./models.js";
import {
  BODY_MAX,
  IMAGE_ALT_MAX,
  IMAGE_URL_MAX,
  LINK_LABEL_MAX,
  LINK_URL_MAX,
  LINKS_MAX,
  MODERATION_REASON_MAX,
  TITLE_MAX,
} from "./models.js";
import { canEdit } from "./lifecycle.js";
import {
  emitAnnouncementCreated,
  emitAnnouncementResultPublished,
  emitAnnouncementUpdated,
} from "./events.js";

export function createAnnouncementState(
  input: CreateAnnouncementInput,
): AnnouncementProcessState {
  // Synced announcements (set on input.source) never have a body — the
  // user clicks the card and reads the post on the source site. Allow
  // body to be empty in that case; hand-authored announcements still
  // require a non-empty body.
  const allowEmptyBody = Boolean(input.source);
  const content = sanitizeContent(
    {
      title: input.title,
      body: input.body,
      links: input.links ?? [],
      image_url: input.image_url ?? null,
      image_alt: input.image_alt ?? null,
    },
    { allowEmptyBody },
  );
  return {
    type: "civic.announcement",
    content,
    author_id: input.author_id,
    author_role: input.author_role,
    official_type: input.official_type ?? null,
    author_display_name: input.author_display_name ?? null,
    created_at: new Date().toISOString(),
    last_edited_at: null,
    edit_count: 0,
    source: input.source ?? null,
  };
}

/**
 * Emit the two instant-publish events: created, then result_published.
 * Called by the host hub once the row is persisted.
 */
export async function emitPublicationEvents(
  ctx: AnnouncementProcessContext,
  actor: string,
  state: AnnouncementProcessState,
): Promise<void> {
  await emitAnnouncementCreated(ctx, actor, state);
  await emitAnnouncementResultPublished(ctx, actor, state);
}

/**
 * Apply an edit. Authorization check lives here so it's untied from the
 * HTTP layer and any future non-HTTP caller. Emits `updated`.
 */
export async function updateAnnouncement(
  state: AnnouncementProcessState,
  editor: { id: string; role: "admin" | "author" },
  patch: AnnouncementContentPatch,
  ctx: AnnouncementProcessContext,
): Promise<AnnouncementActionOutcome> {
  if (!canEdit(state, editor.id, editor.role)) {
    throw new Error("Not authorized to edit this announcement.");
  }

  const editedFields: Array<"title" | "body" | "links" | "image"> = [];
  const nextContent: AnnouncementContent = { ...state.content };

  if (patch.title !== undefined && patch.title !== state.content.title) {
    nextContent.title = patch.title;
    editedFields.push("title");
  }
  if (patch.body !== undefined && patch.body !== state.content.body) {
    nextContent.body = patch.body;
    editedFields.push("body");
  }
  if (patch.links !== undefined) {
    nextContent.links = patch.links;
    // Compare stringified to detect actual change; keeps the event honest.
    if (JSON.stringify(patch.links) !== JSON.stringify(state.content.links)) {
      editedFields.push("links");
    }
  }
  // Image fields: only an image_url change (or alt-text change) counts
  // as a content edit. Either image_url or image_alt being present in
  // the patch is enough to enter the branch — they're validated together
  // by sanitizeContent.
  const imagePatched =
    patch.image_url !== undefined || patch.image_alt !== undefined;
  if (imagePatched) {
    if (patch.image_url !== undefined) nextContent.image_url = patch.image_url;
    if (patch.image_alt !== undefined) nextContent.image_alt = patch.image_alt;
    if (
      (patch.image_url !== undefined &&
        patch.image_url !== (state.content.image_url ?? null)) ||
      (patch.image_alt !== undefined &&
        patch.image_alt !== (state.content.image_alt ?? null))
    ) {
      editedFields.push("image");
    }
  }

  if (editedFields.length === 0) {
    // No-op edit — don't emit a spurious `updated` event.
    return { state, result: { edited_fields: [] } };
  }

  state.content = sanitizeContent(nextContent);
  state.last_edited_at = new Date().toISOString();
  state.edit_count += 1;

  await emitAnnouncementUpdated(ctx, editor.id, state, editedFields);

  return {
    state,
    result: {
      edited_fields: editedFields,
      edit_count: state.edit_count,
      last_edited_at: state.last_edited_at,
    },
  };
}

function sanitizeContent(
  c: AnnouncementContent,
  opts: { allowEmptyBody?: boolean } = {},
): AnnouncementContent {
  const title = (c.title ?? "").trim();
  if (title.length === 0) {
    throw new Error("Announcement title is required.");
  }
  if (title.length > TITLE_MAX) {
    throw new Error(`Announcement title must be <= ${TITLE_MAX} characters.`);
  }

  const body = (c.body ?? "").trim();
  if (!opts.allowEmptyBody && body.length === 0) {
    throw new Error("Announcement body is required.");
  }
  if (body.length > BODY_MAX) {
    throw new Error(`Announcement body must be <= ${BODY_MAX} characters.`);
  }

  const rawLinks = Array.isArray(c.links) ? c.links : [];
  if (rawLinks.length > LINKS_MAX) {
    throw new Error(`At most ${LINKS_MAX} links per announcement.`);
  }
  const links: AnnouncementLink[] = [];
  for (const l of rawLinks) {
    const label = (l?.label ?? "").trim();
    const url = (l?.url ?? "").trim();
    if (label.length === 0 && url.length === 0) continue; // silently skip empty rows
    if (label.length === 0 || url.length === 0) {
      throw new Error("Each link requires both a label and a URL.");
    }
    if (label.length > LINK_LABEL_MAX) {
      throw new Error(`Link label must be <= ${LINK_LABEL_MAX} characters.`);
    }
    if (url.length > LINK_URL_MAX) {
      throw new Error(`Link URL must be <= ${LINK_URL_MAX} characters.`);
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`Link URL must start with http:// or https://: ${url}`);
    }
    links.push({ label, url });
  }

  // Image attachment validation. image_url is optional; image_alt is
  // optional but strongly encouraged for accessibility. The composer
  // surfaces a hint about screen-reader users; we don't reject empty
  // alt because (a) some images are decorative — WCAG actually wants
  // empty alt in that case — and (b) requiring alt tends to produce
  // low-quality "image" / "photo" alt strings that are worse than empty.
  let image_url: string | null = null;
  let image_alt: string | null = null;
  const rawUrl = typeof c.image_url === "string" ? c.image_url.trim() : "";
  const rawAlt = typeof c.image_alt === "string" ? c.image_alt.trim() : "";
  if (rawUrl.length > 0) {
    if (rawUrl.length > IMAGE_URL_MAX) {
      throw new Error(`Image URL must be <= ${IMAGE_URL_MAX} characters.`);
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      throw new Error("Image URL must start with http:// or https://.");
    }
    if (rawAlt.length > IMAGE_ALT_MAX) {
      throw new Error(`Alt text must be <= ${IMAGE_ALT_MAX} characters.`);
    }
    image_url = rawUrl;
    image_alt = rawAlt.length > 0 ? rawAlt : null;
  } else if (rawAlt.length > 0) {
    // Alt without an image is meaningless — treat as no image rather
    // than rejecting outright (the composer can race the two fields).
    image_url = null;
    image_alt = null;
  }

  return { title, body, links, image_url, image_alt };
}

/**
 * Slice 11 — admin moderation: remove an announcement. Marks the row
 * as removed (idempotent — repeated removes are no-ops on the state)
 * and emits a restricted-visibility `civic.process.updated` event for
 * the audit trail. The host hub persists the new state and is
 * responsible for excluding removed announcements from the public list
 * endpoint and the feed-derived digest.
 *
 * Restoration reuses the same shape — `restored_at` is stamped and the
 * `removed` flag flips back to false.
 */
export async function removeAnnouncement(
  state: AnnouncementProcessState,
  admin_id: string,
  reason: string,
  ctx: AnnouncementProcessContext,
): Promise<{ state: AnnouncementProcessState }> {
  const trimmedReason = (reason ?? "").trim();
  if (trimmedReason.length === 0) {
    throw new Error("A reason is required when removing an announcement.");
  }
  if (trimmedReason.length > MODERATION_REASON_MAX) {
    throw new Error(`Reason must be <= ${MODERATION_REASON_MAX} characters.`);
  }
  if (state.moderation?.removed) return { state };

  const now = new Date().toISOString();
  state.moderation = {
    removed: true,
    removed_at: now,
    removed_by: admin_id,
    reason: trimmedReason,
    restored_at: null,
  };

  await ctx.emit({
    event_type: "civic.process.updated",
    actor: admin_id,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.announcement",
    visibility: "restricted",
    action_url_path: `/announcement/${ctx.process_id}`,
    data: {
      moderation: {
        action: "announcement_removed",
        reason: trimmedReason,
        removed_by: admin_id,
      },
    },
  });

  return { state };
}

export async function restoreAnnouncement(
  state: AnnouncementProcessState,
  admin_id: string,
  ctx: AnnouncementProcessContext,
): Promise<{ state: AnnouncementProcessState }> {
  if (!state.moderation?.removed) return { state };

  const now = new Date().toISOString();
  const previousReason = state.moderation.reason ?? null;
  state.moderation = {
    ...state.moderation,
    removed: false,
    restored_at: now,
  };

  await ctx.emit({
    event_type: "civic.process.updated",
    actor: admin_id,
    process_id: ctx.process_id,
    hub_id: ctx.hub_id,
    jurisdiction: ctx.jurisdiction,
    processType: "civic.announcement",
    visibility: "restricted",
    action_url_path: `/announcement/${ctx.process_id}`,
    data: {
      moderation: {
        action: "announcement_restored",
        reason: previousReason,
        restored_by: admin_id,
      },
    },
  });

  return { state };
}

/**
 * Slice 11 — render the moderation field for the public read model in
 * a shape that's consistent regardless of legacy state.
 */
function moderationView(
  state: AnnouncementProcessState,
): AnnouncementModeration | null {
  return state.moderation ?? null;
}

/**
 * Public read model — what GET /announcement/:id returns.
 *
 * When the announcement has been removed by a moderator, the
 * content fields (body, image, links) are blanked out so a non-admin
 * caller can't reconstruct the body from the JSON payload. The page
 * still renders a tombstone in place. Admins receive the original
 * content via getAdminReadModel().
 */
export function getPublicReadModel(
  state: AnnouncementProcessState,
  processMeta: { id: string; createdAt: string },
): Record<string, unknown> {
  const moderation = moderationView(state);
  const removed = !!moderation?.removed;
  return {
    id: processMeta.id,
    type: "civic.announcement",
    title: state.content.title,
    body: removed ? "" : state.content.body,
    links: removed ? [] : state.content.links,
    image_url: removed ? null : state.content.image_url ?? null,
    image_alt: removed ? null : state.content.image_alt ?? null,
    author_id: state.author_id,
    author_role: state.author_role,
    official_type: state.official_type ?? null,
    author_display_name: state.author_display_name ?? null,
    created_at: state.created_at,
    last_edited_at: state.last_edited_at,
    edit_count: state.edit_count,
    moderation: moderation
      ? {
          removed,
          removed_at: moderation.removed_at,
          // The reason is internal-audit only; never expose to the
          // public read model. Admins read it via the admin endpoint.
          restored_at: moderation.restored_at,
        }
      : null,
  };
}

/**
 * Admin read model — same as getPublicReadModel but never redacts
 * content, and includes the moderator's reason. Used by the admin
 * announcement view and the moderation log so admins can audit and
 * potentially restore.
 */
export function getAdminReadModel(
  state: AnnouncementProcessState,
  processMeta: { id: string; createdAt: string },
): Record<string, unknown> {
  const moderation = moderationView(state);
  return {
    id: processMeta.id,
    type: "civic.announcement",
    title: state.content.title,
    body: state.content.body,
    links: state.content.links,
    image_url: state.content.image_url ?? null,
    image_alt: state.content.image_alt ?? null,
    author_id: state.author_id,
    author_role: state.author_role,
    official_type: state.official_type ?? null,
    author_display_name: state.author_display_name ?? null,
    created_at: state.created_at,
    last_edited_at: state.last_edited_at,
    edit_count: state.edit_count,
    moderation,
  };
}

/** Summary used by GET /announcements list. */
export function getPublicSummary(
  state: AnnouncementProcessState,
  processMeta: { id: string; createdAt: string },
): Record<string, unknown> {
  return {
    id: processMeta.id,
    type: "civic.announcement",
    title: state.content.title,
    image_url: state.content.image_url ?? null,
    image_alt: state.content.image_alt ?? null,
    author_role: state.author_role,
    official_type: state.official_type ?? null,
    author_display_name: state.author_display_name ?? null,
    created_at: state.created_at,
    last_edited_at: state.last_edited_at,
    edit_count: state.edit_count,
  };
}
