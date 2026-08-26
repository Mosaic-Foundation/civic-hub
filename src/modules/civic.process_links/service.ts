// civic.process_links — pure validation and both-direction rendering.
//
// Everything here is a pure function over data the caller supplies. The
// Supabase adapter lives in src/services/processLinks.ts; this module never
// imports it.

import {
  RELATIONS,
  RELATION_LABELS,
  type LinkPeer,
  type LinkProposal,
  type ProcessLinkEdge,
  type RelationType,
  type RenderedLink,
  type RenderedLinks,
} from "./models.js";

export class LinkValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unknown_relation"
      | "self_link"
      | "missing_target"
      | "too_many",
  ) {
    super(message);
    this.name = "LinkValidationError";
  }
}

/** Cap on links per process. Not a scaling limit — a UI one. A page listing
 *  forty "related" processes has stopped relating anything. */
export const MAX_LINKS_PER_PROCESS = 20;

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && (RELATIONS as readonly string[]).includes(value);
}

/**
 * Validate one proposed link and return it normalized.
 *
 * Throws LinkValidationError rather than returning a result union because
 * every caller (route, review submission, draft materialization) wants the
 * same thing: refuse the write and surface the reason.
 */
export function validateLink(
  fromId: string,
  proposal: { to_id?: unknown; relation?: unknown },
): LinkProposal {
  const toId = typeof proposal.to_id === "string" ? proposal.to_id.trim() : "";
  if (toId.length === 0) {
    throw new LinkValidationError("A related process must be chosen.", "missing_target");
  }
  if (!isRelationType(proposal.relation)) {
    throw new LinkValidationError(
      `Unknown relation. Expected one of: ${RELATIONS.join(", ")}.`,
      "unknown_relation",
    );
  }
  if (toId === fromId) {
    throw new LinkValidationError("A process cannot be linked to itself.", "self_link");
  }
  return { to_id: toId, relation: proposal.relation };
}

/**
 * Validate a whole set of proposed links (the draft / submission path).
 * Duplicates within the batch are collapsed rather than rejected — asserting
 * the same relationship twice in one form is a slip, not an error.
 */
export function validateLinkSet(
  fromId: string,
  proposals: unknown,
): LinkProposal[] {
  if (proposals === undefined || proposals === null) return [];
  if (!Array.isArray(proposals)) {
    throw new LinkValidationError("`links` must be an array.", "missing_target");
  }
  const seen = new Set<string>();
  const out: LinkProposal[] = [];
  for (const raw of proposals) {
    if (typeof raw !== "object" || raw === null) {
      throw new LinkValidationError("Each link must be an object.", "missing_target");
    }
    const link = validateLink(fromId, raw as Record<string, unknown>);
    const key = `${link.to_id}::${link.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  if (out.length > MAX_LINKS_PER_PROCESS) {
    throw new LinkValidationError(
      `A process can have at most ${MAX_LINKS_PER_PROCESS} links.`,
      "too_many",
    );
  }
  return out;
}

/**
 * Render the edges touching `processId` from that process's point of view.
 *
 * THE BOTH-DIRECTION RENDER. Each edge is stored once. An edge whose from_id
 * is this process renders as outgoing with the forward label; the SAME edge,
 * read from the other end, renders as incoming with the back label. Neither
 * side is stored twice, so neither side can go stale.
 *
 * `peers` maps process id -> hydrated peer. An edge whose peer is absent from
 * the map is dropped: that is how a non-public process (pending_review,
 * archived) stays out of everyone else's page without this function needing
 * to know why it was withheld.
 */
export function renderLinks(
  processId: string,
  edges: ProcessLinkEdge[],
  peers: Map<string, LinkPeer>,
): RenderedLinks {
  const outgoing: RenderedLink[] = [];
  const incoming: RenderedLink[] = [];

  for (const edge of edges) {
    const isOutgoing = edge.from_id === processId;
    const isIncoming = edge.to_id === processId;
    // An edge that touches neither end isn't ours to render. (Also the
    // self-link case, which the schema forbids but which we refuse to
    // double-render if one ever slipped in.)
    if (isOutgoing === isIncoming) continue;

    const peerId = isOutgoing ? edge.to_id : edge.from_id;
    const peer = peers.get(peerId);
    if (!peer) continue;

    const labels = RELATION_LABELS[edge.relation];
    if (!labels) continue;

    const rendered: RenderedLink = {
      id: edge.id,
      relation: edge.relation,
      direction: isOutgoing ? "outgoing" : "incoming",
      label: isOutgoing ? labels.forward : labels.back,
      peer,
      created_by: edge.created_by,
      created_at: edge.created_at,
    };
    (isOutgoing ? outgoing : incoming).push(rendered);
  }

  const byNewest = (a: RenderedLink, b: RenderedLink) =>
    b.created_at.localeCompare(a.created_at);
  outgoing.sort(byNewest);
  incoming.sort(byNewest);

  return { outgoing, incoming };
}

/**
 * Derive a typeahead seed query from a process's own words, for the
 * auto-suggested candidates shown before the user types anything.
 *
 * Deliberately crude: strip stopwords, keep the distinctive terms, cap the
 * count. Good enough to put likely links in front of someone; not trying to
 * be a recommender.
 *
 * THE TERMS ARE JOINED WITH EXPLICIT `OR`, and that is load-bearing.
 * websearch_to_tsquery ANDs bare space-separated terms, so a six-word seed
 * would demand all six words co-occur in the target — which essentially
 * nothing satisfies, and the whole suggestion feature silently returns
 * nothing. (It did exactly that until a dev smoke test caught it.) A typed
 * query is passed through untouched, because AND is what someone typing two
 * words actually means.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "for", "of", "to", "in", "on", "at",
  "by", "with", "from", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "should", "would", "could", "we", "our",
  "us", "you", "your", "county", "city", "town",
]);

export function suggestionSeed(title: string, description = ""): string {
  const words = `${title} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    distinct.push(w);
    if (distinct.length >= 6) break;
  }
  return distinct.join(" OR ");
}

// --- Authorization decisions -----------------------------------------------
//
// These are the JUDGMENTS the HTTP layer makes, extracted as pure functions
// over plain values.
//
// WHY THEY LIVE HERE. Every one of them was previously inline in the
// controller, where the only thing that could test them was a running server
// and a live database — neither of which CI has. `canEditLinks` in particular
// shipped BROKEN: the controller derived `isAdmin` from `res.locals.authUser`
// on a route with no auth middleware, so it was permanently false and admins
// silently lost the add-link affordance on any process they had not created.
// A green unit suite could not have caught it, because the decision was not
// separable from the wiring.
//
// Now the decision is testable and the wiring is one line that reads
// obviously. That does not make the wiring impossible to get wrong — it makes
// it hard to get wrong quietly.

/**
 * May this viewer add or remove links on this process?
 *
 * The process's creator, or an admin. Anonymous callers never can — which is
 * why `viewerId` being absent short-circuits before the admin check: an
 * unauthenticated request has no identity to be an admin *with*.
 */
export function canEditLinks(input: {
  viewerId: string | null | undefined;
  isAdmin: boolean;
  processCreatedBy: string | null | undefined;
}): boolean {
  if (!input.viewerId) return false;
  if (input.isAdmin) return true;
  return input.processCreatedBy != null && input.processCreatedBy === input.viewerId;
}

/**
 * May this viewer remove this particular edge?
 *
 * Authorized against the process that AUTHORED the edge, never the one on the
 * receiving end: a backlink is someone else's assertion about you, and the
 * target does not get to silently drop it.
 */
export function canRemoveLink(input: {
  viewerId: string | null | undefined;
  isAdmin: boolean;
  /** created_by of the edge's FROM process — the one that asserted it. */
  sourceCreatedBy: string | null | undefined;
}): boolean {
  return canEditLinks({
    viewerId: input.viewerId,
    isAdmin: input.isAdmin,
    processCreatedBy: input.sourceCreatedBy,
  });
}

/**
 * Does this edge actually touch the process named in the request?
 *
 * Guards against removing a link by way of an unrelated process the caller
 * happens to own.
 */
export function edgeBelongsToProcess(
  edge: { from_id: string; to_id: string },
  processId: string,
): boolean {
  return edge.from_id === processId || edge.to_id === processId;
}

/**
 * Is this link backed by a row that can be deleted at all?
 *
 * False for DERIVED links (the brief ⇄ source pair, computed from
 * `state.source_process_id`) and for PROJECTED ones (a brief showing the links
 * of the process it summarizes). Neither has a row here to remove.
 */
export function isRemovableLink(link: { synthetic?: boolean; inherited?: boolean }): boolean {
  return !link.synthetic && !link.inherited;
}
