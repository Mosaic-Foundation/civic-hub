// Per-process resident numbering — the public-audience "Resident N" map.
//
// PUBLIC ANONYMITY (2026-08-31). When an unauthenticated viewer opens a
// process detail page (a proposal, project, or vote with its comment
// thread), residents who co-appear there are distinguished as
// "Resident 1", "Resident 2", … — numbered by order of FIRST APPEARANCE
// within that one process (the author is normally #1, then comment
// authors by earliest timestamp).
//
// THE FINGERPRINT GUARDRAIL — read before changing anything here:
// the number is scoped to ONE process and is INDEPENDENT across
// processes. The same person may be "Resident 3" in one process and
// "Resident 1" in another, and that is the point: a stable public
// per-user marker (a global number, a per-account color, a persistent
// pseudonym) would be a tracking handle that re-links a person's
// contributions across the site — the exact fingerprint this feature
// exists to prevent. Never make this map global, persisted per-account,
// or derived from the user id alone.
//
// Read-time and deterministic: both the process-state endpoint and the
// comments endpoint rebuild the same map from the same rows with the
// same rule, so the author byline and the comment bylines on one page
// always agree — no migration, no stored index.

import { getDb } from "../db/client.js";
import { getProcess } from "./processService.js";
import { getInputsByProcess } from "../modules/civic.input/index.js";
import { listProjectComments } from "../modules/civic.projects/index.js";
import { resolveCreators } from "./creatorDisplay.js";

/** A (user id, first-seen timestamp) contribution inside one process. */
export interface Contribution {
  id: string;
  at: string; // ISO 8601
}

/**
 * Pure core, exported for unit tests: dedupe contributions to each id's
 * earliest appearance, drop exempt contributors (officials and admins —
 * both are shown by role/name publicly, never as "Resident N", so they
 * must not consume a number), order by first appearance, and assign
 * 1..N. Ties on identical timestamps fall back to id order so the result
 * is deterministic across requests.
 */
export function assignResidentNumbers(
  contributions: Contribution[],
  isExempt: (id: string) => boolean,
): Map<string, number> {
  const earliest = new Map<string, string>();
  for (const c of contributions) {
    if (!c.id) continue;
    const seen = earliest.get(c.id);
    if (!seen || c.at < seen) earliest.set(c.id, c.at);
  }
  const ordered = [...earliest.entries()]
    .filter(([id]) => !isExempt(id))
    .sort(([idA, atA], [idB, atB]) =>
      atA < atB ? -1 : atA > atB ? 1 : idA < idB ? -1 : 1,
    );
  const numbers = new Map<string, number>();
  ordered.forEach(([id], index) => numbers.set(id, index + 1));
  return numbers;
}

async function getSourceProposalId(processId: string): Promise<string | null> {
  const { data } = await getDb()
    .from("processes")
    .select("source_proposal_id")
    .eq("id", processId)
    .maybeSingle();
  return (
    (data as { source_proposal_id: string | null } | null)
      ?.source_proposal_id ?? null
  );
}

async function getProposalAuthor(
  id: string,
): Promise<Contribution | null> {
  const { data } = await getDb()
    .from("proposals")
    .select("submitted_by, created_at")
    .eq("id", id)
    .maybeSingle();
  const row = data as { submitted_by: string; created_at: string } | null;
  return row?.submitted_by ? { id: row.submitted_by, at: row.created_at } : null;
}

/**
 * Build the id → N numbering map for one process detail page.
 *
 * Contributors gathered: the author (process row, or the proposals table
 * for a standalone proposal), every NON-anonymous community-input author
 * (including the merged source-proposal comments a converted vote carries
 * forward — matching handleGetInputs so both endpoints number from the
 * same set), and project comment authors for civic.project pages.
 * Anonymous comments never join the map — they already display as
 * "Anonymous" for everyone.
 *
 * Failure posture matches the creator resolver: numbering is a display
 * nicety, so any storage error degrades to an empty map (plain
 * "Resident") rather than failing the page.
 */
export async function buildProcessAnonNumbers(
  processId: string,
): Promise<Map<string, number>> {
  try {
    const contributions: Contribution[] = [];

    const process = await getProcess(processId);
    if (process) {
      if (process.createdBy) {
        contributions.push({ id: process.createdBy, at: process.createdAt });
      }
      const sourceProposalId = await getSourceProposalId(processId);
      if (sourceProposalId) {
        const proposalAuthor = await getProposalAuthor(sourceProposalId);
        if (proposalAuthor) contributions.push(proposalAuthor);
        for (const input of await getInputsByProcess(sourceProposalId)) {
          if (!input.is_anonymous && input.author_id) {
            contributions.push({ id: input.author_id, at: input.submitted_at });
          }
        }
      }
      if (process.definition.type === "civic.project") {
        for (const comment of await listProjectComments(processId)) {
          if (comment.user_id) {
            contributions.push({ id: comment.user_id, at: comment.created_at });
          }
        }
      }
    } else {
      // Standalone proposal — not a processes row.
      const proposalAuthor = await getProposalAuthor(processId);
      if (proposalAuthor) contributions.push(proposalAuthor);
    }

    for (const input of await getInputsByProcess(processId)) {
      if (!input.is_anonymous && input.author_id) {
        contributions.push({ id: input.author_id, at: input.submitted_at });
      }
    }

    if (contributions.length === 0) return new Map();

    const creators = await resolveCreators(contributions.map((c) => c.id));
    return assignResidentNumbers(contributions, (id) => {
      const creator = creators.get(id);
      return !!creator?.official || !!creator?.is_admin;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error(`[processAnonymity] numbering failed for ${processId}: ${msg}`);
    return new Map();
  }
}
