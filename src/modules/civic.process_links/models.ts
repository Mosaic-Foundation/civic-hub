// civic.process_links — type definitions.
//
// Service module (not a process type). Same plug-in style as civic.search:
// pure functions, no Express, no DB, no environment access.
//
// UNIVERSAL BY CONSTRUCTION. Nothing in this module names a process type.
// Linking is a property of `processes`, not of any handler, so a process type
// registered in the future is linkable with no change here.

/** The relation vocabulary. Mirrored by a CHECK constraint in the migration —
 *  keep the two in step. */
export const RELATIONS = ["continues", "references", "implements"] as const;

export type RelationType = (typeof RELATIONS)[number];

export type LinkDirection = "outgoing" | "incoming";

/** One stored edge, exactly as it lives in the table. */
export interface ProcessLinkEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: RelationType;
  created_by: string | null;
  created_at: string;
}

/** The other end of a link, hydrated for display. */
export interface LinkPeer {
  id: string;
  type: string;
  title: string;
  status: string;
  href: string;
}

/** One link as rendered on a process page. `direction` says which side of the
 *  stored edge this process is on; `label` is already resolved for that side,
 *  so the view layer never has to reason about direction. */
export interface RenderedLink {
  id: string;
  relation: RelationType;
  direction: LinkDirection;
  label: string;
  peer: LinkPeer;
  created_by: string | null;
  created_at: string;
  /**
   * True for a relationship DERIVED from data the system already holds rather
   * than stored as a process_links row — today, the brief ⇄ source pair, which
   * comes from the brief's own `state.source_process_id`. There is no row to
   * delete, so the UI must not offer a remove control on these.
   */
  synthetic?: boolean;
  /**
   * True for a link that belongs to a DIFFERENT process and is being shown
   * here for context — today, a brief displaying the links of the process it
   * summarizes. The row lives on that other process; this is a projection, so
   * the UI must not offer a remove control.
   */
  inherited?: boolean;
}

export interface RenderedLinks {
  outgoing: RenderedLink[];
  incoming: RenderedLink[];
}

/**
 * Human labels for each end of an edge.
 *
 * `forward` reads from the process that authored the link; `back` reads from
 * the process on the receiving end. Both come from the SAME stored row — this
 * table is the entire reason a backlink needs no separate record.
 */
export const RELATION_LABELS: Record<
  RelationType,
  { forward: string; back: string; description: string }
> = {
  continues: {
    forward: "Continues",
    back: "Continued by",
    description: "Picks up where an earlier process left off",
  },
  references: {
    forward: "References",
    back: "Referenced by",
    description: "Cites or draws on another process",
  },
  implements: {
    forward: "Implements",
    back: "Implemented by",
    description: "Carries out what another process decided",
  },
};

/** A link as proposed before it is stored — what a draft carries and what the
 *  write endpoint accepts. */
export interface LinkProposal {
  to_id: string;
  relation: RelationType;
}

/**
 * NOTE — this module deliberately does NOT define which statuses are public.
 *
 * `services/processLifecycle.ts` owns that (NON_PUBLIC_STATUSES / isPublic),
 * and a second list here would be a second source of truth for the same
 * question — the exact drift the schema contract exists to prevent. Visibility
 * is decided by the caller, which hydrates only the peers the viewer may see;
 * renderLinks() simply drops any edge whose peer is absent from the map.
 */
