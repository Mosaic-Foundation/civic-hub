// Announcement controller — Board / admin posting and editing, plus the
// public read surface.
//
// POST /announcement            — create (requireBoardOrAdmin)
// PATCH /announcement/:id       — edit (requireBoardOrAdmin + authorship check inside)
// GET /announcement/:id         — public read
// GET /announcements            — public list

import { Request, Response } from "express";
import {
  emitPublicationEvents,
  getAdminReadModel,
  getPublicReadModel,
  getPublicSummary,
  updateAnnouncement,
  type AnnouncementAuthorRole,
  type AnnouncementContentPatch,
  type AnnouncementLink,
  type AnnouncementProcessState,
} from "../modules/civic.announcement/index.js";
import { emitEvent } from "../events/eventEmitter.js";
import {
  createProcess,
  getAllProcesses,
  getProcess,
  saveProcessState,
} from "../services/processService.js";
import {
  getAuthUser,
  isAdminEmail,
  resolveCallerId,
} from "../middleware/auth.js";
import { enrichCreator } from "../services/creatorDisplay.js";
import { getUserFromToken, getUser } from "../modules/civic.auth/index.js";
import { extractUrls } from "../modules/civic.link_preview/index.js";
import { warmPreviewsInBackground } from "../services/linkPreviewCache.js";

function getState(record: { state: Record<string, unknown> }): AnnouncementProcessState {
  return record.state as unknown as AnnouncementProcessState;
}

function ctxFor(record: { id: string; hubId: string; jurisdiction: string }) {
  return {
    process_id: record.id,
    hub_id: record.hubId,
    jurisdiction: record.jurisdiction,
    emit: emitEvent,
  };
}

/** Read an announcement's links payload from a request body, or return []. */
function readLinks(body: unknown): AnnouncementLink[] | undefined {
  const b = body as { links?: unknown } | null | undefined;
  if (!b || b.links === undefined) return undefined;
  if (!Array.isArray(b.links)) {
    throw new Error("links must be an array");
  }
  return b.links
    .filter(
      (l): l is { label: string; url: string } =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as { label?: unknown }).label === "string" &&
        typeof (l as { url?: unknown }).url === "string",
    )
    .map((l) => ({ label: l.label, url: l.url }));
}

export async function handleCreateAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const user = getAuthUser(res);
    // The middleware resolved the user's display label. For an official
    // this is their office title ("Board of Supervisors"); for a plain
    // admin it is "Admin". The office WINS for someone who is both —
    // author_role drives the feed pill and the page eyebrow, which hold
    // one value, and a supervisor's post should read as coming from the
    // Board. The separate Admin badge next to their name is unaffected.
    const authorLabel = res.locals.authorLabel as AnnouncementAuthorRole | undefined;
    // The machine-readable half of the same designation. Null when the
    // poster is a plain admin (no office) — the label carries "Admin".
    const authorOfficial = res.locals.authorOfficial as
      | { type: string; title: string }
      | null
      | undefined;
    if (!authorLabel) {
      throw new Error(
        "authorLabel missing on res.locals — requireAnnouncementPoster must run before this handler.",
      );
    }
    const body = (req.body ?? {}) as {
      title?: unknown;
      body?: unknown;
      image_url?: unknown;
      image_alt?: unknown;
    };

    if (typeof body.title !== "string" || typeof body.body !== "string") {
      res.status(400).json({ error: "title and body are required (string)." });
      return;
    }

    const links = readLinks(req.body);
    const image_url =
      typeof body.image_url === "string" && body.image_url.trim().length > 0
        ? body.image_url.trim()
        : null;
    const image_alt =
      typeof body.image_alt === "string" && body.image_alt.trim().length > 0
        ? body.image_alt.trim()
        : null;

    // Spawn the process via the generic factory. The announcementProcess
    // handler's initializeState normalizes this flat input into the
    // module's nested AnnouncementProcessState shape (and runs the
    // image alt-text-required validation).
    const record = await createProcess({
      definition: { type: "civic.announcement", version: "0.1" },
      title: body.title,
      description: body.body, // descriptor shows the body as description for list consumers
      createdBy: user.id,
      state: {
        title: body.title,
        body: body.body,
        author_id: user.id,
        author_role: authorLabel,
        official_type: authorOfficial?.type ?? null,
        // Prefer the admin-curated name from the author list; fall back to
        // the poster's own account name when the admin left it blank.
        author_display_name:
          (res.locals.authorName as string | null | undefined) ||
          (await getUser(user.id))?.display_name ||
          null,
        links: links ?? [],
        image_url,
        image_alt,
      },
    });

    // The generic factory emitted civic.process.created with a minimal
    // payload. Our module fires BOTH created (with announcement-specific
    // data) and result_published. To avoid duplicate `created` events,
    // emit only result_published here. The Feed's event-type filter will
    // ignore the generic created event from the generic factory for
    // civic.announcement (see FeedPost.tsx).
    const state = getState(record);
    const ctx = ctxFor(record);
    // The module's emitPublicationEvents fires both created + result_published,
    // which would duplicate the generic created. We want only the module's
    // richer `created` plus `result_published`, so we also need the generic
    // created to be filtered client-side. Simpler: just fire result_published
    // here. The generic created from processService already carries type +
    // title, which is enough for consumers that only look at core fields.
    const events = await import("../modules/civic.announcement/events.js");
    await events.emitAnnouncementResultPublished(ctx, user.id, state);

    // Auto-finalize the process status — announcements are instant-publish.
    record.status = "finalized";
    await saveProcessState(record);

    // Fire-and-forget: warm the link-preview cache for any URLs in the
    // body so the public page renders previews on first view. Linked
    // URLs in the structured `links` array are warmed too — they're
    // less likely to need previews (the label is curated already), but
    // it costs us nothing and keeps the feed card image fallback chain
    // honest.
    const linkUrls = (links ?? []).map((l) => l.url);
    const allUrls = Array.from(
      new Set([...extractUrls(body.body), ...linkUrls]),
    );
    if (allUrls.length > 0) warmPreviewsInBackground(allUrls);

    const created = await enrichCreator(
      getPublicReadModel(state, {
        id: record.id,
        createdAt: record.createdAt,
      }),
      { rawIdField: "author_id" },
    );
    created.is_owner = true; // the poster is, by definition, the author
    res.status(201).json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleUpdateAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.announcement") {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }
    const user = getAuthUser(res);
    // effectiveRole is the permission role ("admin" | "author"), distinct
    // from authorLabel which is the free-form display string.
    const role = res.locals.effectiveRole as "admin" | "author";

    const body = (req.body ?? {}) as {
      title?: unknown;
      body?: unknown;
      links?: unknown;
      image_url?: unknown;
      image_alt?: unknown;
    };
    const patch: AnnouncementContentPatch = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.body === "string") patch.body = body.body;
    if (body.links !== undefined) {
      const links = readLinks(req.body);
      if (links !== undefined) patch.links = links;
    }
    // image_url / image_alt patch semantics: explicit `null` removes,
    // a string sets/replaces, undefined leaves the field alone. The
    // module's updateAnnouncement runs sanitizeContent which enforces
    // the alt-required-when-image-set rule.
    if (body.image_url === null || typeof body.image_url === "string") {
      patch.image_url = body.image_url as string | null;
    }
    if (body.image_alt === null || typeof body.image_alt === "string") {
      patch.image_alt = body.image_alt as string | null;
    }

    const state = getState(record);
    try {
      const outcome = await updateAnnouncement(
        state,
        { id: user.id, role },
        patch,
        ctxFor(record),
      );
      await saveProcessState(record);

      // Warm previews for whatever URLs are in the post-edit body. We
      // do this on every edit (not just body edits) because admins
      // sometimes update the linked URL list and the body's URLs change
      // implicitly with rephrasing.
      const linkUrls = (outcome.state.content.links ?? []).map((l) => l.url);
      const allUrls = Array.from(
        new Set([...extractUrls(outcome.state.content.body), ...linkUrls]),
      );
      if (allUrls.length > 0) warmPreviewsInBackground(allUrls);

      const callerId = await resolveCallerId(req);
      const updated = await enrichCreator(
        getPublicReadModel(outcome.state, {
          id: record.id,
          createdAt: record.createdAt,
        }),
        { rawIdField: "author_id" },
      );
      updated.is_owner =
        !!callerId &&
        (outcome.state as { author_id?: string }).author_id === callerId;
      res.json({ ...updated, edited_fields: outcome.result.edited_fields });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.startsWith("Not authorized")) {
        res.status(403).json({ error: message });
      } else {
        res.status(400).json({ error: message });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * Best-effort detection of an admin caller. Used to decide whether the
 * read endpoint should return the full content (admins) or the
 * tombstone-redacted public view (everyone else). Returns false on any
 * error / missing token — fail-closed.
 */
async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (!token) return false;
  try {
    const user = await getUserFromToken(token);
    if (!user) return false;
    return isAdminEmail(user.email);
  } catch {
    return false;
  }
}

export async function handleGetAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const record = await getProcess(id);
    if (!record || record.definition.type !== "civic.announcement") {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }
    // Admins see the original content (and the moderator's reason)
    // even after a removal, so they can audit and potentially restore.
    // Everyone else gets the public view, which redacts the body /
    // image / links to a tombstone if the announcement was removed.
    const isAdmin = await callerIsAdmin(req);
    const meta = { id: record.id, createdAt: record.createdAt };
    // Attach resolved author attribution (name + admin flag) from author_id.
    const model = isAdmin
      ? getAdminReadModel(getState(record), meta)
      : getPublicReadModel(getState(record), meta);
    // Owner edit-affordance is a server-computed boolean so the raw author_id
    // never leaves the API (enrichCreator redacts it — keepRawId omitted).
    const callerId = await resolveCallerId(req);
    const enriched = await enrichCreator(model, { rawIdField: "author_id" });
    enriched.is_owner =
      !!callerId && (model as { author_id?: string }).author_id === callerId;
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleListAnnouncements(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const limitRaw = req.query.limit as string | undefined;
    const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw, 10))) : undefined;

    const all = await getAllProcesses();
    const summaries = all
      .filter((p) => p.definition.type === "civic.announcement")
      // Slice 11 — exclude announcements an admin has removed. Distinct
      // from the comment-tombstone behavior: an announcement in the
      // public list is an affirmative publication; once removed it
      // shouldn't continue to broadcast its presence. Admins reach the
      // record via the moderation log, not this endpoint.
      .filter((p) => {
        const state = getState(p) as AnnouncementProcessState;
        return !state.moderation?.removed;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map((p) =>
        getPublicSummary(getState(p), {
          id: p.id,
          createdAt: p.createdAt,
        }),
      );

    res.json(limit ? summaries.slice(0, limit) : summaries);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
