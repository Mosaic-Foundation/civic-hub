// Process controller — handles HTTP request/response for process endpoints

import { assertProcessTypeEnabled, isProcessTypeEnabled } from "../services/pluginGate.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import {
  createProcess,
  getProcess,
  executeAction,
  listProcessSummaries,
  getProcessState,
} from "../services/processService.js";
import {
  getAuthUser,
  isAdminEmail,
  resolveCallerUser,
} from "../middleware/auth.js";
import { isPubliclyFetchable } from "../services/processLifecycle.js";
import { buildProcessAnonNumbers } from "../services/processAnonymity.js";
import { getDescriptor } from "../processes/registry.js";
import type { Response } from "express";
import type { Process } from "../models/process.js";

export const handleCreateProcess = route(async (req, res) => {
  const { definition, title, description, jurisdiction, state, content } = req.body;

  if (!definition?.type || !title) {
    throw new ValidationError("Missing required fields: definition.type, title");
  }

  // A type an admin does not create directly (proposals and projects make
  // their own rows on approval) is created only through drafts and review.
  // A switched-off plugin's type is not on this hub at all: that answer first.
  assertProcessTypeEnabled(definition.type);
  const descriptor = getDescriptor(definition.type);
  if (descriptor && !descriptor.creation.admin) {
    throw new ValidationError(
      "That kind of process is created by submitting a draft for review.",
      "created_through_review",
    );
  }

  // Actor comes from the authenticated admin session, not the request body.
  const admin = getAuthUser(res);
  const process = await createProcess({
    definition,
    title,
    description: description ?? "",
    createdBy: admin.id,
    jurisdiction,
    state,
    content,
  });

  res.status(201).json(process);
});

export const handleGetProcess = route(async (req, res) => {
  const id = req.params.id as string;
  // Never serve the raw DB record: it exposes internal fields the
  // public must not see (unpublished vote_results admin notes and
  // recipient emails, moderation reasons, the identified supporters
  // map, pending_review/draft content). Serve the same read-model
  // projection as /state — getProcessState also owns the
  // isPubliclyFetchable gate, so non-public processes 404 here too.
  const caller = await resolveCallerUser(req);
  const state = await getProcessState(id, {
    actor: caller?.id,
    audience: caller ? "member" : "public",
    anonNumbers: caller ? undefined : await buildProcessAnonNumbers(id),
  });
  if (!state) throw new NotFoundError("Process not found");
  res.json(state);
});

export const handleProcessAction = route(async (req, res) => {
  const { type, payload } = req.body;
  const id = req.params.id as string;

  if (!type) throw new ValidationError("Missing required field: type");

  // Only the action's result. The raw row went out here until 2026-10-13: it
  // carries account ids (the creator, a vote's `supporters` map) that only
  // their owner and the hub's admins may see.
  const { result } = await actOnProcess(res, id, type, payload ?? {});
  res.json({ result });
});

/**
 * Run one action as the signed-in person, through executeAction: the one
 * action path for `POST /process/:id/action` and for a type's own routes
 * (`POST /proposals/:id/support`, `POST /projects/:id/complete`, …), which
 * pass `expectedType` so another type's id is not found there.
 *
 * Actor is the authenticated user — never taken from the request body.
 * Non-public processes (pending_review, archived) accept no actions from
 * non-admins, and a switched-off plugin's process is not there: 404 (not 403)
 * so the id's existence isn't leaked. Who may call which action is the
 * type's descriptor, checked in executeAction. A refusal is a typed error from
 * the handler (src/errors/): a refused vote carries the code the voting panel
 * keys its explanation on.
 */
export async function actOnProcess(
  res: Response,
  id: string,
  type: string,
  payload: Record<string, unknown>,
  expectedType?: string,
): Promise<{ process: Process; result: Record<string, unknown> }> {
  const user = getAuthUser(res);
  const isAdmin = isAdminEmail(user.email);
  const target = await getProcess(id);
  if (!target || !isProcessTypeEnabled(target.definition.type)) throw new NotFoundError("Process not found");
  if (expectedType && target.definition.type !== expectedType) throw new NotFoundError("Process not found");
  if (!isPubliclyFetchable(target.status) && !isAdmin) throw new NotFoundError("Process not found");
  return executeAction(id, { type, actor: user.id, payload }, isAdmin ? "admin" : "resident");
}

// --- Read layer for UI consumption ---

export const handleListProcesses = route(async (req, res) => {
  // Optional ?type= filter (repeatable) — lets single-type consumers
  // (the Votes tab) skip fetching every other type's full state JSONB.
  const raw = req.query.type;
  const types = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  const caller = await resolveCallerUser(req);
  const all = await listProcessSummaries(
    types.length > 0 ? types : undefined,
    caller ? "member" : "public",
  );
  // Public list: hide vote-results, briefs, and meeting summaries that
  // aren't yet published. Pending / approved records are admin-facing and
  // must not be visible to the public before approval.
  //
  // civic.brief here is the NEW generic brief module (same publication
  // gate as the legacy civic.vote_results): a pending/approved brief stays
  // invisible in the public list until an admin publishes it.
  const filtered = all.filter((p) => {
    const type = (p as { type?: string }).type;
    if (type === "civic.vote_results" || type === "civic.brief") {
      return (p as { publication_status?: string }).publication_status === "published";
    }
    if (type === "civic.meeting_summary") {
      return (p as { approval_status?: string }).approval_status === "published";
    }
    return true;
  });
  res.json(filtered);
});

export const handleGetProcessState = route(async (req, res) => {
  const id = req.params.id as string;
  // The actor is resolved from the session token, NEVER from the query
  // string. The old `?actor=<id>` form let any caller read another
  // user's has_voted / your_current_vote by passing their user id.
  // Anonymous callers still get the public read model (actor omitted) —
  // now with resident bylines anonymized ("Resident N" on this detail
  // surface, numbered per-process by first appearance).
  const caller = await resolveCallerUser(req);
  const state = await getProcessState(id, {
    actor: caller?.id,
    audience: caller ? "member" : "public",
    anonNumbers: caller ? undefined : await buildProcessAnonNumbers(id),
  });
  if (!state) throw new NotFoundError("Process not found");
  res.json(state);
});
