// Process controller — handles HTTP request/response for process endpoints

import { Request, Response } from "express";
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

export async function handleCreateProcess(
  req: Request,
  res: Response,
): Promise<void> {
  const { definition, title, description, jurisdiction, state, content } = req.body;

  if (!definition?.type || !title) {
    res.status(400).json({
      error: "Missing required fields: definition.type, title",
    });
    return;
  }

  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleGetProcess(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  try {
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
    if (!state) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * Lifecycle-control actions — these move a process through its state
 * machine (or publish from it) rather than participate in it. Open to
 * admins only: without this gate any resident could close or activate
 * anyone's vote, or process.propose their own pending_review vote to
 * bypass admin review. Participation actions (process.vote, .support,
 * .unsupport, .submit, proposal.support) stay resident-level.
 */
const ADMIN_ONLY_ACTIONS = new Set([
  "process.activate",
  "process.close",
  "process.propose",
  "process.snapshot",
]);

export async function handleProcessAction(
  req: Request,
  res: Response,
): Promise<void> {
  const { type, payload } = req.body;
  const id = req.params.id as string;

  if (!type) {
    res.status(400).json({ error: "Missing required field: type" });
    return;
  }

  try {
    // Actor is the authenticated user — never taken from the request body.
    const user = getAuthUser(res);
    const isAdmin = isAdminEmail(user.email);

    if (ADMIN_ONLY_ACTIONS.has(type) && !isAdmin) {
      res.status(403).json({ error: "Admin access required for this action" });
      return;
    }

    // Non-public processes (pending_review, archived) accept no actions
    // from non-admins. 404 (not 403) so the id's existence isn't leaked.
    const target = await getProcess(id);
    if (!target) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    if (!isPubliclyFetchable(target.status) && !isAdmin) {
      res.status(404).json({ error: "Process not found" });
      return;
    }

    const { process, result } = await executeAction(id, {
      type,
      actor: user.id,
      payload: payload ?? {},
    });

    res.json({ process, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
}

// --- Read layer for UI consumption ---

export async function handleListProcesses(
  req: Request,
  res: Response,
): Promise<void> {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetProcessState(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  // The actor is resolved from the session token, NEVER from the query
  // string. The old `?actor=<id>` form let any caller read another
  // user's has_voted / your_current_vote by passing their user id.
  // Anonymous callers still get the public read model (actor omitted) —
  // now with resident bylines anonymized ("Resident N" on this detail
  // surface, numbered per-process by first appearance).
  const caller = await resolveCallerUser(req);
  try {
    const state = await getProcessState(id, {
      actor: caller?.id,
      audience: caller ? "member" : "public",
      anonNumbers: caller ? undefined : await buildProcessAnonNumbers(id),
    });
    if (!state) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
