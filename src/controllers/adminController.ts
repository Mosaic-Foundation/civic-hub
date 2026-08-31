// Admin controller — moderation surface for the civic.proposal idea board.
//
// A Proposal is an idea board (float an idea, gauge interest/discussion); it
// does NOT become a vote. The "gather support → official vote" mechanism lives
// in the civic.vote `proposal_required` lifecycle, not here. This controller
// lists proposals for admins and lets them archive (hide) ones that violate
// guidelines.

import { Request, Response } from "express";
import {
  listEndorsedProposals,
  listProposals,
  getProposalReadModel,
  getProposalSummary,
} from "../modules/civic.proposals/index.js";
import { enrichCreator, enrichCreators } from "../services/creatorDisplay.js";

/**
 * GET /admin/proposals — list proposals for admin review.
 * Returns endorsed proposals first, then submitted.
 */
export async function handleAdminListProposals(
  req: Request,
  res: Response,
): Promise<void> {
  const statusFilter = req.query.status as string | undefined;

  try {
    let proposals;
    if (statusFilter) {
      proposals = await listProposals(statusFilter as any);
    } else {
      // Default: show endorsed first (needing review), then submitted.
      const endorsed = await listEndorsedProposals();
      const submitted = (await listProposals("submitted")).sort(
        (a, b) => b.support_count - a.support_count,
      );
      proposals = [...endorsed, ...submitted];
    }

    const summaries = proposals.map(getProposalSummary);
    // Admin list: attach creator name + admin flag, but KEEP the raw
    // submitted_by id — admins need it to uniquely identify submitters.
    const enriched = await enrichCreators(summaries, {
      rawIdField: "submitted_by",
      keepRawId: true,
      audience: "member", // admin-gated route
    });
    res.json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

/**
 * GET /admin/proposals/:id — get full proposal detail for admin review
 */
export async function handleAdminGetProposal(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  try {
    const readModel = await getProposalReadModel(id);
    if (!readModel) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }
    // Admin detail: attach creator name + admin flag, keep raw id.
    res.json(
      await enrichCreator(readModel, {
        rawIdField: "submitted_by",
        keepRawId: true,
        audience: "member", // admin-gated route
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

