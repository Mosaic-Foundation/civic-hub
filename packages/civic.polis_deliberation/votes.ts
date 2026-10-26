// The local record of who has voted and who has submitted in a deliberation
// (deliberation_votes, deliberation_submissions), for the controller (ADR-012,
// the database convention: a controller does not query), through the database
// the package's host hands it (its granted tables only). Polis holds
// the votes themselves; these rows only tell a new participant from one who
// has voted on everything (Polis answers null for both) and enforce one
// statement per person. Every read and write is on the hub in scope.

import type { GrantedDb } from "../../src/sdk/index.js";
import { conversationHost } from "./host.js";

function db(): GrantedDb {
  return conversationHost.get().db();
}

/**
 * Record a local vote so we can distinguish new participants from users who
 * have voted on everything (Polis returns null for both). The caller treats
 * it as best-effort: a failure here must not fail the vote itself.
 */
export async function recordLocalVoteTracking(
  processId: string,
  userId: string,
  statementId: number,
): Promise<void> {
  await db()
    .from("deliberation_votes")
    .upsert(
      { process_id: processId, user_id: userId, statement_id: statementId },
      { onConflict: "hub_id,process_id,user_id,statement_id" },
    );
}

/** Whether this user has already submitted a statement in this conversation. */
export async function findExistingSubmission(
  processId: string,
  userId: string,
): Promise<{ user_id: string } | null> {
  return db()
    .from("deliberation_submissions")
    .select<{ user_id: string }>("user_id")
    .eq("process_id", processId)
    .eq("user_id", userId)
    .maybeSingle();
}

/** Record that this user has submitted a statement in this conversation. */
export async function recordSubmission(processId: string, userId: string): Promise<void> {
  await db()
    .from("deliberation_submissions")
    .upsert(
      { process_id: processId, user_id: userId },
      { onConflict: "hub_id,process_id,user_id" },
    );
}

/** The statement ids this user has already voted on, in this conversation. */
export async function getVotedStatementIds(
  processId: string,
  userId: string,
): Promise<Set<number>> {
  const votes = await db()
    .from("deliberation_votes")
    .select<{ statement_id: number }>("statement_id")
    .eq("process_id", processId)
    .eq("user_id", userId);
  return new Set(votes.map((v) => v.statement_id));
}
