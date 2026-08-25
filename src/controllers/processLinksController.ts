// Light process-linking — read, create, and remove links between processes.
//
// TYPE-AGNOSTIC BY DESIGN. Not one line here names a process type. Every
// endpoint works off `processes.id`, so a process type registered in the
// future is linkable the day it exists, with no change to this file.
//
// Authorization: reading is public; writing is the process's creator OR an
// admin. That is what makes a resident's proposed links reviewable rather
// than merely permitted — the resident asserts the relationship, and the
// admin who reviews the submission can append to it or take it away.

import type { Request, Response } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import { getAuthUser, isAdminEmail } from "../middleware/auth.js";
import { getUserFromToken } from "../modules/civic.auth/index.js";
import { HUB_ID, DEFAULT_JURISDICTION } from "../config/hub.js";
import { processDetailPath } from "../processes/registry.js";
import {
  LinkValidationError,
  RELATIONS,
  RELATION_LABELS,
  suggestionSeed,
  validateLink,
} from "../modules/civic.process_links/index.js";
import {
  createEdge,
  deleteEdge,
  getEdgeById,
  getProcessOwner,
  getRenderedLinks,
} from "../services/processLinks.js";
import { executeSearchRpc } from "../services/searchExecutor.js";

/**
 * Resolve the caller on a PUBLIC route, where no auth middleware has run.
 * Returns undefined for anonymous or invalid-token callers rather than
 * throwing — an unreadable token is simply "not signed in" here.
 */
async function resolveCaller(
  req: Request,
): Promise<{ id: string; email: string } | undefined> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return undefined;
  const token = auth.slice(7);
  if (!token) return undefined;
  try {
    const user = await getUserFromToken(token);
    return user ? { id: user.id, email: user.email } : undefined;
  } catch {
    return undefined;
  }
}

/** GET /process/:id/links — public. Returns both directions. */
export async function handleGetLinks(req: Request, res: Response): Promise<void> {
  try {
    const processId = req.params.id as string;
    // PUBLIC route: no middleware has populated res.locals.authUser, so the
    // caller must be resolved from the bearer token directly (same shape as
    // eventController.callerIsAdmin). Reading res.locals here would make
    // isAdmin permanently false and quietly strip the add-link affordance
    // from every admin viewing a process they did not create.
    // Anonymous callers resolve to undefined and simply see the public view.
    const viewer = await resolveCaller(req);
    const viewerId = viewer?.id;
    const isAdmin = isAdminEmail(viewer?.email);

    const links = await getRenderedLinks(processId, { viewerId, isAdmin });

    // The server decides who may edit, so a page only has to mount the panel
    // — it never has to fetch created_by just to know which affordance to
    // show. Keeps the mount one line for every process type, present and
    // future.
    const source = await getProcessOwner(processId);
    const canEdit =
      Boolean(viewerId) && (isAdmin || (source?.created_by != null && source.created_by === viewerId));

    res.json({
      ...links,
      can_edit: canEdit,
      relations: RELATIONS.map((r) => ({ value: r, ...RELATION_LABELS[r] })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read links" });
  }
}

/** POST /process/:id/links — creator of the process, or an admin. */
export async function handleCreateLink(req: Request, res: Response): Promise<void> {
  try {
    const fromId = req.params.id as string;
    const user = getAuthUser(res);
    const isAdmin = isAdminEmail(user.email);

    const source = await getProcessOwner(fromId);
    if (!source) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    if (!isAdmin && source.created_by !== user.id) {
      res.status(403).json({
        error: "Only the person who created this process, or an admin, can add links to it.",
        code: "not_link_owner",
      });
      return;
    }

    const link = validateLink(fromId, req.body ?? {});

    const target = await getProcessOwner(link.to_id);
    if (!target) {
      res.status(404).json({ error: "The process you tried to link to was not found." });
      return;
    }

    const edge = await createEdge(fromId, link, user.id);

    // No silent state changes (CLAUDE.md design constraint #2). civic.process
    // .updated is default-CLOSED in the feed classifier, so this records the
    // change in the event log without posting a card to the feed.
    await emitEvent({
      event_type: "civic.process.updated",
      actor: user.id,
      process_id: fromId,
      hub_id: HUB_ID,
      jurisdiction: DEFAULT_JURISDICTION,
      processType: source.type,
      action_url_path: processDetailPath(source.type, fromId),
      visibility: "public",
      data: {
        process: {
          type: source.type,
          link: {
            action: "linked",
            link_id: edge.id,
            relation: edge.relation,
            to_id: edge.to_id,
          },
        },
      },
    });

    const links = await getRenderedLinks(fromId, { viewerId: user.id, isAdmin });
    res.status(201).json({ link_id: edge.id, ...links, can_edit: true });
  } catch (err) {
    if (err instanceof LinkValidationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to add link" });
  }
}

/** DELETE /process/:id/links/:linkId — creator of the process, or an admin. */
export async function handleDeleteLink(req: Request, res: Response): Promise<void> {
  try {
    const processId = req.params.id as string;
    const user = getAuthUser(res);
    const isAdmin = isAdminEmail(user.email);

    const edge = await getEdgeById(req.params.linkId as string);
    if (!edge) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    // The edge must actually touch the process in the URL, so a link can't be
    // removed by way of an unrelated process the caller happens to own.
    if (edge.from_id !== processId && edge.to_id !== processId) {
      res.status(404).json({ error: "Link not found on this process" });
      return;
    }

    // Removal is authorized against the process that AUTHORED the edge. The
    // process on the receiving end of a backlink did not assert the
    // relationship and does not get to silently drop it — only its author or
    // an admin can.
    const source = await getProcessOwner(edge.from_id);
    if (!isAdmin && source?.created_by !== user.id) {
      res.status(403).json({
        error: "Only the person who added this link, or an admin, can remove it.",
        code: "not_link_owner",
      });
      return;
    }

    await deleteEdge(edge.id);

    await emitEvent({
      event_type: "civic.process.updated",
      actor: user.id,
      process_id: edge.from_id,
      hub_id: HUB_ID,
      jurisdiction: DEFAULT_JURISDICTION,
      processType: source?.type,
      action_url_path: processDetailPath(source?.type ?? "", edge.from_id),
      visibility: "public",
      data: {
        process: {
          type: source?.type,
          link: {
            action: "unlinked",
            link_id: edge.id,
            relation: edge.relation,
            to_id: edge.to_id,
          },
        },
      },
    });

    const links = await getRenderedLinks(processId, { viewerId: user.id, isAdmin });
    // The caller just removed a link, so they can plainly still edit here.
    res.json({ ...links, can_edit: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to remove link" });
  }
}

/**
 * GET /process/link-candidates — typeahead over existing processes.
 *
 * Reuses the EXISTING search_processes RPC with no type filter, so every
 * process type is searchable here for free — including any added later, since
 * search_doc is maintained by a trigger on the processes table itself.
 *
 * `seed_title` / `seed_description` produce the auto-suggested candidates
 * shown before the user has typed anything: the new process's own words become
 * the query. `q` takes precedence once they start typing.
 */
export async function handleLinkCandidates(req: Request, res: Response): Promise<void> {
  try {
    const typed = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const seedTitle = typeof req.query.seed_title === "string" ? req.query.seed_title : "";
    const seedDesc =
      typeof req.query.seed_description === "string" ? req.query.seed_description : "";

    const suggested = typed.length === 0;
    const q = typed.length > 0 ? typed : suggestionSeed(seedTitle, seedDesc);
    if (q.length === 0) {
      res.json({ candidates: [], suggested });
      return;
    }

    const exclude = new Set(
      (Array.isArray(req.query.exclude) ? req.query.exclude : [req.query.exclude])
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    );

    const rows = await executeSearchRpc({
      q,
      internalTypes: null, // every process type, present and future
      from: null,
      to: null,
      sort: typed.length > 0 ? "relevance" : "relevance",
      limit: 8 + exclude.size,
      offset: 0,
    });

    const candidates = rows
      .filter((r) => !exclude.has(r.id))
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title || "(untitled)",
        status: r.status,
        href: processDetailPath(r.type, r.id),
      }));

    res.json({ candidates, suggested });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
}
