// Vote-results controller — public read endpoint for published vote
// results. Renamed from briefController.ts in Slice 8.5.
//
// Only records in publication_status = "published" are returned.
// Pending and approved (delivered-but-not-yet-public) records return
// 404 so they stay invisible to the public until admin publishes.

import { Request, Response } from "express";
import { getProcess } from "../services/processService.js";
import {
  getPublicReadModel,
  type VoteResultsProcessState,
} from "../modules/civic.vote_results/index.js";

export async function handleGetVoteResults(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const process = await getProcess(id);
    // Only legacy civic.vote_results rows. `civic.brief` is now the new
    // generic brief module, served publicly at /brief/:id — not here.
    const isVoteResults =
      process && process.definition.type === "civic.vote_results";
    if (!isVoteResults) {
      res.status(404).json({ error: "Vote results not found" });
      return;
    }
    const state = process.state as unknown as VoteResultsProcessState;
    const model = getPublicReadModel(state, {
      id: process.id,
      title: process.title,
      createdAt: process.createdAt,
    });
    if (!model) {
      // Pending or approved-but-not-published — invisible to the public.
      res.status(404).json({ error: "Vote results not found" });
      return;
    }
    res.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
