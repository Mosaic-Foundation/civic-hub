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

import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { route } from "../http/route.js";
import type { Request } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import { getActor, getAuthUser, resolveCaller } from "../middleware/auth.js";
import { can } from "../authz/canActor.js";
import { defaultJurisdiction } from "../config/hub.js";
import { processDetailPath, summarizedProcessIdOf } from "../processes/registry.js";
import type { RenderedLink, RenderedLinks } from "../modules/civic.process_links/index.js";
import { canEditLinks, canRemoveLink, edgeBelongsToProcess, RELATIONS, RELATION_LABELS, suggestionSeed, validateLink } from "../modules/civic.process_links/index.js";
import {
  createEdge,
  deleteEdge,
  getBriefLinks,
  getEdgeById,
  getProcessOwner,
  getRenderedLinks,
} from "../services/processLinks.js";
import { getProcess } from "../services/processService.js";
import { isProcessTypeEnabled } from "../services/pluginGate.js";
import { executeSearchRpc } from "../services/searchExecutor.js";


/**
 * For a brief, the links belonging to the process it summarizes — projected
 * onto the brief so the published record carries the whole thread.
 *
 * Returns nothing for anything that is not a brief. The source's own brief
 * pair is excluded, because from the brief's point of view that is itself.
 */
async function inheritedFromSource(
  processId: string,
  opts: { viewerId?: string | null; isAdmin?: boolean },
): Promise<RenderedLinks> {
  const empty: RenderedLinks = { outgoing: [], incoming: [] };
  const proc = await getProcess(processId);
  if (!proc) return empty;

  const sourceId = summarizedProcessIdOf(proc.definition.type, proc.state as Record<string, unknown> | null);
  if (!sourceId) return empty;

  const sourceLinks = await getRenderedLinks(sourceId, opts);
  const mark = (l: RenderedLink): RenderedLink => ({ ...l, inherited: true });
  return {
    outgoing: sourceLinks.outgoing.map(mark),
    incoming: sourceLinks.incoming.filter((l) => l.peer.id !== processId).map(mark),
  };
}

/** GET /process/:id/links — public. Returns both directions. */
export const handleGetLinks = route(async (req, res) => {
  const processId = req.params.id as string;
  // PUBLIC route: no middleware has populated res.locals.authUser, so the
  // caller must be resolved from the bearer token directly (same shape as
  // eventController.callerIsAdmin). Reading res.locals here would make
  // isAdmin permanently false and quietly strip the add-link affordance
  // from every admin viewing a process they did not create.
  // Anonymous callers resolve to undefined and simply see the public view.
  const { user: viewer, actor } = await resolveCaller(req);
  const viewerId = viewer?.id;
  const isAdmin = await can(actor, "hub.see_as_admin");

  // A process whose plugin the hub switched off has no links to show: its
  // page is gone (src/services/pluginGate.ts).
  const source = await getProcessOwner(processId);
  if (source && !isProcessTypeEnabled(source.type)) {
    throw new NotFoundError("Process not found");
  }

  const own = await getRenderedLinks(processId, { viewerId, isAdmin });

  // The brief pair, derived from state.source_process_id rather than stored.
  const brief = await getBriefLinks(processId, { viewerId, isAdmin });

  // A brief also SHOWS the links of the process it summarizes, so the
  // permanent record carries the thread instead of dead-ending. Projected,
  // never copied: the rows stay on the source, so there is still exactly one
  // record per relationship and the brief cannot drift from it. Marked
  // `inherited` so the UI can render them without a remove control — they
  // are not the brief's to sever.
  const inherited = await inheritedFromSource(processId, { viewerId, isAdmin });

  const links = {
    outgoing: [...brief.outgoing, ...own.outgoing, ...inherited.outgoing],
    incoming: [...brief.incoming, ...own.incoming, ...inherited.incoming],
  };

  // The server decides who may edit, so a page only has to mount the panel
  // — it never has to fetch created_by just to know which affordance to
  // show. Keeps the mount one line for every process type, present and
  // future.
  const canEdit = canEditLinks({
    viewerId,
    isAdmin,
    processCreatedBy: source?.created_by,
  });

  res.json({
    ...links,
    can_edit: canEdit,
    relations: RELATIONS.map((r) => ({ value: r, ...RELATION_LABELS[r] })),
  });
});

/** POST /process/:id/links — creator of the process, or an admin. */
export const handleCreateLink = route(async (req, res) => {
  const fromId = req.params.id as string;
  const user = getAuthUser(res);
  const isAdmin = await can(getActor(res), "hub.administer");

  const source = await getProcessOwner(fromId);
  if (!source || !isProcessTypeEnabled(source.type)) {
    throw new NotFoundError("Process not found");
  }
  if (!canEditLinks({ viewerId: user.id, isAdmin, processCreatedBy: source.created_by })) {
    throw new ForbiddenError(
      "Only the person who created this process, or an admin, can add links to it.",
      "not_link_owner",
    );
  }

  const link = validateLink(fromId, req.body ?? {});

  const target = await getProcessOwner(link.to_id);
  if (!target || !isProcessTypeEnabled(target.type)) {
    throw new NotFoundError("The process you tried to link to was not found.", "link_target_not_found");
  }

  const edge = await createEdge(fromId, link, user.id);

  // No silent state changes (CLAUDE.md design constraint #2). civic.process
  // .updated is default-CLOSED in the feed classifier, so this records the
  // change in the event log without posting a card to the feed.
  await emitEvent({
    event_type: "civic.process.updated",
    actor: user.id,
    process_id: fromId,
    jurisdiction: defaultJurisdiction(),
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
});

/** DELETE /process/:id/links/:linkId — creator of the process, or an admin. */
export const handleDeleteLink = route(async (req, res) => {
  const processId = req.params.id as string;
  const user = getAuthUser(res);
  const isAdmin = await can(getActor(res), "hub.administer");

  const edge = await getEdgeById(req.params.linkId as string);
  if (!edge) {
    throw new NotFoundError("Link not found");
  }
  // The edge must actually touch the process in the URL, so a link can't be
  // removed by way of an unrelated process the caller happens to own.
  if (!edgeBelongsToProcess(edge, processId)) {
    throw new NotFoundError("Link not found on this process");
  }

  // Removal is authorized against the process that AUTHORED the edge. The
  // process on the receiving end of a backlink did not assert the
  // relationship and does not get to silently drop it — only its author or
  // an admin can.
  const source = await getProcessOwner(edge.from_id);
  const here = edge.from_id === processId ? source : await getProcessOwner(processId);
  if (here && !isProcessTypeEnabled(here.type)) {
    throw new NotFoundError("Process not found");
  }
  if (!canRemoveLink({ viewerId: user.id, isAdmin, sourceCreatedBy: source?.created_by })) {
    throw new ForbiddenError("Only the person who added this link, or an admin, can remove it.", "not_link_owner");
  }

  await deleteEdge(edge.id);

  await emitEvent({
    event_type: "civic.process.updated",
    actor: user.id,
    process_id: edge.from_id,
    jurisdiction: defaultJurisdiction(),
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
});

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
export const handleLinkCandidates = route(async (req, res) => {
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
});
