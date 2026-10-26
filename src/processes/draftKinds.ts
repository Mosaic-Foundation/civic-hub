// What a drafting kind is (Audit 3, F1): what its draft stores (a DraftSpec
// for the generic store, src/modules/civic.drafts/) and what submitting it
// creates. The routes, the
// controller, the claim against a double submit and the Code of Conduct gate
// are shared (src/controllers/draftController.ts, src/routes/draftRoutes.ts).
// A plugin package declares its type's kind in its own draftKind.ts and
// returns it from server(host) (ADR-014); the hub mounts draftRouter(kind).

import type { DraftSpec, BaseDraft } from "../modules/civic.drafts/index.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** What submitting a draft creates (or, on a revision, rewrites). */
export interface DraftSubmission {
  title: string;
  description: string;
  content?: Record<string, unknown>;
  state?: Record<string, unknown>;
  /** What a revision writes instead, where it differs from a new submission. */
  revise?: { content?: Record<string, unknown>; state?: Record<string, unknown> };
}

export interface DraftKind<D extends BaseDraft = BaseDraft> {
  spec: DraftSpec;
  /** For log lines: "[<tag>-submit] …". */
  tag: string;
  /** Checks a POST body's fields and returns the create input; throws to refuse (400). */
  createInput?(body: Record<string, unknown>): Record<string, unknown>;
  /** Why this draft cannot be submitted yet (a required field), or null. */
  missing(draft: D): string | null;
  /** The process a submission creates; throws to refuse (400). */
  build(draft: D): Promise<DraftSubmission> | DraftSubmission;
  /**
   * A live edit (a project's "Edit project"): the draft is applied to the
   * process in place, with no review, so the Code of Conduct check must have
   * passed. Returns the response body.
   */
  applyLiveEdit?(
    draft: D,
    processId: string,
    editor: { id: string; email: string | null },
    submission: DraftSubmission,
  ): Promise<Record<string, unknown>>;
}

export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
