// What a process type is called, and how a link from it defaults (split from
// ProcessLinkPicker.tsx so that file holds only the component).
import type { RelationType } from "../services/api";
import { typeName } from "../processes/display";
import { processUiOf } from "../processes";

/**
 * The relation most likely to be right for a given process type. A DEFAULT,
 * never a restriction: all three stay available for every type, because the
 * hub is meant to accept process types nobody has thought of yet, and one of
 * them will legitimately implement something that isn't a project.
 *
 * The reasoning: a project is where a decision gets carried out, so it
 * implements. A vote almost always follows a conversation or a proposal, so it
 * continues.
 *
 * A PROPOSAL defaults to references, not continues — a proposal is an idea
 * board (float an idea, gauge interest; it never becomes a vote, see
 * src/modules/civic.proposals/handler.ts), so it more often OPENS a thread than descends
 * from one. Same reasoning as a conversation.
 */
export function defaultRelationFor(processType?: string): RelationType {
  // Each type says its own (ui/src/processes/: a project implements, a vote continues).
  return processUiOf(processType)?.linkRelation ?? "references";
}

/**
 * Human label for a process type. Falls back to the bare type for anything
 * unrecognized, so a process type added later is merely unpolished here, never
 * broken or invisible.
 */
export function friendlyType(type: string): string {
  return typeName(type);
}
