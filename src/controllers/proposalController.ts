// Proposal controller — handles HTTP request/response for proposal endpoints
//
// User-facing operations: submit, support, list, detail.
// Admin operations are in adminController.ts.

import { Request, Response } from "express";
import { emitEvent } from "../events/eventEmitter.js";
import {
  createProposal,
  listProposals,
  supportProposal,
  getProposalReadModel,
  getProposalSummary,
} from "../modules/civic.proposals/index.js";
import { getAuthUser, resolveCallerId } from "../middleware/auth.js";
import { enrichCreator, enrichCreators } from "../services/creatorDisplay.js";

/**
 * POST /proposals — submit a new proposal
 */
export async function handleSubmitProposal(
  req: Request,
  res: Response,
): Promise<void> {
  const { title, description, optional_links, category, assistant_helped } = req.body;

  if (!title) {
    res.status(400).json({ error: "Missing required field: title" });
    return;
  }

  try {
    const user = getAuthUser(res);
    const proposal = await createProposal(
      { title, description, optional_links, submitted_by: user.id, category, assistant_helped },
      emitEvent,
    );
    res.status(201).json(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * GET /proposals — list all proposals (optionally filtered by status)
 */
export async function handleListProposals(
  req: Request,
  res: Response,
): Promise<void> {
  const status = req.query.status as string | undefined;
  const validStatuses = ["submitted", "endorsed", "converted", "archived"];

  if (status && !validStatuses.includes(status)) {
    res.status(400).json({
      error: `Invalid status filter. Valid values: ${validStatuses.join(", ")}`,
    });
    return;
  }

  try {
    const proposals = await listProposals(status as any);
    const summaries = proposals.map(getProposalSummary);
    // Resolve every submitter in one query; attach creator name + admin
    // flag and redact the raw submitted_by id from this public list.
    const enriched = await enrichCreators(summaries, {
      rawIdField: "submitted_by",
    });
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * GET /proposals/:id — get proposal detail
 */
export async function handleGetProposal(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  // Caller identity comes from the session token, never from ?actor= (which
  // let anyone read another resident's support state by passing their id).
  // Anonymous callers get the public read model with no per-actor fields.
  const actor = await resolveCallerId(req);

  try {
    const readModel = await getProposalReadModel(id, actor);
    if (!readModel) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }
    // Attach creator name + admin flag; redact the raw submitted_by id.
    res.json(await enrichCreator(readModel, { rawIdField: "submitted_by" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * POST /proposals/:id/support — endorse a proposal
 */
export async function handleSupportProposal(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;

  try {
    const user = getAuthUser(res);
    const proposal = await supportProposal(id, user.id, emitEvent);
    res.json({
      support_count: proposal.support_count,
      status: proposal.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
}
